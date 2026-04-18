import { ipcMain, webContents, type WebContents } from 'electron';
import * as fs from 'fs';
import { homedir } from 'os';
import * as path from 'path';
import * as pty from 'node-pty';
import { createTerminalDataBatcher } from './terminal-data-batcher';

interface TerminalSession {
  pty: pty.IPty;
  webContentsId: number;
}

const sessions = new Map<string, TerminalSession>();
const warnedWebContentsIds = new Set<number>();
const terminalDataBatcher = createTerminalDataBatcher({
  send: (paneId, data) => {
    const session = sessions.get(paneId);
    if (!session) return;
    const targetWebContents = session.webContentsId
      ? webContents.fromId(session.webContentsId)
      : null;
    if (!targetWebContents || targetWebContents.isDestroyed()) return;
    targetWebContents.send('flowdeck:terminal-data', { paneId, data });
  },
});

function buildSpawnEnv(extraEnv: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    // Keep terminal sessions closer to normal terminal apps and avoid
    // inheriting host-specific orchestration flags.
    if (key.startsWith('CODEX_')) continue;
    env[key] = value;
  }
  return {
    ...env,
    COLORTERM: 'truecolor',
    TERM: 'xterm-256color',
    ...extraEnv,
  };
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

function destroySession(paneId: string): void {
  const session = sessions.get(paneId);
  if (!session) return;
  terminalDataBatcher.deletePane(paneId);
  try {
    session.pty.kill();
  } catch {
    /* already exited */
  }
  sessions.delete(paneId);
}

export function destroyAllSessions(): void {
  for (const paneId of sessions.keys()) {
    destroySession(paneId);
  }
}

export function registerPtyHandlers(): void {
  ipcMain.handle('flowdeck:terminal-create', (event, payload) => {
    const { paneId, cols, rows, cwd } = payload;
    destroySession(paneId);

    const { shell, args, env: extraEnv } = getShellConfig();
    const webContents: WebContents = event.sender;

    const terminal = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: Math.max(20, cols || 80),
      rows: Math.max(8, rows || 24),
      cwd: cwd || homedir(),
      env: buildSpawnEnv(extraEnv),
    });

    terminal.onData((data) => {
      terminalDataBatcher.queue(paneId, data);
    });

    terminal.onExit(({ exitCode }) => {
      terminalDataBatcher.flushPane(paneId);
      sessions.delete(paneId);
      if (!webContents.isDestroyed()) {
        webContents.send('flowdeck:terminal-exit', { paneId, exitCode });
      }
    });

    sessions.set(paneId, { pty: terminal, webContentsId: webContents.id });

    const restrictedHostNotice = buildRestrictedHostNotice();
    if (
      restrictedHostNotice &&
      !webContents.isDestroyed() &&
      !warnedWebContentsIds.has(webContents.id)
    ) {
      warnedWebContentsIds.add(webContents.id);
      webContents.once('destroyed', () => {
        warnedWebContentsIds.delete(webContents.id);
      });
      webContents.send('flowdeck:terminal-data', {
        paneId,
        data: restrictedHostNotice,
      });
    }

    return { paneId };
  });

  ipcMain.handle('flowdeck:terminal-write', (_event, { paneId, data }) => {
    sessions.get(paneId)?.pty.write(data);
  });

  ipcMain.handle('flowdeck:terminal-resize', (_event, { paneId, cols, rows }) => {
    sessions.get(paneId)?.pty.resize(
      Math.max(20, cols || 80),
      Math.max(8, rows || 24),
    );
  });

  ipcMain.handle('flowdeck:terminal-destroy', (_event, { paneId }) => {
    destroySession(paneId);
  });
}
