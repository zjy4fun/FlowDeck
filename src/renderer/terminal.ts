import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import type { PaneData, PaneNode } from './types';
import { state } from './state';
import { bridge } from './bridge';

/* ── Theme ── */

function getCursorAccentColor(cursorColor: string): string {
  const hex = cursorColor.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return '#c6d0f5';

  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;

  return luminance > 0.58 ? '#232634' : '#c6d0f5';
}

export function createTerminalTheme(accent: string) {
  return {
    // Ghostty-like dark palette (based on Catppuccin Frappe)
    background: '#303446',
    foreground: '#c6d0f5',
    cursor: accent,
    cursorAccent: getCursorAccentColor(accent),
    selectionBackground: '#44495d',
    selectionForeground: '#c6d0f5',
    black: '#51576d',
    red: '#e78284',
    green: '#a6d189',
    yellow: '#e5c890',
    blue: '#8caaee',
    magenta: '#f4b8e4',
    cyan: '#81c8be',
    white: '#a5adce',
    brightBlack: '#626880',
    brightRed: '#e78284',
    brightGreen: '#a6d189',
    brightYellow: '#e5c890',
    brightBlue: '#8caaee',
    brightMagenta: '#f4b8e4',
    brightCyan: '#81c8be',
    brightWhite: '#b5bfe2',
  };
}

/* ── WebGL addon (graceful fallback) ── */

function tryAttachWebgl(terminal: Terminal): WebglAddon | null {
  try {
    const addon = new WebglAddon();
    addon.onContextLoss(() => addon.dispose());
    terminal.loadAddon(addon);
    return addon;
  } catch {
    return null;
  }
}

/* ── Node creation ── */

export function createPaneNode(
  pane: PaneData,
  onTitleChange: (paneId: string, title: string) => void,
): PaneNode {
  // DOM scaffolding
  const paneEl = document.createElement('article');
  paneEl.className = 'pane';
  paneEl.style.setProperty('--pane-accent', pane.accent);

  const shell = document.createElement('div');
  shell.className = 'pane-shell';

  const body = document.createElement('div');
  body.className = 'pane-body';

  const surface = document.createElement('div');
  surface.className = 'pane-surface';

  const terminalHost = document.createElement('div');
  terminalHost.className = 'terminal-host';

  const leftResizeHandle = document.createElement('div');
  leftResizeHandle.className = 'pane-resize-handle is-left';
  leftResizeHandle.setAttribute('aria-hidden', 'true');

  const rightResizeHandle = document.createElement('div');
  rightResizeHandle.className = 'pane-resize-handle is-right';
  rightResizeHandle.setAttribute('aria-hidden', 'true');

  const occlusionShield = document.createElement('div');
  occlusionShield.className = 'pane-occlusion-shield';
  occlusionShield.setAttribute('aria-hidden', 'true');

  surface.append(terminalHost);
  body.append(surface);
  body.append(occlusionShield);
  body.append(leftResizeHandle);
  body.append(rightResizeHandle);
  shell.append(body);
  paneEl.append(shell);

  // xterm.js instance
  const terminal = new Terminal({
    allowTransparency: false,
    convertEol: true,
    cursorBlink: true,
    disableStdin: false,
    drawBoldTextInBrightColors: true,
    fontFamily: 'Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    fontSize: state.settings.fontSize,
    lineHeight: 1.2,
    scrollback: 5000,
    theme: createTerminalTheme(pane.accent),
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(terminalHost);

  const webglAddon = tryAttachWebgl(terminal);

  const node: PaneNode = {
    paneId: pane.id,
    cwd: pane.cwd,
    root: paneEl,
    terminalHost,
    occlusionShield,
    leftResizeHandle,
    rightResizeHandle,
    terminal,
    fitAddon,
    webglAddon,
    sessionReady: false,
    sizeKey: '',
    needsFit: true,
    accent: pane.accent,
  };

  // Forward user input to PTY
  terminal.onData((data) => {
    if (node.sessionReady) {
      bridge.writeTerminal({ paneId: node.paneId, data });
    }
  });

  // Bubble shell title changes up to the app
  terminal.onTitleChange((nextTitle) => {
    const trimmed = nextTitle.trim();
    if (trimmed) onTitleChange(pane.id, trimmed);
  });

  return node;
}

/* ── Fit / resize ── */

export function fitTerminal(node: PaneNode, force = false): void {
  node.terminal.options.fontSize = state.settings.fontSize;
  node.fitAddon.fit();

  const cols = Math.max(20, node.terminal.cols || 80);
  const rows = Math.max(8, node.terminal.rows || 24);
  const nextSizeKey = `${cols}x${rows}`;

  if (node.sessionReady && (force || nextSizeKey !== node.sizeKey)) {
    bridge.resizeTerminal({ paneId: node.paneId, cols, rows });
  }

  node.sizeKey = nextSizeKey;
  node.needsFit = false;
}

/* ── PTY session bootstrap ── */

export async function initializePaneTerminal(node: PaneNode): Promise<void> {
  fitTerminal(node, true);
  await bridge.createTerminal({
    paneId: node.paneId,
    cols: node.terminal.cols,
    rows: node.terminal.rows,
    cwd: node.cwd,
  });
  node.sessionReady = true;
  fitTerminal(node, true);

  // Auto-focus the terminal if this is the currently focused pane
  if (state.focusedPaneId === node.paneId) {
    node.terminal.focus();
  }
}
