import type { PaneNode } from './types';
import { state, dom, paneNodeMap, getFocusedIndex } from './state';
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

export function initPanes(paneCallbacks: PaneCallbacks): void {
  callbacks = paneCallbacks;
}

/* ── Layout math ── */

function getPreviewWidth(stageWidth: number, count: number): number {
  if (count <= 1) return 0;
  const pw = state.settings.paneWidth;
  if (stageWidth >= pw * count) return pw;
  return (stageWidth - pw) / (count - 1);
}

function getPaneLeft(
  index: number,
  previewWidth: number,
  focusedIndex: number,
): number {
  const pw = state.settings.paneWidth;
  if (previewWidth >= pw) return index * pw;

  const focusedLeft = focusedIndex * previewWidth;
  if (index < focusedIndex) return index * previewWidth;
  if (index === focusedIndex) return focusedLeft;
  return focusedLeft + pw + (index - focusedIndex - 1) * previewWidth;
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
  const previewWidth = getPreviewWidth(stageWidth, state.panes.length);
  const focusedIndex = getFocusedIndex();

  ensurePaneNodes();

  state.panes.forEach((pane, index) => {
    const node = paneNodeMap.get(pane.id) as PaneNode;
    const left = getPaneLeft(index, previewWidth, focusedIndex);
    const isFocused = index === focusedIndex;

    node.root.classList.toggle('is-focused', isFocused);
    node.root.classList.toggle(
      'is-navigation-target',
      isFocused && state.isNavigationMode,
    );
    node.root.style.setProperty('--pane-accent', pane.accent);
    node.root.style.left = `${left}px`;
    node.root.style.zIndex = String(index + 1);
    node.root.style.height = `${stageHeight}px`;

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
