import type {
  PaneData,
  PaneNode,
  DragState,
  PendingTabFocus,
  AppSettings,
} from './types';
import { bridge } from './bridge';

/* ── Constants ── */

export const ACCENT_PALETTE = [
  '#ff6b57',
  '#ff9f1c',
  '#ffd166',
  '#06d6a0',
  '#118ab2',
  '#9b5de5',
  '#ef476f',
  '#7bd389',
  '#5cc8ff',
  '#f4a261',
] as const;

const DEFAULT_SETTINGS: AppSettings = {
  fontSize: 13,
  paneOpacity: 0.8,
  paneWidth: 720,
};

function createInitialPanes(): PaneData[] {
  return [
    { id: 'p1', title: null, terminalTitle: bridge.defaultTabTitle, cwd: bridge.defaultCwd, accent: '#ff6b57' },
    { id: 'p2', title: null, terminalTitle: bridge.defaultTabTitle, cwd: bridge.defaultCwd, accent: '#ff9f1c' },
    { id: 'p3', title: null, terminalTitle: bridge.defaultTabTitle, cwd: bridge.defaultCwd, accent: '#ffd166' },
  ];
}

/* ── Mutable application state ── */

export const state = {
  panes: createInitialPanes(),
  focusedPaneId: 'p1' as string | null,
  nextPaneNumber: 4,
  renamingPaneId: null as string | null,
  dragState: null as DragState | null,
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
  statusHint: null! as HTMLElement,
  addPaneButton: null! as HTMLButtonElement,
  settingsButton: null! as HTMLButtonElement,
  settingsPanel: null! as HTMLElement,
  fontSizeInput: null! as HTMLInputElement,
  paneWidthRange: null! as HTMLInputElement,
  paneWidthInput: null! as HTMLInputElement,
  paneWidthValue: null! as HTMLElement,
  paneOpacityRange: null! as HTMLInputElement,
  paneOpacityInput: null! as HTMLInputElement,
  paneOpacityValue: null! as HTMLElement,
};

export function initDom(): void {
  dom = {
    stage: document.getElementById('stage')!,
    tabsList: document.getElementById('tabs-list')!,
    statusLabel: document.getElementById('status-label')!,
    statusHint: document.getElementById('status-hint')!,
    addPaneButton: document.getElementById('tabs-add') as HTMLButtonElement,
    settingsButton: document.getElementById('tabs-settings') as HTMLButtonElement,
    settingsPanel: document.getElementById('settings-panel')!,
    fontSizeInput: document.getElementById('font-size-input') as HTMLInputElement,
    paneWidthRange: document.getElementById('pane-width-range') as HTMLInputElement,
    paneWidthInput: document.getElementById('pane-width-input') as HTMLInputElement,
    paneWidthValue: document.getElementById('pane-width-value')!,
    paneOpacityRange: document.getElementById('pane-opacity-range') as HTMLInputElement,
    paneOpacityInput: document.getElementById('pane-opacity-input') as HTMLInputElement,
    paneOpacityValue: document.getElementById('pane-opacity-value')!,
  };
}

/* ── Helpers ── */

export function getPaneLabel(pane: PaneData): string {
  return pane.title ?? pane.terminalTitle ?? '';
}

export function getFocusedIndex(): number {
  const index = state.panes.findIndex((p) => p.id === state.focusedPaneId);
  if (index !== -1) return index;

  state.focusedPaneId = state.panes[0]?.id ?? null;
  return state.panes.length > 0 ? 0 : -1;
}
