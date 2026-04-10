import { bridge } from '../bridge';
import { state, dom, paneNodeMap, getFocusedIndex } from '../state';
import type { CleanupFn, LifecycleDeps } from '../types';

const OSC_MAX_BUFFER = 1024;
const OSC_7_REGEX = /\u001b]7;([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;
const OSC_1337_REGEX = /\u001b]1337;CurrentDir=([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;
const OSC_633_REGEX = /\u001b]633;P;Cwd=([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;

function decodePathValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function parseOsc7Path(raw: string): string | null {
  const value = raw.trim();
  if (!value.startsWith('file://')) return null;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'file:') return null;
    const path = decodePathValue(parsed.pathname);
    return path || '/';
  } catch {
    return null;
  }
}

function getOscTail(nextBuffer: string): string {
  const lastStart = nextBuffer.lastIndexOf('\u001b]');
  if (lastStart === -1) return '';

  const trailing = nextBuffer.slice(lastStart);
  if (trailing.includes('\u0007') || trailing.includes('\u001b\\')) return '';
  return trailing.slice(-OSC_MAX_BUFFER);
}

function getLatestMatchValue(regex: RegExp, buffer: string): string | null {
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  let latest: string | null = null;
  while ((match = regex.exec(buffer)) !== null) {
    latest = match[1] ?? null;
  }
  return latest;
}

function extractCwdFromOscBuffer(buffer: string): string | null {
  const rawOsc7 = getLatestMatchValue(OSC_7_REGEX, buffer);
  const osc7Path = rawOsc7 ? parseOsc7Path(rawOsc7) : null;
  if (osc7Path) return osc7Path;

  const rawIterm = getLatestMatchValue(OSC_1337_REGEX, buffer);
  if (rawIterm) {
    const decoded = decodePathValue(rawIterm);
    if (decoded) return decoded;
  }

  const rawVscode = getLatestMatchValue(OSC_633_REGEX, buffer);
  if (rawVscode) {
    const decoded = decodePathValue(rawVscode);
    if (decoded) return decoded;
  }

  return null;
}

export function initLifecycle(deps: LifecycleDeps): CleanupFn {
  const cleanups: CleanupFn[] = [];
  const oscTailByPaneId = new Map<string, string>();
  let disposed = false;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      cleanup?.();
    }
  };

  const removeDataListener = bridge.onTerminalData(({ paneId, data }) => {
    paneNodeMap.get(paneId)?.terminal.write(data);

    const nextBuffer = `${oscTailByPaneId.get(paneId) ?? ''}${data}`;
    const cwd = extractCwdFromOscBuffer(nextBuffer);
    if (cwd) {
      deps.handleCwdChange(paneId, cwd);
    }
    oscTailByPaneId.set(paneId, getOscTail(nextBuffer));
  });
  cleanups.push(removeDataListener);

  const removeExitListener = bridge.onTerminalExit(({ paneId, exitCode }) => {
    oscTailByPaneId.delete(paneId);
    const node = paneNodeMap.get(paneId);
    if (!node) return;
    node.sessionReady = false;
    node.terminal.writeln('');
    node.terminal.writeln(
      `\x1b[38;5;244m[process exited with code ${exitCode}]\x1b[0m`,
    );
  });
  cleanups.push(removeExitListener);

  const handleAddPaneClick = (): void => {
    try {
      deps.addPane();
    } catch (error) {
      deps.reportError(error);
    }
  };
  dom.addPaneButton.addEventListener('click', handleAddPaneClick);
  cleanups.push(() => {
    dom.addPaneButton.removeEventListener('click', handleAddPaneClick);
  });

  // Menu-driven new/close tab
  const removeMenuNewTab = bridge.onMenuNewTab(() => {
    try {
      deps.addPane();
    } catch (error) {
      deps.reportError(error);
    }
  });
  cleanups.push(removeMenuNewTab);

  const removeMenuCloseTab = bridge.onMenuCloseTab(() => {
    const focusedIndex = getFocusedIndex();
    if (focusedIndex !== -1 && state.panes.length > 1) {
      deps.closePane(focusedIndex);
    }
  });
  cleanups.push(removeMenuCloseTab);

  window.addEventListener('keydown', deps.handleGlobalKeydown, true);
  cleanups.push(() => {
    window.removeEventListener('keydown', deps.handleGlobalKeydown, true);
  });

  const handleResize = (): void => {
    try {
      deps.render(true);
    } catch (error) {
      deps.reportError(error);
    }
  };
  window.addEventListener('resize', handleResize);
  cleanups.push(() => {
    window.removeEventListener('resize', handleResize);
  });

  const handleWindowError = (event: ErrorEvent): void => {
    deps.reportError(event.error || event.message);
  };
  window.addEventListener('error', handleWindowError);
  cleanups.push(() => {
    window.removeEventListener('error', handleWindowError);
  });

  const handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    deps.reportError(event.reason);
  };
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
  cleanups.push(() => {
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  });

  const handleBeforeUnload = (): void => {
    dispose();
  };
  window.addEventListener('beforeunload', handleBeforeUnload);
  cleanups.push(() => {
    window.removeEventListener('beforeunload', handleBeforeUnload);
  });

  return dispose;
}
