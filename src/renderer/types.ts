import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { WebglAddon } from '@xterm/addon-webgl';

/* ── Pane data (serializable state) ── */

export interface PaneData {
  id: string;
  title: string | null;
  terminalTitle: string;
  cwd: string;
  accent: string;
}

/* ── Pane node (live DOM + terminal instance) ── */

export interface PaneNode {
  paneId: string;
  cwd: string;
  root: HTMLElement;
  terminalHost: HTMLElement;
  occlusionShield: HTMLElement;
  leftResizeHandle: HTMLElement;
  rightResizeHandle: HTMLElement;
  terminal: Terminal;
  fitAddon: FitAddon;
  webglAddon: WebglAddon | null;
  sessionReady: boolean;
  sizeKey: string;
  needsFit: boolean;
  accent: string;
}

/* ── Drag state for tab reordering ── */

export interface DragState {
  paneId: string;
  pointerId: number;
  startX: number;
  currentX: number;
  dropIndex: number;
  hasMoved: boolean;
}

/* ── Pending double-click-to-focus timer ── */

export interface PendingTabFocus {
  paneId: string;
  timerId: number;
}

export interface PaneResizeState {
  paneId: string;
  pointerId: number;
  edge: 'left' | 'right';
  startX: number;
  startWidth: number;
}

/* ── Internal renderer controller types ── */

export type RenderFn = (refit?: boolean) => void;
export type CleanupFn = () => void;

export interface PaneActionsDeps {
  render: RenderFn;
  renderTabs: () => void;
  clearPendingTabFocus: CleanupFn;
  endTabDrag: CleanupFn;
}

export interface NavigationDeps {
  addPane: () => void;
  closePane: (index: number) => void;
  focusPane: (paneId: string, focusTerminal?: boolean) => void;
  render: RenderFn;
}

export interface LifecycleDeps {
  addPane: () => void;
  closePane: (index: number) => void;
  handleCwdChange: (paneId: string, cwd: string) => void;
  handleGlobalKeydown: (event: KeyboardEvent) => void;
  render: RenderFn;
  reportError: (error: unknown) => void;
}

/* ── Persisted settings ── */

export interface AppSettings {
  fontSize: number;
  paneOpacity: number;
  paneWidth: number;
  defaultOpenDirectory: string;
  maxSessions: number;
}

/* ── Preload bridge API ── */

export interface FlowDeckBridge {
  platform: string;
  defaultCwd: string;
  defaultTabTitle: string;

  createTerminal: (payload: {
    paneId: string;
    cols: number;
    rows: number;
    cwd: string;
  }) => Promise<{ paneId: string }>;

  writeTerminal: (payload: { paneId: string; data: string }) => Promise<void>;

  resizeTerminal: (payload: {
    paneId: string;
    cols: number;
    rows: number;
  }) => Promise<void>;

  destroyTerminal: (payload: { paneId: string }) => Promise<void>;

  loadSettings: () => Promise<AppSettings | null>;
  saveSettings: (settings: AppSettings) => Promise<void>;

  onTerminalData: (
    handler: (payload: { paneId: string; data: string }) => void,
  ) => () => void;

  onTerminalExit: (
    handler: (payload: { paneId: string; exitCode: number }) => void,
  ) => () => void;

  onMenuNewTab: (handler: () => void) => () => void;
  onMenuCloseTab: (handler: () => void) => () => void;
}
