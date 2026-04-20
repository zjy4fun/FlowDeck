import {
  state,
  dom,
  initDom,
  paneNodeMap,
  getFocusedIndex,
  getDirectoryLabel,
  getDisplayPath,
} from './state';
import { renderTabs, initTabs, clearPendingTabFocus, endTabDrag } from './tabs';
import { renderPanes, initPanes } from './panes';
import { refocusTerminal } from './terminal';
import { createReactivationController } from './reactivation-controller';
import {
  applySettingsToDom,
  loadPersistedSettings,
  initSettingsListeners,
} from './settings';
import { createPaneActionsController } from './controllers/pane-actions';
import { createNavigationController } from './controllers/navigation';
import { initLifecycle } from './controllers/lifecycle';
import type { RenderFn } from './types';

/* ── Status bar ── */

const WINDOW_REACTIVATE_DEBOUNCE_MS = 250;

function compactPathLabel(displayPath: string, maxLength = 52): string {
  if (displayPath.length <= maxLength) return displayPath;
  if (displayPath === '~') return displayPath;

  let prefix = '';
  let remainder = displayPath;

  if (displayPath.startsWith('~/')) {
    prefix = '~/';
    remainder = displayPath.slice(2);
  } else if (displayPath.startsWith('/')) {
    prefix = '/';
    remainder = displayPath.slice(1);
  }

  const parts = remainder.split('/').filter(Boolean);
  if (parts.length >= 2) {
    const lastTwo = `${prefix}.../${parts.slice(-2).join('/')}`;
    if (lastTwo.length <= maxLength) return lastTwo;

    const lastOne = `${prefix}.../${parts[parts.length - 1]}`;
    if (lastOne.length <= maxLength) return lastOne;
  }

  return `...${displayPath.slice(-(maxLength - 3))}`;
}

function updateStatus(): void {
  const focusedIndex = getFocusedIndex();
  const focusedPane = focusedIndex === -1 ? null : state.panes[focusedIndex];

  if (state.isNavigationMode) {
    dom.statusLabel.classList.add('is-navigation-mode');
    dom.statusLabel.title = '';
    dom.statusLabel.textContent = 'Navigation Mode';
    return;
  }

  dom.statusLabel.classList.remove('is-navigation-mode');
  if (!focusedPane) {
    dom.statusLabel.title = '';
    dom.statusLabel.textContent = 'No Session';
    return;
  }

  const fullDisplayPath = getDisplayPath(focusedPane.cwd);
  dom.statusLabel.title = fullDisplayPath;
  dom.statusLabel.textContent = compactPathLabel(fullDisplayPath);
}

function createRenderGateway(): RenderFn {
  return (refit = false): void => {
    renderTabs();
    renderPanes(refit);
    updateStatus();
  };
}

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  dom.statusLabel.title = message;
  dom.statusLabel.textContent = `Error: ${message}`;
  console.error(error);
}

function isEditableFormField(activeElement: HTMLElement | null): boolean {
  if (!activeElement) return false;
  if (activeElement.classList.contains('xterm-helper-textarea')) return false;

  return (
    activeElement.tagName === 'INPUT' ||
    activeElement.tagName === 'TEXTAREA' ||
    activeElement.tagName === 'SELECT' ||
    activeElement.isContentEditable
  );
}

function focusActivePaneTerminal(
  options: { refit?: boolean; forceBlur?: boolean } = {},
): void {
  const { refit = false, forceBlur = false } = options;
  if (state.isNavigationMode || !state.focusedPaneId) return;

  const activeElement = document.activeElement as HTMLElement | null;
  if (isEditableFormField(activeElement)) return;

  const node = paneNodeMap.get(state.focusedPaneId);
  if (!node) return;
  refocusTerminal(node, { refit, forceBlur });
}

/* ── Bootstrap ── */

export async function startApp(): Promise<void> {
  initDom();

  const render = createRenderGateway();

  const paneActions = createPaneActionsController({
    render,
    renderTabs,
    clearPendingTabFocus,
    endTabDrag,
  });

  const addPane = (cwdOverride?: string): void => {
    paneActions.addPane(cwdOverride);
  };

  const closePane = async (index: number): Promise<void> => {
    await paneActions.closePane(index);
  };

  const addPaneFromSelectedDirectory = async (): Promise<void> => {
    try {
      await paneActions.addPaneFromSelectedDirectory();
    } catch (error) {
      reportError(error);
    }
  };

  const navigation = createNavigationController({
    addPane,
    closePane,
    focusPane: paneActions.focusPane,
    render,
  });

  initTabs({
    focusPane: paneActions.focusPane,
    closePane,
    addPaneFromSelectedDirectory,
    render: () => render(),
  });

  initPanes({
    onPaneClick: paneActions.focusPane,
    onTitleChange: paneActions.handleTitleChange,
  });

  // Load persisted settings, then apply to DOM
  await loadPersistedSettings();
  state.panes = state.panes.slice(0, state.settings.maxSessions).map((pane) => ({
    ...pane,
    cwd: state.settings.defaultOpenDirectory,
    terminalTitle: getDirectoryLabel(state.settings.defaultOpenDirectory),
  }));
  state.focusedPaneId = state.panes[0]?.id ?? null;
  state.nextPaneNumber = state.panes.length + 1;
  applySettingsToDom();

  initSettingsListeners((refit) => render(refit));

  initLifecycle({
    addPane,
    closePane,
    handleCwdChange: paneActions.handleCwdChange,
    handleGlobalKeydown: navigation.handleGlobalKeydown,
    reloadSettings: loadPersistedSettings,
    render,
    reportError,
  });

  const reactivationController = createReactivationController({
    debounceMs: WINDOW_REACTIVATE_DEBOUNCE_MS,
    onRefocusTerminal: () => {
      focusActivePaneTerminal({ refit: true, forceBlur: true });
    },
  });
  const handleWindowFocus = (): void => {
    reactivationController.handleWindowReactivated();
  };
  window.addEventListener('focus', handleWindowFocus);
  const handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      reactivationController.handleWindowReactivated();
    }
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('beforeunload', () => {
    reactivationController.dispose();
    window.removeEventListener('focus', handleWindowFocus);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, { once: true });

  render(true);
}
