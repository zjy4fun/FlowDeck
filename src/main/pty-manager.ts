import { ipcMain, type WebContents } from 'electron';
import * as pty from 'node-pty';

interface TerminalSession {
  pty: pty.IPty;
  webContentsId: number;
}

const sessions = new Map<string, TerminalSession>();

function getShellConfig(): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    return { shell: 'powershell.exe', args: [] };
  }
  return { shell: process.env.SHELL || '/bin/zsh', args: ['-il'] };
}

function destroySession(paneId: string): void {
  const session = sessions.get(paneId);
  if (!session) return;
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

    const { shell, args } = getShellConfig();
    const webContents: WebContents = event.sender;

    const terminal = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: Math.max(20, cols || 80),
      rows: Math.max(8, rows || 24),
      cwd: cwd || process.cwd(),
      env: {
        ...process.env,
        COLORTERM: 'truecolor',
        TERM: 'xterm-256color',
      },
    });

    terminal.onData((data) => {
      if (!webContents.isDestroyed()) {
        webContents.send('flowdeck:terminal-data', { paneId, data });
      }
    });

    terminal.onExit(({ exitCode }) => {
      sessions.delete(paneId);
      if (!webContents.isDestroyed()) {
        webContents.send('flowdeck:terminal-exit', { paneId, exitCode });
      }
    });

    sessions.set(paneId, { pty: terminal, webContentsId: webContents.id });
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
