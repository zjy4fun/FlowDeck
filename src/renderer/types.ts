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
  closePane: (index: number) => void | Promise<void>;
  focusPane: (paneId: string, focusTerminal?: boolean) => void;
  render: RenderFn;
}

export interface LifecycleDeps {
  addPane: () => void;
  closePane: (index: number) => void | Promise<void>;
  handleCwdChange: (paneId: string, cwd: string) => void;
  handleGlobalKeydown: (event: KeyboardEvent) => void;
  reloadSettings: () => Promise<void>;
  render: RenderFn;
  reportError: (error: unknown) => void;
  onSettingsReloaded?: () => void;
  onSessionExit?: () => void;
}

/* ── Persisted settings ── */

export interface AppSettings {
  fontSize: number;
  paneOpacity: number;
  paneWidth: number;
  defaultOpenDirectory: string;
  maxSessions: number;
  usageProvider: UsageProvider;
  themeMode: ThemeMode;
}

export type UsageProvider = 'codex' | 'claude-code';
export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export interface UsageQuotaSnapshot {
  provider: UsageProvider;
  sessionUsedPercent: number | null;
  sessionResetsAt: number | null;
  weeklyUsedPercent: number | null;
  weeklyResetsAt: number | null;
  sessionInputTokens: number | null;
  sessionOutputTokens: number | null;
  sessionTotalTokens: number | null;
  queriedAt: string | null;
}

export type UpdateWindowAction = 'cancel' | 'restart' | 'close';

export interface UpdateWindowState {
  title: string;
  detail: string;
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
  showProgress: boolean;
  primaryAction: UpdateWindowAction;
  primaryLabel: string;
  secondaryAction?: UpdateWindowAction;
  secondaryLabel?: string;
}

/* ── Preload bridge API ── */

export interface FlowDeckBridge {
  platform: string;
  defaultCwd: string;
  defaultTabTitle: string;
  loadUsageQuota: (provider: UsageProvider) => Promise<UsageQuotaSnapshot>;

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

  getFilePath: (file: File) => string;
  selectDirectory: () => Promise<string | null>;

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
  confirmQuit: () => Promise<boolean>;
  onSettingsChanged: (handler: () => void) => () => void;
  onUpdateWindowState: (
    handler: (state: UpdateWindowState) => void,
  ) => () => void;
  cancelUpdateDownload: () => Promise<void>;
  restartForUpdate: () => Promise<void>;
  closeUpdateWindow: () => Promise<void>;
}
