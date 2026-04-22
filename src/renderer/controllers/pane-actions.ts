import { bridge } from '../bridge';
import {
  state,
  paneNodeMap,
  getDirectoryLabel,
  ACCENT_PALETTE,
} from '../state';
import { refocusTerminal } from '../terminal';
import type { PaneActionsDeps } from '../types';
import { clearPaneWorkingIndicator, clearPaneAttentionIndicator } from '../tabs';

export interface PaneActionsController {
  focusPane: (paneId: string, focusTerminal?: boolean) => void;
  addPane: (cwdOverride?: string) => void;
  addPaneFromSelectedDirectory: () => Promise<void>;
  closePane: (index: number) => void | Promise<void>;
  handleTitleChange: (paneId: string, title: string) => void;
  handleCwdChange: (paneId: string, cwd: string) => void;
}

/**
 * Try to extract an absolute path from a terminal title string.
 * Common formats from shells:
 *   "user@host: ~/projects/foo"   (zsh default)
 *   "~/projects/foo"
 *   "/Users/someone/projects/foo"
 *   "dirname — zsh"
 */
function extractCwdFromTitle(title: string): string | null {
  // Strip trailing shell indicator like " — zsh", " - bash", " — fish"
  const cleaned = title.replace(/\s*[—–-]\s*(zsh|bash|fish|sh|ksh|csh|tcsh|nu|pwsh|powershell)\s*$/i, '').trim();

  // Try to find a path after ":" (e.g. "user@host: ~/foo")
  const colonIndex = cleaned.indexOf(':');
  const candidate = colonIndex !== -1 ? cleaned.slice(colonIndex + 1).trim() : cleaned;

  // Must look like a path (starts with / or ~)
  if (candidate.startsWith('/') || candidate.startsWith('~')) {
    // Expand ~ to the home directory using the bridge default cwd as a heuristic
    if (candidate.startsWith('~')) {
      // Derive home from defaultCwd (e.g. /Users/z) — go up until we match ~
      const home = bridge.defaultCwd;
      return candidate.replace(/^~/, home);
    }
    return candidate;
  }

  return null;
}

export function createPaneActionsController(
  deps: PaneActionsDeps,
): PaneActionsController {
  function clearResizeUiState(): void {
    document.body.classList.remove('is-resizing-pane');
    for (const node of paneNodeMap.values()) {
      node.root.classList.remove('is-resizing');
      node.leftResizeHandle.classList.remove('is-active');
      node.rightResizeHandle.classList.remove('is-active');
    }
  }

  function focusPane(paneId: string, focusTerminal = true): void {
    if (state.focusedPaneId !== paneId) {
      state.transientPaneWidth = null;
      state.paneResizeState = null;
      clearResizeUiState();
    }
    state.focusedPaneId = paneId;
    state.isNavigationMode = false;
    clearPaneAttentionIndicator(paneId);
    deps.render();

    if (focusTerminal) {
      const node = paneNodeMap.get(paneId);
      if (node) {
        refocusTerminal(node);
      }
    }
  }

  function addPane(cwdOverride?: string): void {
    if (state.panes.length >= state.settings.maxSessions) {
      throw new Error(`Session limit reached (${state.settings.maxSessions})`);
    }

    const accent =
      ACCENT_PALETTE[(state.nextPaneNumber - 1) % ACCENT_PALETTE.length];
    const cwd = cwdOverride?.trim() || state.settings.defaultOpenDirectory;
    const newPane = {
      id: `p${state.nextPaneNumber}`,
      title: null,
      terminalTitle: getDirectoryLabel(cwd),
      cwd,
      accent,
    };

    state.nextPaneNumber += 1;
    state.panes = [...state.panes, newPane];
    state.focusedPaneId = newPane.id;
    deps.render(true);
  }

  async function addPaneFromSelectedDirectory(): Promise<void> {
    const selectedDirectory = await bridge.selectDirectory();
    if (!selectedDirectory) return;
    addPane(selectedDirectory);
  }

  async function closePane(index: number): Promise<void> {
    const closing = state.panes[index];
    if (!closing) return;
    clearPaneAttentionIndicator(closing.id);
    clearPaneWorkingIndicator(closing.id);

    if (closing.id === state.renamingPaneId) state.renamingPaneId = null;
    if (closing.id === state.dragState?.paneId) deps.endTabDrag();
    if (closing.id === state.pendingTabFocus?.paneId) deps.clearPendingTabFocus();
    if (closing.id === state.paneResizeState?.paneId) {
      state.paneResizeState = null;
      state.transientPaneWidth = null;
      clearResizeUiState();
    }

    if (state.panes.length === 1) {
      const confirmed = await bridge.confirmQuit();
      if (!confirmed) return;

      bridge.destroyTerminal({ paneId: closing.id });
      state.panes = [];
      state.focusedPaneId = null;
      window.close();
      return;
    }

    bridge.destroyTerminal({ paneId: closing.id });

    const remaining = state.panes.filter((_, i) => i !== index);
    if (closing.id === state.focusedPaneId) {
      const fallback = Math.max(0, index - 1);
      state.focusedPaneId =
        remaining[fallback]?.id ?? remaining[0]?.id ?? null;
    }
    state.panes = remaining;
    deps.render(true);
  }

  function handleTitleChange(paneId: string, title: string): void {
    state.panes = state.panes.map((pane) =>
      pane.id === paneId ? { ...pane, terminalTitle: title } : pane,
    );

    // Try to extract a cwd from the terminal title (e.g. "user@host: ~/path"
    // or just "~/path" or "/absolute/path") so tabs update on directory change
    // even when the shell doesn't emit OSC 7/1337/633.
    const cwdFromTitle = extractCwdFromTitle(title);
    if (cwdFromTitle) {
      handleCwdChange(paneId, cwdFromTitle);
      return;
    }

    const pane = state.panes.find((item) => item.id === paneId);
    if (pane && pane.title === null) {
      deps.renderTabs();
    }
  }

  function handleCwdChange(paneId: string, cwd: string): void {
    const nextCwd = cwd.trim();
    if (!nextCwd) return;

    const prevPane = state.panes.find((pane) => pane.id === paneId);
    if (!prevPane || prevPane.cwd === nextCwd) return;

    state.panes = state.panes.map((pane) =>
      pane.id === paneId ? { ...pane, cwd: nextCwd } : pane,
    );

    const node = paneNodeMap.get(paneId);
    if (node) {
      node.cwd = nextCwd;
    }

    if (prevPane.title === null) {
      deps.renderTabs();
    }

    if (paneId === state.focusedPaneId) {
      deps.render();
    }
  }

  return {
    focusPane,
    addPane,
    addPaneFromSelectedDirectory,
    closePane,
    handleTitleChange,
    handleCwdChange,
  };
}
