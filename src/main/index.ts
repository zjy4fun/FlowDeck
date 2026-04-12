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

type UsageProvider = 'codex' | 'claude-code';

interface UsageQuotaSnapshot {
  provider: UsageProvider;
  sessionUsedPercent: number | null;
  sessionResetsAt: number | null;
  weeklyUsedPercent: number | null;
  weeklyResetsAt: number | null;
  sessionInputTokens: number | null;
  sessionOutputTokens: number | null;
  sessionTotalTokens: number | null;
  queriedAt: string;
}

interface UsageWindow {
  usedPercent: number | null;
  resetsAt: number | null;
}

interface UsageQuotaRecord {
  session: UsageWindow;
  weekly: UsageWindow;
}

interface ClaudeTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

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

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function toPercent(value: unknown): number | null {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return null;
  return Math.max(0, Math.min(100, numeric));
}

function toEpochSeconds(value: unknown): number | null {
  const numeric = toFiniteNumber(value);
  if (numeric === null || numeric <= 0) return null;
  return Math.floor(numeric);
}

function toNonNegativeInteger(value: unknown): number | null {
  const numeric = toFiniteNumber(value);
  if (numeric === null || numeric < 0) return null;
  return Math.floor(numeric);
}

function listJsonlFilesByMtime(rootDirectory: string): string[] {
  if (!fs.existsSync(rootDirectory)) return [];

  const candidates: Array<{ filePath: string; mtimeMs: number }> = [];
  const stack = [rootDirectory];

  while (stack.length > 0) {
    const directory = stack.pop()!;
    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;

      try {
        const stats = fs.statSync(fullPath);
        candidates.push({ filePath: fullPath, mtimeMs: stats.mtimeMs });
      } catch {
        /* ignore files that cannot be stat-ed */
      }
    }
  }

  return candidates
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((entry) => entry.filePath);
}

function readLatestUsageRecord(
  filePath: string,
  extractor: (entry: Record<string, unknown>) => UsageQuotaRecord | null,
): UsageQuotaRecord | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const lines = content.split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const entry = toRecord(parsed);
    if (!entry) continue;

    const usage = extractor(entry);
    if (usage) return usage;
  }

  return null;
}

function findLatestUsageRecord(
  rootDirectory: string,
  extractor: (entry: Record<string, unknown>) => UsageQuotaRecord | null,
): UsageQuotaRecord | null {
  const recentFiles = listJsonlFilesByMtime(rootDirectory);
  for (const filePath of recentFiles) {
    const usageRecord = readLatestUsageRecord(filePath, extractor);
    if (usageRecord) return usageRecord;
  }
  return null;
}

function extractCodexUsage(entry: Record<string, unknown>): UsageQuotaRecord | null {
  const payload = toRecord(entry.payload);
  const rateLimits = payload ? toRecord(payload.rate_limits) : null;
  if (!rateLimits) return null;

  const primary = toRecord(rateLimits.primary);
  const secondary = toRecord(rateLimits.secondary);
  if (!primary && !secondary) return null;

  return {
    session: {
      usedPercent: toPercent(primary?.used_percent),
      resetsAt: toEpochSeconds(primary?.resets_at),
    },
    weekly: {
      usedPercent: toPercent(secondary?.used_percent),
      resetsAt: toEpochSeconds(secondary?.resets_at),
    },
  };
}

function extractClaudeUsage(entry: Record<string, unknown>): UsageQuotaRecord | null {
  const directRateLimits = toRecord(entry.rate_limits);
  const messageRateLimits = toRecord(toRecord(entry.message)?.rate_limits);
  const messageUsageRateLimits = toRecord(
    toRecord(toRecord(entry.message)?.usage)?.rate_limits,
  );
  const dataRateLimits = toRecord(toRecord(entry.data)?.rate_limits);

  const rateLimits =
    directRateLimits ??
    messageRateLimits ??
    messageUsageRateLimits ??
    dataRateLimits;
  if (!rateLimits) return null;

  const fiveHour = toRecord(rateLimits.five_hour) ?? toRecord(rateLimits.primary);
  const sevenDay = toRecord(rateLimits.seven_day) ?? toRecord(rateLimits.secondary);
  if (!fiveHour && !sevenDay) return null;

  return {
    session: {
      usedPercent: toPercent(fiveHour?.used_percentage ?? fiveHour?.used_percent),
      resetsAt: toEpochSeconds(fiveHour?.resets_at),
    },
    weekly: {
      usedPercent: toPercent(sevenDay?.used_percentage ?? sevenDay?.used_percent),
      resetsAt: toEpochSeconds(sevenDay?.resets_at),
    },
  };
}

function extractClaudeTokenUsageFromEntry(
  entry: Record<string, unknown>,
): { inputTokens: number; outputTokens: number } | null {
  const messageUsage = toRecord(toRecord(entry.message)?.usage);
  const directUsage = toRecord(entry.usage);
  const dataUsage = toRecord(toRecord(entry.data)?.usage);
  const usage = messageUsage ?? directUsage ?? dataUsage;
  if (!usage) return null;

  const inputTokens = toNonNegativeInteger(usage.input_tokens);
  const outputTokens = toNonNegativeInteger(usage.output_tokens);
  if (inputTokens === null && outputTokens === null) return null;

  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
  };
}

function readClaudeTokenUsage(filePath: string): ClaudeTokenUsage | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let hasUsage = false;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const entry = toRecord(parsed);
    if (!entry) continue;

    const tokenUsage = extractClaudeTokenUsageFromEntry(entry);
    if (!tokenUsage) continue;

    inputTokens += tokenUsage.inputTokens;
    outputTokens += tokenUsage.outputTokens;
    hasUsage = true;
  }

  if (!hasUsage) return null;

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

function findLatestClaudeTokenUsage(rootDirectory: string): ClaudeTokenUsage | null {
  const recentFiles = listJsonlFilesByMtime(rootDirectory);
  for (const filePath of recentFiles) {
    const usage = readClaudeTokenUsage(filePath);
    if (usage) return usage;
  }
  return null;
}

function emptyUsageQuota(provider: UsageProvider): UsageQuotaSnapshot {
  return {
    provider,
    sessionUsedPercent: null,
    sessionResetsAt: null,
    weeklyUsedPercent: null,
    weeklyResetsAt: null,
    sessionInputTokens: null,
    sessionOutputTokens: null,
    sessionTotalTokens: null,
    queriedAt: new Date().toISOString(),
  };
}

function loadUsageQuotaSnapshot(provider: UsageProvider): UsageQuotaSnapshot {
  const rootDirectory =
    provider === 'claude-code'
      ? path.join(app.getPath('home'), '.claude', 'projects')
      : path.join(app.getPath('home'), '.codex', 'sessions');
  const usageRecord = findLatestUsageRecord(
    rootDirectory,
    provider === 'claude-code' ? extractClaudeUsage : extractCodexUsage,
  );
  const tokenUsage =
    provider === 'claude-code'
      ? findLatestClaudeTokenUsage(rootDirectory)
      : null;
  if (!usageRecord && !tokenUsage) return emptyUsageQuota(provider);

  return {
    provider,
    sessionUsedPercent: usageRecord?.session.usedPercent ?? null,
    sessionResetsAt: usageRecord?.session.resetsAt ?? null,
    weeklyUsedPercent: usageRecord?.weekly.usedPercent ?? null,
    weeklyResetsAt: usageRecord?.weekly.resetsAt ?? null,
    sessionInputTokens: tokenUsage?.inputTokens ?? null,
    sessionOutputTokens: tokenUsage?.outputTokens ?? null,
    sessionTotalTokens: tokenUsage?.totalTokens ?? null,
    queriedAt: new Date().toISOString(),
  };
}

function registerUsageQuotaHandlers(): void {
  ipcMain.handle('flowdeck:usage-quota-load', (_event, rawProvider) => {
    const provider: UsageProvider = rawProvider === 'claude-code'
      ? 'claude-code'
      : 'codex';
    return loadUsageQuotaSnapshot(provider);
  });
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
                click: () => app.quit(),
              },
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
  registerUsageQuotaHandlers();
  registerUpdaterIpcHandlers();
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
  if (!win || win.isDestroyed()) return true;

  const choice = dialog.showMessageBoxSync(win, {
    type: 'question',
    buttons: ['Cancel', 'Quit'],
    defaultId: 1,
    cancelId: 0,
    title: 'Quit FlowDeck',
    message: 'Are you sure you want to quit? All sessions will be closed.',
  });
  return choice === 1;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
