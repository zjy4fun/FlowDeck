import {
  state,
  dom,
  initDom,
  getFocusedIndex,
  getPaneLabel,
  getDirectoryLabel,
} from './state';
import { renderTabs, initTabs, clearPendingTabFocus, endTabDrag } from './tabs';
import { renderPanes, initPanes } from './panes';
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

function updateStatus(): void {
  const focusedPane = state.panes[getFocusedIndex()];

  if (state.isNavigationMode) {
    dom.statusLabel.classList.add('is-navigation-mode');
    dom.statusLabel.textContent = 'Navigation Mode';
    dom.statusHint.textContent = 'Left/Right or H/L to flip; Enter to Focus';
    return;
  }

  dom.statusLabel.classList.remove('is-navigation-mode');
  dom.statusLabel.textContent = `Focused: ${getPaneLabel(focusedPane) || focusedPane.id}`;
  dom.statusHint.textContent = 'Ctrl+B to enter navigation mode';
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
  dom.statusLabel.textContent = `Error: ${message}`;
  dom.statusHint.textContent = '';
  console.error(error);
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

  const navigation = createNavigationController({
    addPane: paneActions.addPane,
    closePane: paneActions.closePane,
    focusPane: paneActions.focusPane,
    render,
  });

  initTabs({
    focusPane: paneActions.focusPane,
    closePane: paneActions.closePane,
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
    addPane: paneActions.addPane,
    closePane: paneActions.closePane,
    handleCwdChange: paneActions.handleCwdChange,
    handleGlobalKeydown: navigation.handleGlobalKeydown,
    render,
    reportError,
  });

  render(true);
}
