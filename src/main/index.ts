import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  type OpenDialogOptions,
} from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { registerPtyHandlers, destroyAllSessions } from './pty-manager';
import { loadSettings, saveSettings } from './settings-store';
import {
  applyPendingUpdate,
  initAutoUpdater,
  checkForUpdatesManual,
  registerUpdaterIpcHandlers,
} from './updater';

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
  ipcMain.handle('flowdeck:settings-save', (event, settings) => {
    saveSettings(settings);
    // Notify all other windows that settings changed
    const senderWebContents = event.sender;
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win.webContents !== senderWebContents) {
        win.webContents.send('flowdeck:settings-changed');
      }
    }
  });
}

let settingsWindow: BrowserWindow | null = null;

function configureAboutPanel(): void {
  if (process.platform !== 'darwin') return;

  const currentVersion = app.getVersion();
  app.setAboutPanelOptions({
    applicationName: app.name,
    applicationVersion: currentVersion,
    version: currentVersion,
  });
}

function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  const saved = loadSettings();
  const themeMode = saved.themeMode;
  const resolvedLight =
    themeMode === 'light' ||
    (themeMode !== 'dark' && !nativeTheme.shouldUseDarkColors);
  const themeHash = resolvedLight ? 'light' : 'dark';

  settingsWindow = new BrowserWindow({
    width: 560,
    height: 760,
    resizable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: resolvedLight ? '#f1ede0' : '#1c1d22',
    title: 'Settings',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
    },
  });

  settingsWindow.once('ready-to-show', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.show();
  });

  settingsWindow.loadFile(
    path.join(__dirname, '..', 'renderer', 'settings-window.html'),
    { hash: themeHash },
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

function confirmQuit(win?: BrowserWindow | null): boolean {
  const dialogOptions = {
    type: 'question' as const,
    buttons: ['Cancel', 'Quit'],
    defaultId: 1,
    cancelId: 0,
    title: 'Quit FlowDeck',
    message: 'Are you sure you want to quit? All sessions will be closed.',
  };
  const choice =
    win && !win.isDestroyed()
      ? dialog.showMessageBoxSync(win, dialogOptions)
      : dialog.showMessageBoxSync(dialogOptions);
  return choice === 1;
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
              {
                label: 'Check for Updates...',
                click: () => checkForUpdatesManual(),
              },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              {
                label: 'Quit FlowDeck',
                accelerator: 'Cmd+Q',
                click: () => {
                  if (confirmQuit(BrowserWindow.getFocusedWindow())) {
                    app.quit();
                  }
                },
              },
            ],
          },
        ]
      : []),
    {
      label: 'Shell',
      submenu: [
        {
          label: 'New Window',
          accelerator: isMac ? 'Cmd+N' : 'Ctrl+N',
          click: () => createWindow(),
        },
        { type: 'separator' },
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
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
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
              { type: 'separator' as const },
              {
                label: 'Check for Updates...',
                click: () => checkForUpdatesManual(),
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
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 10 },
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
  // Apply staged asar update before anything else (will relaunch if found)
  if (applyPendingUpdate()) return;

  ensurePtyHelper();
  registerPtyHandlers();
  registerSettingsHandlers();
  registerUpdaterIpcHandlers();
  configureAboutPanel();
  buildAppMenu();
  initAutoUpdater();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  destroyAllSessions();
});

ipcMain.handle('flowdeck:select-directory', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const openDialogOptions: OpenDialogOptions = {
    title: 'Select Directory',
    properties: ['openDirectory', 'createDirectory'],
  };
  const result = win
    ? await dialog.showOpenDialog(win, openDialogOptions)
    : await dialog.showOpenDialog(openDialogOptions);
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('flowdeck:confirm-quit', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return confirmQuit(win);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
