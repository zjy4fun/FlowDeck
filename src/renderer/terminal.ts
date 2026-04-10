import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import type { PaneData, PaneNode } from './types';
import { state } from './state';
import { bridge } from './bridge';

/* ── Theme ── */

export function createTerminalTheme(accent: string) {
  return {
    background: '#11111100',
    foreground: '#d9d4c7',
    cursor: accent,
    cursorAccent: '#111111',
    selectionBackground: `${accent}44`,
    black: '#111111',
    red: '#ff6b57',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#d9d4c7',
    brightBlack: '#5a6374',
    brightRed: '#ff8578',
    brightGreen: '#b0d98b',
    brightYellow: '#f0d58a',
    brightBlue: '#7eb7ff',
    brightMagenta: '#d9a5e8',
    brightCyan: '#7fd8e6',
    brightWhite: '#ffffff',
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

  surface.append(terminalHost);
  body.append(surface);
  shell.append(body);
  paneEl.append(shell);

  // xterm.js instance
  const terminal = new Terminal({
    allowTransparency: true,
    convertEol: true,
    cursorBlink: true,
    disableStdin: false,
    drawBoldTextInBrightColors: false,
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
}
