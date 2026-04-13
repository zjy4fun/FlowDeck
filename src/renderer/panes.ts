import type { PaneNode } from './types';
import {
  state,
  dom,
  paneNodeMap,
  getFocusedIndex,
  getFocusedPaneWidth,
} from './state';
import {
  createPaneNode,
  createTerminalTheme,
  fitTerminal,
  initializePaneTerminal,
} from './terminal';
import { bridge } from './bridge';

/* ── Callbacks provided by the app layer ── */

export interface PaneCallbacks {
  onPaneClick: (paneId: string) => void;
  onTitleChange: (paneId: string, title: string) => void;
}

let callbacks: PaneCallbacks;

const MIN_PREVIEW_WIDTH = 96;
const MIN_FOCUSED_WIDTH = 420;
type ResizeEdge = 'left' | 'right';

interface PaneLayout {
  left: number;
  width: number;
  right: number;
  isFocused: boolean;
}

export function initPanes(paneCallbacks: PaneCallbacks): void {
  callbacks = paneCallbacks;
}

/* ── Layout math ── */

function getPreviewWidth(stageWidth: number, count: number): number {
  if (count <= 1) return 0;
  const baseWidth = state.settings.paneWidth;
  const focusedWidth = getFocusedPaneWidth();
  if (stageWidth >= baseWidth * count) {
    return stageWidth / count;
  }
  return Math.max(
    MIN_PREVIEW_WIDTH,
    (stageWidth - focusedWidth) / (count - 1),
  );
}

function getPaneLeft(
  index: number,
  previewWidth: number,
  focusedIndex: number,
): number {
  const baseWidth = state.settings.paneWidth;
  const focusedWidth = getFocusedPaneWidth();
  if (previewWidth >= baseWidth) return index * previewWidth;

  const focusedLeft = focusedIndex * previewWidth;
  if (index < focusedIndex) return index * previewWidth;
  if (index === focusedIndex) return focusedLeft;
  return focusedLeft + focusedWidth + (index - focusedIndex - 1) * previewWidth;
}

function getMaxFocusedWidth(): number {
  const stageWidth = dom.stage.clientWidth;
  const remainingCount = Math.max(0, state.panes.length - 1);
  if (remainingCount === 0) return stageWidth;
  return Math.max(
    MIN_FOCUSED_WIDTH,
    stageWidth - remainingCount * MIN_PREVIEW_WIDTH,
  );
}

function updateFocusedPaneWidth(width: number): void {
  state.transientPaneWidth = Math.max(
    MIN_FOCUSED_WIDTH,
    Math.min(getMaxFocusedWidth(), Math.round(width)),
  );
  renderPanes(true);
}

function setResizeHandleActive(
  paneId: string,
  edge: ResizeEdge,
  active: boolean,
): void {
  const node = paneNodeMap.get(paneId);
  if (!node) return;
  node.root.classList.toggle('is-resizing', active);
  node.leftResizeHandle.classList.toggle(
    'is-active',
    active && edge === 'left',
  );
  node.rightResizeHandle.classList.toggle(
    'is-active',
    active && edge === 'right',
  );
}

function endPaneResize(): void {
  const resizeState = state.paneResizeState;
  if (!resizeState) return;
  setResizeHandleActive(resizeState.paneId, resizeState.edge, false);
  document.body.classList.remove('is-resizing-pane');
  state.paneResizeState = null;
  window.removeEventListener('pointermove', handlePaneResizeMove);
  window.removeEventListener('pointerup', handlePaneResizeEnd);
  window.removeEventListener('pointercancel', handlePaneResizeEnd);
}

function handlePaneResizeMove(event: PointerEvent): void {
  const resizeState = state.paneResizeState;
  if (!resizeState || event.pointerId !== resizeState.pointerId) return;
  const direction = resizeState.edge === 'right' ? 1 : -1;
  const delta = (event.clientX - resizeState.startX) * direction;
  updateFocusedPaneWidth(resizeState.startWidth + delta);
}

function handlePaneResizeEnd(event: PointerEvent): void {
  const resizeState = state.paneResizeState;
  if (!resizeState || event.pointerId !== resizeState.pointerId) return;
  endPaneResize();
}

function beginPaneResize(
  paneId: string,
  edge: ResizeEdge,
  event: PointerEvent,
): void {
  if (paneId !== state.focusedPaneId || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  state.paneResizeState = {
    paneId,
    pointerId: event.pointerId,
    edge,
    startX: event.clientX,
    startWidth: getFocusedPaneWidth(),
  };
  setResizeHandleActive(paneId, edge, true);
  document.body.classList.add('is-resizing-pane');
  window.addEventListener('pointermove', handlePaneResizeMove);
  window.addEventListener('pointerup', handlePaneResizeEnd);
  window.addEventListener('pointercancel', handlePaneResizeEnd);
}

/* ── Pane node lifecycle ── */

function ensurePaneNodes(): void {
  const activeIds = new Set(state.panes.map((p) => p.id));

  // Remove stale nodes
  for (const [paneId, node] of paneNodeMap.entries()) {
    if (!activeIds.has(paneId)) {
      bridge.destroyTerminal({ paneId });
      node.terminal.dispose();
      node.root.remove();
      paneNodeMap.delete(paneId);
    }
  }

  // Create missing nodes
  for (const pane of state.panes) {
    if (!paneNodeMap.has(pane.id)) {
      const node = createPaneNode(pane, callbacks.onTitleChange);

      node.root.addEventListener('click', () => {
        callbacks.onPaneClick(pane.id);
      });
      node.leftResizeHandle.addEventListener('pointerdown', (event) => {
        beginPaneResize(pane.id, 'left', event);
      });
      node.rightResizeHandle.addEventListener('pointerdown', (event) => {
        beginPaneResize(pane.id, 'right', event);
      });

      paneNodeMap.set(pane.id, node);
      dom.stage.append(node.root);

      requestAnimationFrame(() => {
        initializePaneTerminal(node);
      });
    }
  }
}

/* ── Render ── */

export function renderPanes(refit = false): void {
  const stageWidth = dom.stage.clientWidth;
  const stageHeight = dom.stage.clientHeight;
  const isSinglePaneLayout = state.panes.length === 1;
  const previewWidth = getPreviewWidth(stageWidth, state.panes.length);
  const focusedIndex = getFocusedIndex();
  const focusedAccent =
    focusedIndex >= 0 ? (state.panes[focusedIndex]?.accent ?? null) : null;

  ensurePaneNodes();

  const layouts = state.panes.map((_, index): PaneLayout => {
    const isFocused = index === focusedIndex;
    const shouldFillAvailableWidth = previewWidth >= state.settings.paneWidth;
    const rawWidth = isSinglePaneLayout
      ? stageWidth
      : shouldFillAvailableWidth
        ? previewWidth
      : isFocused
        ? getFocusedPaneWidth()
        : state.settings.paneWidth;
    const rawLeft = isSinglePaneLayout
      ? 0
      : getPaneLeft(index, previewWidth, focusedIndex);
    const width = Math.max(1, Math.round(rawWidth));
    const left = Math.round(rawLeft);
    return {
      left,
      width,
      right: left + width,
      isFocused,
    };
  });

  state.panes.forEach((pane, index) => {
    const node = paneNodeMap.get(pane.id) as PaneNode;
    const layout = layouts[index] as PaneLayout;
    const leftBorderColor =
      focusedAccent !== null && focusedIndex === index - 1
        ? focusedAccent
        : pane.accent;
    const rightBorderColor =
      index === state.panes.length - 1 ? pane.accent : 'transparent';

    node.root.classList.toggle('is-focused', layout.isFocused);
    node.root.classList.toggle(
      'is-navigation-target',
      layout.isFocused && state.isNavigationMode,
    );
    node.root.style.setProperty('--pane-accent', pane.accent);
    node.root.style.setProperty('--pane-border-top', pane.accent);
    node.root.style.setProperty('--pane-border-bottom', pane.accent);
    node.root.style.setProperty('--pane-border-left', leftBorderColor);
    node.root.style.setProperty('--pane-border-right', rightBorderColor);
    const nextLeft = `${layout.left}px`;
    const nextWidth = `${layout.width}px`;
    const nextHeight = `${stageHeight}px`;
    const hasSizeChange =
      node.root.style.width !== nextWidth || node.root.style.height !== nextHeight;

    node.root.style.left = nextLeft;
    node.root.style.width = nextWidth;
    node.root.style.zIndex = String(index + 1);
    node.root.style.height = nextHeight;

    if (hasSizeChange) {
      node.needsFit = true;
    }

    const occludedWidth = layout.isFocused
      ? 0
      : getOccludedWidthFromRightEdge(layouts, index);
    node.root.style.setProperty('--pane-occluded-width', `${occludedWidth}px`);

    // Sync accent color if changed
    if (node.accent !== pane.accent) {
      node.terminal.options.theme = createTerminalTheme(pane.accent);
      node.accent = pane.accent;
    }

    if (refit || node.needsFit) {
      fitTerminal(node, true);
    }
  });
}

function getOccludedWidthFromRightEdge(
  layouts: PaneLayout[],
  index: number,
): number {
  const current = layouts[index] as PaneLayout;
  let maxOccludedWidth = 0;

  for (let i = index + 1; i < layouts.length; i += 1) {
    const above = layouts[i] as PaneLayout;

    // Only panes that extend past the current pane's right edge can cover the right-edge region.
    if (above.right <= current.right) continue;
    if (above.left >= current.right) continue;

    const overlapStart = Math.max(current.left, above.left);
    const occludedWidth = current.right - overlapStart;
    if (occludedWidth > maxOccludedWidth) {
      maxOccludedWidth = occludedWidth;
    }
  }

  return Math.max(0, Math.min(current.width, Math.round(maxOccludedWidth)));
}
