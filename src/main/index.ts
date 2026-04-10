import { app, BrowserWindow, ipcMain, Menu } from 'electron';
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

let settingsWindow: BrowserWindow | null = null;

function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 420,
    resizable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: '#151515',
    title: 'Settings',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
    },
  });

  settingsWindow.loadFile(
    path.join(__dirname, '..', 'renderer', 'settings-window.html'),
  );

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function sendToFocusedWindow(channel: string): void {
  const win = BrowserWindow.getFocusedWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel);
  }
}

function buildAppMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: 'Settings...',
                accelerator: 'Cmd+,',
                click: () => openSettingsWindow(),
              },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'Shell',
      submenu: [
        {
          label: 'New Tab',
          accelerator: isMac ? 'Cmd+T' : 'Ctrl+T',
          click: () => sendToFocusedWindow('flowdeck:menu-new-tab'),
        },
        {
          label: 'Close Tab',
          accelerator: isMac ? 'Cmd+W' : 'Ctrl+W',
          click: () => sendToFocusedWindow('flowdeck:menu-close-tab'),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
    ...(!isMac
      ? [
          {
            label: 'Settings',
            submenu: [
              {
                label: 'Preferences...',
                accelerator: 'Ctrl+,',
                click: () => openSettingsWindow(),
              },
            ],
          },
        ]
      : []),
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1600,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#111111',
    autoHideMenuBar: false,
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

  // Prevent Cmd+W from closing the window — let the renderer handle it as "close tab"
  win.webContents.on('before-input-event', (_event, input) => {
    if (
      input.type === 'keyDown' &&
      input.key.toLowerCase() === 'w' &&
      input.meta &&
      !input.control &&
      !input.alt
    ) {
      _event.preventDefault();
    }
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
  buildAppMenu();
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
