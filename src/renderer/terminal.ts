import { Terminal } from '@xterm/xterm';
import type { IBufferLine, ILink, ILinkProvider } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { PaneData, PaneNode, ResolvedTheme } from './types';
import { state, getResolvedTheme } from './state';
import { bridge } from './bridge';

/* ── Theme ── */

function getCursorAccentColor(cursorColor: string, mode: ResolvedTheme): string {
  const fallback = mode === 'light' ? '#4c4f69' : '#c6d0f5';
  const hex = cursorColor.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return fallback;

  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;

  if (mode === 'light') {
    return luminance > 0.58 ? '#e9e6dc' : '#4c4f69';
  }
  return luminance > 0.58 ? '#232634' : '#c6d0f5';
}

// Catppuccin Frappe (dark)
const DARK_PALETTE = {
  background: '#303446',
  foreground: '#c6d0f5',
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
  // Lift the dim/"bright black" tone from Surface2 to Overlay0 so comments and
  // de-emphasized text clear ~2.9:1 instead of the barely-legible ~2.2:1.
  brightBlack: '#737994',
  brightRed: '#e78284',
  brightGreen: '#a6d189',
  brightYellow: '#e5c890',
  brightBlue: '#8caaee',
  brightMagenta: '#f4b8e4',
  brightCyan: '#81c8be',
  brightWhite: '#b5bfe2',
};

// Catppuccin Latte (light)
const LIGHT_PALETTE = {
  background: '#e9e6dc',
  foreground: '#4c4f69',
  selectionBackground: '#c9c3b5',
  selectionForeground: '#4c4f69',
  black: '#4c4f69',
  red: '#d20f39',
  green: '#40a02b',
  yellow: '#df8e1d',
  blue: '#1e66f5',
  magenta: '#ea76cb',
  cyan: '#179299',
  // On a light background the Catppuccin "white" greys (Surface1/2) sit at
  // ~1.5:1 contrast, so any app that paints text in ANSI white/bright-white
  // (code blocks, dim labels, prompts) becomes nearly invisible. Remap the
  // grey ramp to the darker Latte text tones so that text stays legible while
  // keeping a sensible dark→light ordering (black < brightWhite < brightBlack
  // < white).
  white: '#7c7f93',
  brightBlack: '#6c6f85',
  brightRed: '#d20f39',
  brightGreen: '#40a02b',
  brightYellow: '#df8e1d',
  brightBlue: '#1e66f5',
  brightMagenta: '#ea76cb',
  brightCyan: '#179299',
  brightWhite: '#5c5f77',
};

const TERMINAL_SCROLLBAR_WIDTH = 6;
const TERMINAL_MIN_COLS = 20;
const TERMINAL_MIN_ROWS = 8;
const TERMINAL_TRAILING_SAFE_COLUMNS = 2;
export const TERMINAL_FONT_FAMILY = [
  '"SF Mono"',
  'SFMono-Regular',
  'Menlo',
  'Monaco',
  'Consolas',
  '"Liberation Mono"',
  '"DejaVu Sans Mono"',
  '"Symbols Nerd Font Mono"',
  '"Noto Sans Mono CJK SC"',
  '"Noto Sans Mono CJK TC"',
  '"Noto Sans Mono CJK JP"',
  '"Noto Sans CJK SC"',
  '"PingFang SC"',
  '"Hiragino Sans GB"',
  '"Microsoft YaHei UI"',
  '"Noto Sans Symbols 2"',
  '"Segoe UI Symbol"',
  '"Apple Symbols"',
  '"Noto Color Emoji"',
  '"Apple Color Emoji"',
  'monospace',
].join(', ');
const URL_PATTERN = /https?:\/\/[^\s<>'"`]+/gi;
const URL_TRAILING_PUNCTUATION = /[),.;:!?]+$/;

export function getTerminalBackground(mode?: ResolvedTheme): string {
  const resolved = mode ?? getResolvedTheme();
  return (resolved === 'light' ? LIGHT_PALETTE : DARK_PALETTE).background;
}

export function createTerminalTheme(accent: string, mode?: ResolvedTheme) {
  const resolved = mode ?? getResolvedTheme();
  const palette = resolved === 'light' ? LIGHT_PALETTE : DARK_PALETTE;
  return {
    ...palette,
    cursor: accent,
    cursorAccent: getCursorAccentColor(accent, resolved),
    overviewRulerBorder: palette.background,
  };
}

function getCellColumnByStringIndex(line: IBufferLine, targetIndex: number): number | null {
  let stringIndex = 0;
  const limit = Math.min(line.length, Number.MAX_SAFE_INTEGER);

  for (let cellIndex = 0; cellIndex < limit; cellIndex += 1) {
    const cell = line.getCell(cellIndex);
    if (!cell || cell.getWidth() === 0) continue;

    const chars = cell.getChars() || ' ';
    if (targetIndex < stringIndex + chars.length) {
      return cellIndex + 1;
    }
    stringIndex += chars.length;
  }

  return null;
}

function stripTrailingUrlPunctuation(url: string): string {
  return url.replace(URL_TRAILING_PUNCTUATION, '');
}

function createTerminalLinkProvider(
  terminal: Terminal,
  onHover: (url: string) => void,
  onLeave: (url: string) => void,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const line = terminal.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }

      const text = line.translateToString(true);
      const links: ILink[] = [];
      for (const match of text.matchAll(URL_PATTERN)) {
        const rawUrl = match[0];
        const url = stripTrailingUrlPunctuation(rawUrl);
        if (!url) continue;

        const startIndex = match.index ?? 0;
        const endIndex = startIndex + url.length - 1;
        const startColumn = getCellColumnByStringIndex(line, startIndex) ?? startIndex + 1;
        const endColumn = getCellColumnByStringIndex(line, endIndex) ?? startColumn + url.length - 1;

        links.push({
          range: {
            start: { x: startColumn, y: bufferLineNumber },
            end: { x: endColumn, y: bufferLineNumber },
          },
          text: url,
          decorations: {
            pointerCursor: true,
            underline: true,
          },
          activate(event, nextUrl) {
            if (event.metaKey || event.ctrlKey) {
              void bridge.openExternalUrl({ url: nextUrl });
            }
          },
          hover(_event, nextUrl) {
            onHover(nextUrl);
          },
          leave(_event, nextUrl) {
            onLeave(nextUrl);
          },
        });
      }

      callback(links.length > 0 ? links : undefined);
    },
  };
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

  const developerToolbar = document.createElement('div');
  developerToolbar.className = 'developer-toolbar';
  developerToolbar.dataset.paneId = pane.id;

  const aiToolbar = document.createElement('div');
  aiToolbar.className = 'ai-toolbar';
  aiToolbar.dataset.paneId = pane.id;

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
  shell.append(developerToolbar);
  shell.append(aiToolbar);
  shell.append(body);
  paneEl.append(shell);

  // xterm.js instance
  const terminal = new Terminal({
    allowTransparency: false,
    convertEol: true,
    cursorBlink: true,
    disableStdin: false,
    drawBoldTextInBrightColors: true,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: state.settings.fontSize,
    lineHeight: 1.2,
    overviewRuler: { width: TERMINAL_SCROLLBAR_WIDTH },
    scrollback: 5000,
    theme: createTerminalTheme(pane.accent),
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(terminalHost);

  // Keep xterm on its built-in browser renderer. The WebGL glyph atlas is fast,
  // but it does not reliably use platform font fallback for CJK, box-drawing,
  // emoji, and private-use symbols, which shows up as tofu boxes or mojibake.
  const webglAddon = null;
  let hoveredUrl: string | null = null;

  terminal.registerLinkProvider(
    createTerminalLinkProvider(
      terminal,
      (nextUrl) => {
        hoveredUrl = nextUrl;
      },
      (nextUrl) => {
        if (hoveredUrl === nextUrl) hoveredUrl = null;
      },
    ),
  );

  const node: PaneNode = {
    paneId: pane.id,
    cwd: pane.cwd,
    root: paneEl,
    developerToolbar,
    aiToolbar,
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

  terminalHost.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    node.terminal.focus();
    void bridge.showTerminalContextMenu({
      paneId: node.paneId,
      selectedText: node.terminal.getSelection(),
    });
  });

  return node;
}

/* ── Fit / resize ── */

export function fitTerminal(node: PaneNode, force = false): void {
  node.terminal.options.fontSize = state.settings.fontSize;
  const proposedDimensions = node.fitAddon.proposeDimensions();

  if (
    proposedDimensions &&
    !isNaN(proposedDimensions.cols) &&
    !isNaN(proposedDimensions.rows)
  ) {
    const cols = Math.max(
      TERMINAL_MIN_COLS,
      proposedDimensions.cols - TERMINAL_TRAILING_SAFE_COLUMNS,
    );
    const rows = Math.max(TERMINAL_MIN_ROWS, proposedDimensions.rows);
    if (node.terminal.cols !== cols || node.terminal.rows !== rows) {
      node.terminal.resize(cols, rows);
    }
  } else {
    node.fitAddon.fit();
  }

  const cols = Math.max(TERMINAL_MIN_COLS, node.terminal.cols || 80);
  const rows = Math.max(TERMINAL_MIN_ROWS, node.terminal.rows || 24);
  const nextSizeKey = `${cols}x${rows}`;

  if (node.sessionReady && (force || nextSizeKey !== node.sizeKey)) {
    bridge.resizeTerminal({ paneId: node.paneId, cols, rows });
  }

  node.sizeKey = nextSizeKey;
  node.needsFit = false;
}

export function refocusTerminal(
  node: PaneNode,
  options: { refit?: boolean; forceBlur?: boolean } = {},
): void {
  const { refit = false, forceBlur = false } = options;
  let needsRefit = refit;

  const applyFocus = (): void => {
    if (!node.root.isConnected) return;
    if (needsRefit) {
      fitTerminal(node, true);
      needsRefit = false;
    }

    const textarea = node.terminal.textarea;
    if (!textarea?.isConnected) return;

    // xterm can keep its hidden textarea as document.activeElement after the
    // app returns from the background. Force a blur/focus cycle to revive input.
    if (forceBlur && document.activeElement === textarea) {
      textarea.blur();
    }

    node.terminal.focus();
  };

  requestAnimationFrame(() => {
    applyFocus();
    if (forceBlur) {
      window.setTimeout(() => {
        if (!document.hidden) {
          applyFocus();
        }
      }, 0);
    }
  });
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
    refocusTerminal(node);
  }
}
