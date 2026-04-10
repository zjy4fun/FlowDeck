import { app, BrowserWindow, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { registerPtyHandlers, destroyAllSessions } from './pty-manager';
import { loadSettings, saveSettings } from './settings-store';

const isCaptureMode = process.env.FLOWDECK_CAPTURE === '1';

function ensurePtyHelper(): void {
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

function registerSettingsHandlers(): void {
  ipcMain.handle('flowdeck:settings-load', () => loadSettings());
  ipcMain.handle('flowdeck:settings-save', (_event, settings) => saveSettings(settings));
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1600,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#111111',
    autoHideMenuBar: true,
    show: !isCaptureMode,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
    },
  });

  win.webContents.on('console-message', (_e, level, msg, line, src) => {
    console.log(`renderer[${level}] ${src}:${line} ${msg}`);
  });

  win.webContents.on('preload-error', (_e, preloadPath, err) => {
    console.error(`preload-error ${preloadPath}`, err);
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (isCaptureMode) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const snapshot = await win.webContents.executeJavaScript(`
            (() => ({
              tabs: document.getElementById('tabs-list')?.childElementCount ?? -1,
              status: document.getElementById('status-label')?.textContent ?? null,
              bodyText: document.body.innerText.slice(0, 200),
              hasRendererApi: typeof window.flowdeck !== 'undefined'
            }))()
          `);
          console.log('capture-snapshot', JSON.stringify(snapshot));
        } catch (err) {
          console.error('capture-snapshot-error', err);
        }
        const image = await win.webContents.capturePage();
        fs.writeFileSync('/tmp/flowdeck-prototype.png', image.toPNG());
        app.quit();
      }, 2500);
    });
  }
}

app.whenReady().then(() => {
  ensurePtyHelper();
  registerPtyHandlers();
  registerSettingsHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', destroyAllSessions);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
