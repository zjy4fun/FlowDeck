import type {
  PaneData,
  PaneNode,
  DragState,
  PendingTabFocus,
  PaneResizeState,
  AppSettings,
  ResolvedTheme,
} from './types';
import { bridge } from './bridge';

/* ── Constants ── */

export const ACCENT_PALETTE = [
  '#5cc8ff',
  '#06d6a0',
  '#ff9f1c',
  '#ff6b57',
  '#ffd166',
  '#118ab2',
  '#9b5de5',
  '#ef476f',
  '#7bd389',
  '#f4a261',
] as const;

const DEFAULT_SETTINGS: AppSettings = {
  fontSize: 14,
  paneOpacity: 0.75,
  paneWidthRatio: 0.45,
  defaultOpenDirectory: bridge.defaultCwd,
  maxSessions: 8,
  themeMode: 'system',
  developerModeEnabled: false,
};

export function getDirectoryLabel(cwd: string): string {
  if (cwd === bridge.defaultCwd) return bridge.defaultTabTitle;
  return cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;
}

export function getDisplayPath(cwd: string): string {
  if (cwd.startsWith(bridge.defaultCwd)) {
    return '~' + cwd.slice(bridge.defaultCwd.length);
  }
  return cwd;
}

function createInitialPanes(): PaneData[] {
  const initialCount = Math.min(3, DEFAULT_SETTINGS.maxSessions);
  return Array.from({ length: initialCount }, (_, index) => ({
    id: `p${index + 1}`,
    title: null,
    terminalTitle: getDirectoryLabel(DEFAULT_SETTINGS.defaultOpenDirectory),
    cwd: DEFAULT_SETTINGS.defaultOpenDirectory,
    accent: ACCENT_PALETTE[index % ACCENT_PALETTE.length],
  }));
}

/* ── Mutable application state ── */

export const state = {
  panes: createInitialPanes(),
  focusedPaneId: 'p1' as string | null,
  nextPaneNumber: 4,
  renamingPaneId: null as string | null,
  dragState: null as DragState | null,
  paneResizeState: null as PaneResizeState | null,
  transientPaneWidth: null as number | null,
  isNavigationMode: false,
  pendingTabFocus: null as PendingTabFocus | null,
  settings: { ...DEFAULT_SETTINGS },
};

/* ── Live pane-node map (DOM + terminal instances) ── */

export const paneNodeMap = new Map<string, PaneNode>();

/* ── DOM element references (populated by initDom) ── */

export let dom = {
  stage: null! as HTMLElement,
  tabsList: null! as HTMLElement,
  statusLabel: null! as HTMLElement,
  addPaneButton: null! as HTMLButtonElement,
  settingsButton: null! as HTMLButtonElement,
  settingsPanel: null! as HTMLElement,
  fontSizeInput: null! as HTMLInputElement,
  defaultDirectoryInput: null! as HTMLInputElement,
  maxSessionsInput: null! as HTMLInputElement,
  paneWidthRange: null! as HTMLInputElement,
  paneWidthInput: null! as HTMLInputElement,
  paneWidthValue: null! as HTMLElement,
  paneOpacityRange: null! as HTMLInputElement,
  paneOpacityInput: null! as HTMLInputElement,
  paneOpacityValue: null! as HTMLElement,
  themeModeSelect: null! as HTMLSelectElement,
  developerModeInput: null! as HTMLInputElement,
};

export function initDom(): void {
  dom = {
    stage: document.getElementById('stage')!,
    tabsList: document.getElementById('tabs-list')!,
    statusLabel: document.getElementById('status-label')!,
    addPaneButton: document.getElementById('tabs-add') as HTMLButtonElement,
    settingsButton: document.getElementById('tabs-settings') as HTMLButtonElement,
    settingsPanel: document.getElementById('settings-panel')!,
    fontSizeInput: document.getElementById('font-size-input') as HTMLInputElement,
    defaultDirectoryInput: document.getElementById('default-directory-input') as HTMLInputElement,
    maxSessionsInput: document.getElementById('max-sessions-input') as HTMLInputElement,
    paneWidthRange: document.getElementById('pane-width-range') as HTMLInputElement,
    paneWidthInput: document.getElementById('pane-width-input') as HTMLInputElement,
    paneWidthValue: document.getElementById('pane-width-value')!,
    paneOpacityRange: document.getElementById('pane-opacity-range') as HTMLInputElement,
    paneOpacityInput: document.getElementById('pane-opacity-input') as HTMLInputElement,
    paneOpacityValue: document.getElementById('pane-opacity-value')!,
    themeModeSelect: document.getElementById('theme-mode-input') as HTMLSelectElement,
    developerModeInput: document.getElementById('developer-mode-input') as HTMLInputElement,
  };
}

/* ── Helpers ── */

export function getPaneLabel(pane: PaneData): string {
  return pane.title ?? getDirectoryLabel(pane.cwd) ?? pane.terminalTitle ?? '';
}

export function getFocusedIndex(): number {
  const index = state.panes.findIndex((p) => p.id === state.focusedPaneId);
  if (index !== -1) return index;

  state.focusedPaneId = state.panes[0]?.id ?? null;
  return state.panes.length > 0 ? 0 : -1;
}

export function getResolvedTheme(): ResolvedTheme {
  const mode = state.settings.themeMode;
  if (mode === 'light' || mode === 'dark') return mode;
  if (
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  ) {
    return 'light';
  }
  return 'dark';
}

export function getFocusedPaneWidth(): number {
  return state.transientPaneWidth ?? Math.round((dom.stage?.clientWidth ?? 1600) * state.settings.paneWidthRatio);
}
