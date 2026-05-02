import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type OpenDialogOptions,
} from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { registerPtyHandlers, destroyAllSessions } from './pty-manager';
import { handleWindowAllClosed } from './window-lifecycle';
import { loadSettings, saveSettings } from './settings-store';
import { getDeveloperContext } from './developer-context';
import {
  applyPendingUpdate,
  initAutoUpdater,
  checkForUpdatesManual,
  registerUpdaterIpcHandlers,
} from './updater';
import { createAboutDialogOptions } from './about-dialog';
import { getWindowIconPath, shouldToggleFullScreenForInput } from './window-options';

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
  ipcMain.handle('flowdeck:developer-context', (_event, payload) => getDeveloperContext(payload));
}

function configureAboutPanel(): void {
  if (process.platform !== 'darwin') return;

  const currentVersion = app.getVersion();
  app.setAboutPanelOptions({
    applicationName: app.name,
    applicationVersion: currentVersion,
    version: currentVersion,
  });
}

function showAboutDialog(): void {
  const options = createAboutDialogOptions({
    appName: app.name,
    currentVersion: app.getVersion(),
  });
  const win = BrowserWindow.getFocusedWindow();
  if (win && !win.isDestroyed()) {
    void dialog.showMessageBox(win, options);
    return;
  }
  void dialog.showMessageBox(options);
}

function sendToFocusedWindow(channel: string): void {
  const win = BrowserWindow.getFocusedWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel);
  }
}

function currentWindowIconPath(): string | undefined {
  return getWindowIconPath({
    platform: process.platform,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
  });
}

function platformWindowChromeOptions(): Electron.BrowserWindowConstructorOptions {
  if (process.platform !== 'darwin') return {};
  return {
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 10 },
  };
}

function registerFullScreenShortcuts(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (
      !shouldToggleFullScreenForInput({
        platform: process.platform,
        key: input.key,
        isFullScreen: win.isFullScreen(),
      })
    ) {
      return;
    }

    event.preventDefault();
    if (input.key === 'Escape') {
      win.setFullScreen(false);
      return;
    }

    win.setFullScreen(!win.isFullScreen());
  });
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
            label: 'Help',
            submenu: [
              {
                label: 'Check for Updates...',
                click: () => checkForUpdatesManual(),
              },
              { type: 'separator' as const },
              {
                label: 'About FlowDeck',
                click: () => showAboutDialog(),
              },
            ],
          },
        ]
      : []),
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
  const icon = currentWindowIconPath();
  const win = new BrowserWindow({
    width: 1600,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#111111',
    ...platformWindowChromeOptions(),
    ...(icon ? { icon } : {}),
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
  registerFullScreenShortcuts(win);

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
  handleWindowAllClosed({
    platform: process.platform,
    destroyAllSessions,
    quit: () => app.quit(),
  });
});
