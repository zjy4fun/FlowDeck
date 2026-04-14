import { bridge } from '../bridge';
import { state, paneNodeMap, getFocusedIndex } from '../state';
import type { NavigationDeps } from '../types';

export interface NavigationController {
  enterNavigationMode: () => void;
  moveFocus: (delta: number) => void;
  handleGlobalKeydown: (event: KeyboardEvent) => void;
}

export function createNavigationController(
  deps: NavigationDeps,
): NavigationController {
  function isImeCompositionEvent(event: KeyboardEvent): boolean {
    if (event.isComposing) return true;

    const key = event.key.toLowerCase();
    return key === 'process' || key === 'dead' || event.keyCode === 229;
  }

  function blurFocusedTerminal(): void {
    if (!state.focusedPaneId) return;
    const node = paneNodeMap.get(state.focusedPaneId);
    if (node) node.terminal.blur();
  }

  function enterNavigationMode(): void {
    if (state.panes.length === 0) return;
    state.isNavigationMode = true;
    blurFocusedTerminal();
    deps.render();
  }

  function moveFocus(delta: number): void {
    if (state.panes.length === 0) return;
    const current = getFocusedIndex();
    const next = (current + delta + state.panes.length) % state.panes.length;
    state.focusedPaneId = state.panes[next].id;
    deps.render();
  }

  function isEditableTarget(): boolean {
    const activeElement = document.activeElement as HTMLElement | null;
    if (!activeElement) return false;

    if (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.tagName === 'SELECT'
    ) {
      return true;
    }

    return (
      activeElement.isContentEditable ||
      activeElement.classList.contains('xterm-helper-textarea')
    );
  }

  function handleGlobalKeydown(event: KeyboardEvent): void {
    if (isImeCompositionEvent(event)) return;

    const key = event.key.toLowerCase();
    const isMac = bridge.platform === 'darwin';

    const isAddTab = isMac
      ? event.metaKey && !event.ctrlKey && !event.altKey && key === 't'
      : event.ctrlKey && !event.metaKey && !event.altKey && key === 't';

    const isCloseTab = isMac
      ? event.metaKey && !event.ctrlKey && !event.altKey && key === 'w'
      : event.ctrlKey && !event.metaKey && !event.altKey && key === 'w';

    const isNavigation =
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      key === 'b';

    // Cmd+1~9 (macOS) / Ctrl+1~9 switch tab
    const hasModifier = isMac ? event.metaKey && !event.ctrlKey && !event.altKey : event.ctrlKey && !event.metaKey && !event.altKey;
    if (hasModifier) {
      const num = parseInt(key, 10);
      if (num >= 1 && num <= 9) {
        const targetIndex = num - 1;
        if (targetIndex < state.panes.length) {
          event.preventDefault();
          deps.focusPane(state.panes[targetIndex].id);
        }
        return;
      }
    }

    // Ctrl+Tab / Ctrl+Shift+Tab cycle tabs
    if (event.ctrlKey && !event.metaKey && !event.altKey && key === 'tab') {
      event.preventDefault();
      event.stopImmediatePropagation();
      moveFocus(event.shiftKey ? -1 : 1);
      if (state.focusedPaneId) deps.focusPane(state.focusedPaneId);
      return;
    }

    if (isAddTab) {
      event.preventDefault();
      deps.addPane();
      return;
    }

    if (isCloseTab) {
      event.preventDefault();
      const focusedIndex = getFocusedIndex();
      if (focusedIndex !== -1) {
        deps.closePane(focusedIndex);
      }
      return;
    }

    if (isNavigation && !isEditableTarget()) {
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
      if (state.focusedPaneId) deps.focusPane(state.focusedPaneId);
    }
  }

  return {
    enterNavigationMode,
    moveFocus,
    handleGlobalKeydown,
  };
}
