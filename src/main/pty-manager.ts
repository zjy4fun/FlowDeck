import { ipcMain, webContents, type WebContents } from 'electron';
import * as fs from 'fs';
import { homedir } from 'os';
import * as path from 'path';
import type * as Pty from 'node-pty';
import { createTerminalDataBatcher } from './terminal-data-batcher';

interface TerminalSession {
  paneId: string;
  pty: Pty.IPty;
  webContentsId: number;
  unackedBytes: number;
  isPaused: boolean;
}

const sessions = new Map<string, TerminalSession>();
const warnedWebContentsIds = new Set<number>();
const registeredWebContentsIds = new Set<number>();
const PTY_PAUSE_HIGH_WATER_BYTES = 1024 * 1024;
const PTY_RESUME_LOW_WATER_BYTES = 256 * 1024;

let ptyModule: typeof Pty | null = null;
let ptyHelperEnsured = false;

const terminalDataBatcher = createTerminalDataBatcher({
  send: (sessionKey, data) => {
    const session = sessions.get(sessionKey);
    if (!session) return;
    const targetWebContents = session.webContentsId
      ? webContents.fromId(session.webContentsId)
      : null;
    if (!targetWebContents || targetWebContents.isDestroyed()) return;
    targetWebContents.send('flowdeck:terminal-data', {
      paneId: session.paneId,
      data,
    });
  },
});

function ensurePtyHelper(): void {
  if (ptyHelperEnsured) return;
  ptyHelperEnsured = true;
  if (process.platform !== 'darwin') return;

  const helperPath = path.join(
    path.dirname(require.resolve('node-pty/package.json')),
    'prebuilds',
    process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64',
    'spawn-helper',
  );

  try {
    fs.chmodSync(helperPath, 0o755);
  } catch {
    /* helper may not exist on this arch */
  }
}

function getPtyModule(): typeof Pty {
  if (!ptyModule) {
    ensurePtyHelper();
    ptyModule = require('node-pty') as typeof Pty;
  }
  return ptyModule;
}

function getSessionKey(webContentsId: number, paneId: string): string {
  return `${webContentsId}:${paneId}`;
}

function getPayloadPaneId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const paneId = (payload as { paneId?: unknown }).paneId;
  return typeof paneId === 'string' && paneId.length > 0 ? paneId : null;
}

function getPayloadString(payload: unknown, key: string): string {
  if (!payload || typeof payload !== 'object') return '';
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function getPayloadNumber(payload: unknown, key: string): number {
  if (!payload || typeof payload !== 'object') return 0;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isUtf8Locale(value: string | undefined): boolean {
  return Boolean(value && /utf-?8/i.test(value));
}

function buildSpawnEnv(extraEnv: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    // Keep terminal sessions closer to normal terminal apps and avoid
    // inheriting host-specific orchestration flags.
    if (key.startsWith('CODEX_')) continue;
    env[key] = value;
  }
  const nextEnv: Record<string, string> = {
    ...env,
    COLORTERM: 'truecolor',
    TERM: 'xterm-256color',
    ...extraEnv,
  };

  // GUI-launched Electron apps can inherit a sparse/non-UTF locale. Make the
  // PTY advertise UTF-8 so shell tools emit Unicode instead of lossy fallback.
  if (!isUtf8Locale(nextEnv.LANG)) nextEnv.LANG = 'en_US.UTF-8';
  if (!isUtf8Locale(nextEnv.LC_ALL) && !isUtf8Locale(nextEnv.LC_CTYPE)) {
    nextEnv.LC_CTYPE = 'en_US.UTF-8';
  }

  return nextEnv;
}

function buildRestrictedHostNotice(): string | null {
  if (process.platform !== 'darwin') return null;

  const reasons: string[] = [];
  if (process.env.CODEX_SANDBOX) {
    reasons.push(`CODEX_SANDBOX=${process.env.CODEX_SANDBOX}`);
  }
  if (process.env.APP_SANDBOX_CONTAINER_ID) {
    reasons.push('APP_SANDBOX_CONTAINER_ID');
  }
  if (reasons.length === 0) return null;

  const prefix = '\x1b[38;5;214m[FlowDeck notice]\x1b[0m';
  return [
    '',
    `${prefix} Restricted host environment detected: ${reasons.join(', ')}.`,
    `${prefix} GUI apps launched from this terminal may fail at startup (for example Electron SIGABRT on macOS).`,
    `${prefix} For iTerm-like behavior, start FlowDeck outside the sandbox (Finder, Launchpad, Terminal, or iTerm).`,
    '',
  ].join('\r\n');
}

function isFlowdeckIntegrationZdotdir(value: string): boolean {
  if (!value) return false;
  const normalized = value.replace(/\\/g, '/');
  return normalized.includes('/shell-integration/zsh');
}

function resolveIntegrationDir(): string {
  const bundledDir = path.join(__dirname, 'shell-integration');
  const unpackedDir = bundledDir.replace(
    `${path.sep}app.asar${path.sep}`,
    `${path.sep}app.asar.unpacked${path.sep}`,
  );
  if (fs.existsSync(unpackedDir)) {
    return unpackedDir;
  }
  return bundledDir;
}

function getShellConfig(): { shell: string; args: string[]; env: Record<string, string> } {
  const integrationDir = resolveIntegrationDir();
  const extraEnv: Record<string, string> = { TERM_PROGRAM: 'FlowDeck' };

  if (process.platform === 'win32') {
    return { shell: 'powershell.exe', args: [], env: extraEnv };
  }

  const shell = process.env.SHELL || '/bin/zsh';
  const shellName = path.basename(shell);

  if (shellName === 'zsh') {
    const zshDir = path.join(integrationDir, 'zsh');
    const zshEnvPath = path.join(zshDir, '.zshenv');
    if (fs.existsSync(zshEnvPath)) {
      const originalZdotdir = process.env.ZDOTDIR || '';
      extraEnv.FLOWDECK_ORIGINAL_ZDOTDIR = isFlowdeckIntegrationZdotdir(originalZdotdir)
        ? ''
        : originalZdotdir;
      extraEnv.ZDOTDIR = zshDir;
    }
    return { shell, args: ['-il'], env: extraEnv };
  }

  if (shellName === 'bash') {
    const rcFile = path.join(integrationDir, 'bash-integration.bash');
    if (fs.existsSync(rcFile)) {
      return { shell, args: ['--rcfile', rcFile, '-i'], env: extraEnv };
    }
    return { shell, args: ['-il'], env: extraEnv };
  }

  return { shell, args: ['-il'], env: extraEnv };
}

function resetFlowControl(session: TerminalSession): void {
  session.unackedBytes = 0;
  if (!session.isPaused) return;
  session.isPaused = false;
  try {
    session.pty.resume();
  } catch {
    /* already closed */
  }
}

function pauseSessionIfNeeded(session: TerminalSession): void {
  if (session.isPaused || session.unackedBytes < PTY_PAUSE_HIGH_WATER_BYTES) return;
  try {
    session.pty.pause();
    session.isPaused = true;
  } catch {
    /* PTY may have exited */
  }
}

function resumeSessionIfNeeded(session: TerminalSession): void {
  if (!session.isPaused || session.unackedBytes > PTY_RESUME_LOW_WATER_BYTES) return;
  try {
    session.pty.resume();
    session.isPaused = false;
  } catch {
    /* PTY may have exited */
  }
}

function destroySessionByKey(sessionKey: string): void {
  const session = sessions.get(sessionKey);
  if (!session) return;
  terminalDataBatcher.deletePane(sessionKey);
  resetFlowControl(session);
  try {
    session.pty.kill();
  } catch {
    /* already exited */
  }
  sessions.delete(sessionKey);
}

function destroySession(webContentsId: number, paneId: string): void {
  destroySessionByKey(getSessionKey(webContentsId, paneId));
}

function destroySessionsForWebContents(webContentsId: number): void {
  for (const [sessionKey, session] of Array.from(sessions.entries())) {
    if (session.webContentsId === webContentsId) {
      destroySessionByKey(sessionKey);
    }
  }
}

function registerWebContentsSessionCleanup(contents: WebContents): void {
  if (registeredWebContentsIds.has(contents.id)) return;
  registeredWebContentsIds.add(contents.id);

  contents.once('destroyed', () => {
    destroySessionsForWebContents(contents.id);
    warnedWebContentsIds.delete(contents.id);
    registeredWebContentsIds.delete(contents.id);
  });

  contents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace) return;
    destroySessionsForWebContents(contents.id);
  });
}

export function destroyAllSessions(): void {
  for (const sessionKey of Array.from(sessions.keys())) {
    destroySessionByKey(sessionKey);
  }
}

export function registerPtyHandlers(): void {
  ipcMain.handle('flowdeck:terminal-create', (event, payload) => {
    const paneId = getPayloadPaneId(payload);
    if (!paneId) {
      throw new Error('Invalid terminal pane id');
    }
    const cols = getPayloadNumber(payload, 'cols');
    const rows = getPayloadNumber(payload, 'rows');
    const cwd = getPayloadString(payload, 'cwd');

    const { shell, args, env: extraEnv } = getShellConfig();
    const sender: WebContents = event.sender;
    const sessionKey = getSessionKey(sender.id, paneId);
    destroySessionByKey(sessionKey);
    registerWebContentsSessionCleanup(sender);

    const pty = getPtyModule();

    const terminal = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: Math.max(20, cols || 80),
      rows: Math.max(8, rows || 24),
      cwd: cwd || homedir(),
      env: buildSpawnEnv(extraEnv),
    });

    sessions.set(sessionKey, {
      paneId,
      pty: terminal,
      webContentsId: sender.id,
      unackedBytes: 0,
      isPaused: false,
    });

    terminal.onData((data) => {
      const session = sessions.get(sessionKey);
      if (!session) return;
      session.unackedBytes += Buffer.byteLength(data);
      terminalDataBatcher.queue(sessionKey, data);
      pauseSessionIfNeeded(session);
    });

    terminal.onExit(({ exitCode }) => {
      const session = sessions.get(sessionKey);
      terminalDataBatcher.flushPane(sessionKey);
      if (session) {
        resetFlowControl(session);
      }
      sessions.delete(sessionKey);
      if (!sender.isDestroyed()) {
        sender.send('flowdeck:terminal-exit', { paneId, exitCode });
      }
    });

    const restrictedHostNotice = buildRestrictedHostNotice();
    if (
      restrictedHostNotice &&
      !sender.isDestroyed() &&
      !warnedWebContentsIds.has(sender.id)
    ) {
      warnedWebContentsIds.add(sender.id);
      sender.send('flowdeck:terminal-data', {
        paneId,
        data: restrictedHostNotice,
      });
    }

    return { paneId };
  });

  ipcMain.on('flowdeck:terminal-write', (event, payload) => {
    const paneId = getPayloadPaneId(payload);
    const data = getPayloadString(payload, 'data');
    if (!paneId || !data) return;
    sessions.get(getSessionKey(event.sender.id, paneId))?.pty.write(data);
  });

  ipcMain.on('flowdeck:terminal-resize', (event, payload) => {
    const paneId = getPayloadPaneId(payload);
    if (!paneId) return;
    const cols = getPayloadNumber(payload, 'cols');
    const rows = getPayloadNumber(payload, 'rows');
    sessions.get(getSessionKey(event.sender.id, paneId))?.pty.resize(
      Math.max(20, cols || 80),
      Math.max(8, rows || 24),
    );
  });

  ipcMain.handle('flowdeck:terminal-destroy', (_event, { paneId }) => {
    if (typeof paneId !== 'string') return;
    destroySession(_event.sender.id, paneId);
  });

  ipcMain.on('flowdeck:terminal-data-ack', (event, payload) => {
    const paneId = getPayloadPaneId(payload);
    if (!paneId) return;
    const bytes = getPayloadNumber(payload, 'bytes');
    if (bytes <= 0) return;
    const session = sessions.get(getSessionKey(event.sender.id, paneId));
    if (!session) return;
    session.unackedBytes = Math.max(0, session.unackedBytes - bytes);
    resumeSessionIfNeeded(session);
  });
}
