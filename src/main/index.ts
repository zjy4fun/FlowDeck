import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
  type OpenDialogOptions,
} from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { registerPtyHandlers, destroyAllSessions } from './pty-manager';
import { handleWindowAllClosed } from './window-lifecycle';
import { flushSettingsSync, loadSettings, saveSettings } from './settings-store';
import { getDeveloperContext } from './developer-context';
import { generateAiShellCommand } from './ai-command-generator';
import {
  applyPendingUpdate,
  initAutoUpdater,
  checkForUpdatesManual,
  registerUpdaterIpcHandlers,
} from './updater';
import { createAboutDialogOptions } from './about-dialog';
import { getWindowIconPath, shouldToggleFullScreenForInput } from './window-options';
import {
  createSearchUrl,
  createTranslateUrl,
  sanitizeExternalUrl,
  sanitizeTerminalContextMenuRequest,
} from './terminal-context-menu';

const isCaptureMode = process.env.FLOWDECK_CAPTURE === '1';
let pendingConfirmQuit: Promise<boolean> | null = null;

function registerSettingsHandlers(): void {
  ipcMain.handle('flowdeck:settings-load', () => loadSettings());
  ipcMain.handle('flowdeck:settings-save', (event, settings) => {
    const savePromise = saveSettings(settings);
    // Notify all other windows that settings changed
    const senderWebContents = event.sender;
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win.webContents !== senderWebContents) {
        win.webContents.send('flowdeck:settings-changed');
      }
    }
    return savePromise;
  });
  ipcMain.handle('flowdeck:developer-context', (_event, payload) => getDeveloperContext(payload));
  ipcMain.handle('flowdeck:ai-generate-command', (_event, payload) =>
    generateAiShellCommand(payload),
  );
}

function registerWindowHandlers(): void {
  ipcMain.handle('flowdeck:window-toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });
}

function registerTerminalContextMenuHandler(): void {
  ipcMain.handle('flowdeck:terminal-context-menu', (event, payload) => {
    const request = sanitizeTerminalContextMenuRequest(payload);
    if (!request) return;

    const win = BrowserWindow.fromWebContents(event.sender);
    const hasSelection = request.selectedText.length > 0;
    const pasteText = clipboard.readText();

    const menu = Menu.buildFromTemplate([
      {
        label: 'Copy',
        enabled: hasSelection,
        click: () => clipboard.writeText(request.selectedText),
      },
      {
        label: 'Paste',
        enabled: pasteText.length > 0,
        click: () => {
          event.sender.send('flowdeck:terminal-context-menu-action', {
            type: 'paste',
            paneId: request.paneId,
            text: pasteText,
          });
        },
      },
      { type: 'separator' },
      {
        label: 'Search',
        enabled: hasSelection,
        click: () => {
          void shell.openExternal(createSearchUrl(request.selectedText));
        },
      },
      {
        label: 'Translate Selection',
        enabled: hasSelection,
        click: () => {
          void shell.openExternal(createTranslateUrl(request.selectedText));
        },
      },
    ]);

    menu.popup(win ? { window: win } : undefined);
  });

  ipcMain.handle('flowdeck:open-external-url', async (_event, payload) => {
    const url = sanitizeExternalUrl(payload);
    if (!url) return false;
    await shell.openExternal(url);
    return true;
  });
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
  if (process.platform === 'darwin') return;

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

async function confirmQuit(win?: BrowserWindow | null): Promise<boolean> {
  if (pendingConfirmQuit) return pendingConfirmQuit;

  const dialogOptions = {
    type: 'question' as const,
    buttons: ['Cancel', 'Quit'],
    defaultId: 1,
    cancelId: 0,
    title: 'Quit FlowDeck',
    message: 'Are you sure you want to quit? All sessions will be closed.',
  };

  pendingConfirmQuit = (async () => {
    const result =
      win && !win.isDestroyed()
        ? await dialog.showMessageBox(win, dialogOptions)
        : await dialog.showMessageBox(dialogOptions);
    return result.response === 1;
  })();

  try {
    return await pendingConfirmQuit;
  } finally {
    pendingConfirmQuit = null;
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
                  void confirmQuit(BrowserWindow.getFocusedWindow()).then((confirmed) => {
                    if (confirmed) app.quit();
                  });
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
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#282a36' : '#e9e6dc',
    ...platformWindowChromeOptions(),
    ...(icon ? { icon } : {}),
    autoHideMenuBar: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
    },
  });

  win.once('ready-to-show', () => {
    if (!isCaptureMode && !win.isDestroyed()) {
      win.show();
    }
  });

  if (!app.isPackaged) {
    win.webContents.on('console-message', (_e, level, msg, line, src) => {
      console.log(`renderer[${level}] ${src}:${line} ${msg}`);
    });
  }

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

  registerPtyHandlers();
  registerSettingsHandlers();
  registerWindowHandlers();
  registerTerminalContextMenuHandler();
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
  flushSettingsSync();
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
