import { bridge } from './bridge';
import {
  state,
  dom,
  paneNodeMap,
  initDom,
  getFocusedIndex,
  getPaneLabel,
  ACCENT_PALETTE,
} from './state';
import { renderTabs, initTabs, clearPendingTabFocus, endTabDrag } from './tabs';
import { renderPanes, initPanes } from './panes';
import {
  applySettingsToDom,
  loadPersistedSettings,
  initSettingsListeners,
} from './settings';

/* ── Render cycle ── */

function render(refit = false): void {
  renderTabs();
  renderPanes(refit);
  updateStatus();
}

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  dom.statusLabel.textContent = `Error: ${message}`;
  dom.statusHint.textContent = '';
  console.error(error);
}

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

/* ── Pane operations ── */

function focusPane(paneId: string, focusTerminal = true): void {
  state.focusedPaneId = paneId;
  state.isNavigationMode = false;
  render();

  if (focusTerminal) {
    const node = paneNodeMap.get(paneId);
    if (node) {
      requestAnimationFrame(() => node.terminal.focus());
    }
  }
}

function addPane(): void {
  const accent =
    ACCENT_PALETTE[(state.nextPaneNumber - 1) % ACCENT_PALETTE.length];
  const focusedPane = state.panes[getFocusedIndex()];
  const newPane = {
    id: `p${state.nextPaneNumber}`,
    title: null,
    terminalTitle: bridge.defaultTabTitle,
    cwd: focusedPane?.cwd || bridge.defaultCwd,
    accent,
  };

  state.nextPaneNumber += 1;
  state.panes = [...state.panes, newPane];
  state.focusedPaneId = newPane.id;
  render(true);
}

function closePane(index: number): void {
  if (state.panes.length === 1) return;

  const closing = state.panes[index];
  if (!closing) return;

  if (closing.id === state.renamingPaneId) state.renamingPaneId = null;
  if (closing.id === state.dragState?.paneId) endTabDrag();
  if (closing.id === state.pendingTabFocus?.paneId) clearPendingTabFocus();

  bridge.destroyTerminal({ paneId: closing.id });

  const remaining = state.panes.filter((_, i) => i !== index);
  if (closing.id === state.focusedPaneId) {
    const fallback = Math.max(0, index - 1);
    state.focusedPaneId =
      remaining[fallback]?.id ?? remaining[0]?.id ?? null;
  }
  state.panes = remaining;
  render(true);
}

/* ── Navigation mode ── */

function blurFocusedTerminal(): void {
  const node = paneNodeMap.get(state.focusedPaneId!);
  if (node) node.terminal.blur();
}

function enterNavigationMode(): void {
  if (state.panes.length === 0) return;
  state.isNavigationMode = true;
  blurFocusedTerminal();
  render();
}

function moveFocus(delta: number): void {
  if (state.panes.length === 0) return;
  const current = getFocusedIndex();
  const next = (current + delta + state.panes.length) % state.panes.length;
  state.focusedPaneId = state.panes[next].id;
  render();
}

function isEditableTarget(): boolean {
  return (
    document.activeElement?.tagName === 'INPUT' ||
    document.activeElement?.classList?.contains('xterm-helper-textarea') === true
  );
}

/* ── Keyboard handling ── */

function handleGlobalKeydown(event: KeyboardEvent): void {
  const key = event.key.toLowerCase();
  const isMac = bridge.platform === 'darwin';

  const isAddTab = isMac
    ? event.metaKey && !event.ctrlKey && !event.altKey && key === 't'
    : event.ctrlKey && !event.metaKey && !event.altKey && key === 't';

  const isNavigation =
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    key === 'b';

  if (isAddTab) {
    event.preventDefault();
    addPane();
    return;
  }

  if (isNavigation && document.activeElement?.tagName !== 'INPUT') {
    event.preventDefault();
    enterNavigationMode();
    return;
  }

  if (isEditableTarget() || !state.isNavigationMode) return;

  if (event.key === 'ArrowLeft' || key === 'h') {
    event.preventDefault();
    moveFocus(-1);
    return;
  }

  if (event.key === 'ArrowRight' || key === 'l') {
    event.preventDefault();
    moveFocus(1);
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    if (state.focusedPaneId) focusPane(state.focusedPaneId);
  }
}

/* ── Terminal data / exit listeners ── */

let removeDataListener: (() => void) | null = null;
let removeExitListener: (() => void) | null = null;

function attachTerminalListeners(): void {
  removeDataListener = bridge.onTerminalData(({ paneId, data }) => {
    paneNodeMap.get(paneId)?.terminal.write(data);
  });

  removeExitListener = bridge.onTerminalExit(({ paneId, exitCode }) => {
    const node = paneNodeMap.get(paneId);
    if (!node) return;
    node.sessionReady = false;
    node.terminal.writeln('');
    node.terminal.writeln(
      `\x1b[38;5;244m[process exited with code ${exitCode}]\x1b[0m`,
    );
  });
}

function detachTerminalListeners(): void {
  removeDataListener?.();
  removeExitListener?.();
}

/* ── Title change handler (passed to panes module) ── */

function handleTitleChange(paneId: string, title: string): void {
  state.panes = state.panes.map((p) =>
    p.id === paneId ? { ...p, terminalTitle: title } : p,
  );
  const pane = state.panes.find((p) => p.id === paneId);
  if (pane && pane.title === null) {
    renderTabs();
  }
}

/* ── Bootstrap ── */

export async function startApp(): Promise<void> {
  initDom();

  // Wire up module callbacks
  initTabs({
    focusPane,
    closePane,
    render: () => render(),
  });

  initPanes({
    onPaneClick: (paneId) => focusPane(paneId),
    onTitleChange: handleTitleChange,
  });

  // Load persisted settings, then apply to DOM
  await loadPersistedSettings();
  applySettingsToDom();

  // Attach terminal data/exit event listeners
  attachTerminalListeners();

  // Settings panel listeners
  initSettingsListeners((refit) => render(refit));

  // Add-pane button
  dom.addPaneButton.addEventListener('click', () => {
    try {
      addPane();
    } catch (err) {
      reportError(err);
    }
  });

  // Global keyboard shortcuts
  window.addEventListener('keydown', handleGlobalKeydown, true);

  // Window resize
  window.addEventListener('resize', () => {
    try {
      render(true);
    } catch (err) {
      reportError(err);
    }
  });

  // Cleanup
  window.addEventListener('beforeunload', detachTerminalListeners);

  // Global error handlers
  window.addEventListener('error', (e) => reportError(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason));

  // Initial render
  render(true);
}
