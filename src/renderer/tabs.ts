import type { PaneData } from './types';
import { state, dom, getFocusedIndex, getPaneLabel } from './state';

/* ── Callbacks provided by the app layer ── */

export interface TabActions {
  focusPane: (paneId: string) => void;
  closePane: (index: number) => void | Promise<void>;
  addPaneFromSelectedDirectory: () => void | Promise<void>;
  render: () => void;
}

let actions: TabActions;
const UNICODE_WORK_FRAMES = ['◐', '◓', '◑', '◒'] as const;
const UNICODE_WORK_FRAME_INTERVAL_MS = 110;
const workingPaneIds = new Set<string>();
type PaneAttentionKind = 'done' | 'confirm';
const attentionByPaneId = new Map<string, PaneAttentionKind>();
let unicodeWorkFrameIndex = 0;
let unicodeWorkTimerId: number | null = null;

function stopUnicodeWorkLoop(): void {
  if (unicodeWorkTimerId !== null) {
    window.clearInterval(unicodeWorkTimerId);
    unicodeWorkTimerId = null;
  }
  unicodeWorkFrameIndex = 0;
}

function startUnicodeWorkLoop(): void {
  if (unicodeWorkTimerId !== null) return;

  unicodeWorkTimerId = window.setInterval(() => {
    if (workingPaneIds.size === 0) {
      stopUnicodeWorkLoop();
      return;
    }

    unicodeWorkFrameIndex = (unicodeWorkFrameIndex + 1) % UNICODE_WORK_FRAMES.length;
    renderTabs();
  }, UNICODE_WORK_FRAME_INTERVAL_MS);
}

function getUnicodeWorkFrame(): string {
  return UNICODE_WORK_FRAMES[unicodeWorkFrameIndex] ?? UNICODE_WORK_FRAMES[0];
}

export function setPaneWorkingIndicator(paneId: string, isWorking: boolean): void {
  let changed = false;

  if (isWorking) {
    if (!workingPaneIds.has(paneId)) {
      workingPaneIds.add(paneId);
      changed = true;
    }
    if (attentionByPaneId.delete(paneId)) {
      changed = true;
    }
    startUnicodeWorkLoop();
  } else {
    if (workingPaneIds.delete(paneId)) {
      changed = true;
    }
    if (workingPaneIds.size === 0) {
      stopUnicodeWorkLoop();
    }
  }

  if (changed) {
    renderTabs();
  }
}

export function clearPaneWorkingIndicator(paneId: string): void {
  setPaneWorkingIndicator(paneId, false);
}

export function setPaneAttentionIndicator(
  paneId: string,
  kind: PaneAttentionKind,
): void {
  let changed = false;
  if (workingPaneIds.has(paneId)) {
    workingPaneIds.delete(paneId);
    changed = true;
    if (workingPaneIds.size === 0) {
      stopUnicodeWorkLoop();
    }
  }
  if (attentionByPaneId.get(paneId) !== kind) {
    attentionByPaneId.set(paneId, kind);
    changed = true;
  }
  if (changed) {
    renderTabs();
  }
}

export function clearPaneAttentionIndicator(paneId: string): void {
  if (!attentionByPaneId.delete(paneId)) return;
  renderTabs();
}

export function clearAllPaneWorkingIndicators(): void {
  if (workingPaneIds.size === 0) {
    stopUnicodeWorkLoop();
    return;
  }

  workingPaneIds.clear();
  stopUnicodeWorkLoop();
  renderTabs();
}

export function clearAllPaneAttentionIndicators(): void {
  if (attentionByPaneId.size === 0) return;
  attentionByPaneId.clear();
  renderTabs();
}

export function initTabs(tabActions: TabActions): void {
  actions = tabActions;
}

/* ── Rename ── */

function beginRename(index: number): void {
  const pane = state.panes[index];
  if (!pane) return;
  clearPendingTabFocus();
  state.renamingPaneId = pane.id;
  actions.render();
}

function commitRename(paneId: string, nextTitle: string): void {
  const trimmed = nextTitle.trim();
  state.renamingPaneId = null;
  state.panes = state.panes.map((p) =>
    p.id === paneId ? { ...p, title: trimmed || null } : p,
  );
  actions.render();
}

function cancelRename(): void {
  state.renamingPaneId = null;
  actions.render();
}

/* ── Pending tab focus (double-click detection) ── */

export function clearPendingTabFocus(): void {
  if (!state.pendingTabFocus) return;
  window.clearTimeout(state.pendingTabFocus.timerId);
  state.pendingTabFocus = null;
}

function scheduleTabFocus(paneId: string): void {
  clearPendingTabFocus();
  state.pendingTabFocus = {
    paneId,
    timerId: window.setTimeout(() => {
      state.pendingTabFocus = null;
      actions.focusPane(paneId);
    }, 180),
  };
}

function activateTabPointerUp(paneId: string): void {
  if (state.pendingTabFocus?.paneId === paneId) {
    clearPendingTabFocus();
    const index = state.panes.findIndex((p) => p.id === paneId);
    if (index !== -1) beginRename(index);
    return;
  }
  scheduleTabFocus(paneId);
}

/* ── Drag and drop ── */

function getTabDropIndex(clientX: number): number {
  const tabs = [...dom.tabsList.querySelectorAll('.tab')].filter(
    (el) => (el as HTMLElement).dataset.paneId !== state.dragState?.paneId,
  );
  let slot = 0;
  for (const tab of tabs) {
    const rect = tab.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) return slot;
    slot += 1;
  }
  return slot;
}

function handlePointerMove(event: PointerEvent): void {
  const drag = state.dragState;
  if (!drag || event.pointerId !== drag.pointerId) return;

  drag.currentX = event.clientX;
  const hasMoved = Math.abs(drag.currentX - drag.startX) > 4;
  if (!hasMoved && !drag.hasMoved) return;

  drag.hasMoved = true;
  drag.dropIndex = getTabDropIndex(event.clientX);
  renderTabs(); // only re-render tab bar during drag (lightweight)
}

function endDrag(): void {
  state.dragState = null;
  document.body.classList.remove('is-dragging-tabs');
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerup', handlePointerUp);
  window.removeEventListener('pointercancel', handlePointerUp);
}

export { endDrag as endTabDrag };

function handlePointerUp(event: PointerEvent): void {
  const drag = state.dragState;
  if (!drag || event.pointerId !== drag.pointerId) return;

  const { paneId, dropIndex, hasMoved } = drag;
  endDrag();

  if (!hasMoved) {
    activateTabPointerUp(paneId);
    return;
  }

  const pane = state.panes.find((p) => p.id === paneId);
  if (!pane) return;

  const next = state.panes.filter((p) => p.id !== paneId);
  const insertAt = Math.max(0, Math.min(dropIndex, next.length));
  next.splice(insertAt, 0, pane);
  state.panes = next;
  actions.render();
}

function beginDrag(index: number, event: PointerEvent): void {
  if (event.button !== 0 || state.renamingPaneId !== null) return;

  const pane = state.panes[index];
  if (!pane) return;

  event.preventDefault();
  state.dragState = {
    paneId: pane.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    currentX: event.clientX,
    dropIndex: index,
    hasMoved: false,
  };

  document.body.classList.add('is-dragging-tabs');
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerUp);
}

/* ── Tab element creation ── */

interface DragMeta {
  isDragging: boolean;
  insertBefore: boolean;
  offsetX: number;
}

function createTabElement(
  pane: PaneData,
  index: number,
  focusedIndex: number,
  dragMeta: DragMeta,
): HTMLElement {
  const tab = document.createElement('div');
  tab.className = `tab${index === focusedIndex ? ' is-focused' : ''}`;
  if (dragMeta.isDragging) {
    tab.classList.add('is-dragging');
    tab.style.transform = `translateX(${dragMeta.offsetX}px)`;
  }
  if (dragMeta.insertBefore) {
    tab.classList.add('insert-before');
  }
  tab.style.setProperty('--pane-accent', pane.accent);
  tab.dataset.paneId = pane.id;

  // Main clickable area
  const tabMain = document.createElement('button');
  tabMain.type = 'button';
  tabMain.className = 'tab-main';
  tabMain.setAttribute('aria-pressed', String(index === focusedIndex));
  tabMain.addEventListener('pointerdown', (e) => beginDrag(index, e));
  tabMain.addEventListener('dblclick', (e) => {
    e.preventDefault();
    beginRename(index);
  });

  // Label or rename input
  let label: HTMLElement;
  if (state.renamingPaneId === pane.id) {
    const input = document.createElement('input');
    input.className = 'tab-input';
    input.type = 'text';
    input.value = getPaneLabel(pane);
    input.setAttribute('aria-label', `Rename tab ${pane.id}`);
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commitRename(pane.id, input.value);
      if (e.key === 'Escape') cancelRename();
    });
    input.addEventListener('blur', () => commitRename(pane.id, input.value));
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    label = input;
  } else {
    const span = document.createElement('span');
    span.className = 'tab-label';
    const labelText = document.createElement('span');
    labelText.className = 'tab-label-text';
    labelText.textContent = getPaneLabel(pane);

    if (workingPaneIds.has(pane.id)) {
      const indicator = document.createElement('span');
      indicator.className = 'tab-busy-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      indicator.textContent = getUnicodeWorkFrame();
      span.append(indicator);
    } else {
      const attention = attentionByPaneId.get(pane.id);
      if (attention) {
        const indicator = document.createElement('span');
        indicator.className =
          `tab-attention-indicator${attention === 'confirm' ? ' is-confirm' : ' is-done'}`;
        indicator.setAttribute('aria-hidden', 'true');
        indicator.textContent = attention === 'confirm' ? '?' : '✓';
        span.append(indicator);
      }
    }

    span.append(labelText);
    label = span;
  }

  // Keyboard shortcut hint
  const shortcut = document.createElement('span');
  shortcut.className = 'tab-shortcut';
  shortcut.textContent = `\u2318${index + 1}`;

  // Close button
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'tab-close';
  close.textContent = 'x';
  close.setAttribute('aria-label', `Close tab ${pane.id}`);
  close.disabled = false;
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    actions.closePane(index);
  });

  tabMain.append(label, shortcut);
  tab.append(tabMain, close);
  return tab;
}

function createAddPaneButton(): HTMLButtonElement {
  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'tab-add-slot';
  addButton.textContent = '+';
  addButton.setAttribute('aria-label', 'Add tab from directory');
  addButton.addEventListener('click', () => {
    clearPendingTabFocus();
    void actions.addPaneFromSelectedDirectory();
  });
  return addButton;
}

/* ── Render ── */

export function renderTabs(): void {
  const focusedIndex = getFocusedIndex();
  const draggedId = state.dragState?.paneId ?? null;
  let slot = 0;

  const tabElements = state.panes.map((pane, index) => {
    const isDragging =
      pane.id === draggedId && (state.dragState?.hasMoved ?? false);
    const insertBefore =
      !isDragging &&
      (state.dragState?.hasMoved ?? false) &&
      state.dragState?.dropIndex === slot;

    const meta: DragMeta = {
      isDragging,
      insertBefore: Boolean(insertBefore),
      offsetX: isDragging
        ? state.dragState!.currentX - state.dragState!.startX
        : 0,
    };

    if (!isDragging) slot += 1;
    return createTabElement(pane, index, focusedIndex, meta);
  });

  tabElements.push(createAddPaneButton());
  dom.tabsList.replaceChildren(...tabElements);
}
