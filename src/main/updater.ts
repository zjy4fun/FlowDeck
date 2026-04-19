import { spawn } from 'child_process';
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, shell } from 'electron';
// Use original-fs to bypass Electron's asar interception on .asar paths
import * as originalFs from 'original-fs';
import * as fs from 'fs';
import * as path from 'path';
import {
  resolveAvailableUpdatePlan,
  shouldCloseWindowForAction,
  type UpdateWindowAction,
} from './updater-logic';

const REPO = 'zjy4fun/FlowDeck';
const ASAR_ASSET_NAME = 'app.asar';
const UPDATE_WINDOW_CHANNEL = 'flowdeck:update-state';
const SKIPPED_UPDATE_FILE = 'skipped-update.json';
const COMPACT_UPDATE_WINDOW_SIZE = { width: 480, height: 188 };
const RELEASE_NOTES_WINDOW_SIZE = { width: 680, height: 560 };

interface UpdateWindowState {
  title: string;
  detail: string;
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
  showProgress: boolean;
  primaryAction?: UpdateWindowAction;
  primaryLabel?: string;
  secondaryAction?: UpdateWindowAction;
  secondaryLabel?: string;
  tertiaryAction?: UpdateWindowAction;
  tertiaryLabel?: string;
  badge?: string;
  notes?: string;
  notesLabel?: string;
}

interface SkippedUpdateState {
  version: string | null;
}

interface DownloadAssetOptions {
  expectedBytes: number;
  onProgress: (downloadedBytes: number, totalBytes: number) => void;
  onCancelableChange: (cancel: (() => void) | null) => void;
}

class UpdateCancelledError extends Error {
  constructor() {
    super('Update download canceled');
    this.name = 'UpdateCancelledError';
  }
}

let updateWindow: BrowserWindow | null = null;
let updateWindowState: UpdateWindowState | null = null;
let cancelActiveDownload: (() => void) | null = null;
let pendingUpdateActionResolver: ((action: UpdateWindowAction) => void) | null = null;
let pendingUpdateActionButtons = new Set<UpdateWindowAction>();
let updaterIpcRegistered = false;
let updaterLifecycleRegistered = false;
let updateApplyHelperScheduled = false;
let pendingUpdateLaunchNotice: string | null = null;

function getPendingUpdateDir(): string {
  return path.join(app.getPath('userData'), 'pending-update');
}

function getStagedAsarPath(): string {
  return path.join(getPendingUpdateDir(), 'app.asar');
}

function getInstalledAsarPath(): string {
  return path.join(process.resourcesPath, 'app.asar');
}

function getAsarBackupPath(): string {
  return path.join(getPendingUpdateDir(), 'app.asar.backup');
}

function getApplyUpdateScriptPath(): string {
  return path.join(getPendingUpdateDir(), 'apply-update.sh');
}

function getApplyUpdateLogPath(): string {
  return path.join(getPendingUpdateDir(), 'apply-update.log');
}

function getSkippedUpdateStatePath(): string {
  return path.join(app.getPath('userData'), SKIPPED_UPDATE_FILE);
}

function loadSkippedUpdateState(): SkippedUpdateState {
  try {
    const raw = fs.readFileSync(getSkippedUpdateStatePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SkippedUpdateState>;
    return {
      version: typeof parsed.version === 'string' && parsed.version.trim().length > 0
        ? parsed.version.trim()
        : null,
    };
  } catch {
    return { version: null };
  }
}

function saveSkippedUpdateState(state: SkippedUpdateState): void {
  try {
    const filePath = getSkippedUpdateStatePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('Failed to save skipped update state:', error);
  }
}

function skipVersion(version: string): void {
  saveSkippedUpdateState({ version });
}

function clearSkippedVersion(version?: string): void {
  const current = loadSkippedUpdateState();
  if (!current.version) return;
  if (version && current.version !== version) return;
  saveSkippedUpdateState({ version: null });
}

function isVersionSkipped(version: string): boolean {
  return loadSkippedUpdateState().version === version;
}

function ensurePendingUpdateDir(): void {
  const directory = getPendingUpdateDir();
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function getMacAppBundlePath(): string {
  const appBundlePath = path.resolve(process.execPath, '..', '..', '..');
  if (!appBundlePath.endsWith('.app')) {
    throw new Error(
      `Could not resolve app bundle path from executable: ${process.execPath}`,
    );
  }
  return appBundlePath;
}

function writeMacApplyUpdateScript(scriptPath: string): void {
  const script = `#!/bin/sh
set -eu

PID="$1"
STAGED="$2"
TARGET="$3"
BACKUP="$4"
APP_BUNDLE="$5"
RELAUNCH="$6"
LOG_FILE="$7"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  printf '%s %s\\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$1" >> "$LOG_FILE"
}

reopen_app() {
  if [ "$RELAUNCH" != "1" ]; then
    return
  fi
  /usr/bin/open -n "$APP_BUNDLE" >/dev/null 2>&1 || true
}

: > "$LOG_FILE"
log "waiting for pid $PID to exit"

while kill -0 "$PID" 2>/dev/null; do
  sleep 1
done

if [ ! -f "$STAGED" ]; then
  log "staged update missing: $STAGED"
  reopen_app
  exit 1
fi

if [ ! -f "$TARGET" ]; then
  log "installed app.asar missing: $TARGET"
  reopen_app
  exit 1
fi

if ! cp -f "$TARGET" "$BACKUP"; then
  log "failed to back up installed app.asar"
  reopen_app
  exit 1
fi

if ! cp -f "$STAGED" "$TARGET"; then
  STATUS=$?
  log "failed to copy staged update into place (exit $STATUS)"
  if [ -f "$BACKUP" ]; then
    cp -f "$BACKUP" "$TARGET" || true
  fi
  reopen_app
  exit "$STATUS"
fi

rm -f "$STAGED" "$BACKUP"
log "update applied successfully"
reopen_app
log "helper finished"
`;

  originalFs.writeFileSync(scriptPath, script, { mode: 0o755 });
  fs.chmodSync(scriptPath, 0o755);
}

function scheduleMacApplyUpdate(relaunchAfterApply: boolean): void {
  if (updateApplyHelperScheduled) return;

  const staged = getStagedAsarPath();
  if (!originalFs.existsSync(staged)) {
    throw new Error('No staged update was found to apply.');
  }

  ensurePendingUpdateDir();

  const scriptPath = getApplyUpdateScriptPath();
  const target = getInstalledAsarPath();
  const backup = getAsarBackupPath();
  const appBundlePath = getMacAppBundlePath();
  const logPath = getApplyUpdateLogPath();

  writeMacApplyUpdateScript(scriptPath);

  const helper = spawn(
    '/bin/sh',
    [
      scriptPath,
      String(process.pid),
      staged,
      target,
      backup,
      appBundlePath,
      relaunchAfterApply ? '1' : '0',
      logPath,
    ],
    {
      detached: true,
      stdio: 'ignore',
    },
  );

  helper.unref();
  updateApplyHelperScheduled = true;
}

function showApplyUpdateError(error: unknown): void {
  const detail = error instanceof Error ? error.message : 'Unknown error';
  dialog.showMessageBox({
    type: 'error',
    title: 'Update Error',
    message: 'Could not prepare the downloaded update for install.',
    detail: `${detail}\n\nIf this keeps happening, install the latest DMG/ZIP manually.`,
  });
}

function restartToApplyUpdate(): void {
  closeUpdateWindow();

  if (!app.isPackaged) {
    app.relaunch();
    app.exit(0);
    return;
  }

  if (process.platform === 'darwin' && originalFs.existsSync(getStagedAsarPath())) {
    scheduleMacApplyUpdate(true);
    app.quit();
    return;
  }

  app.relaunch();
  app.exit(0);
}

function showPendingUpdateLaunchNoticeIfNeeded(): void {
  if (!pendingUpdateLaunchNotice) return;

  const detail = pendingUpdateLaunchNotice;
  pendingUpdateLaunchNotice = null;

  dialog.showMessageBox({
    type: 'info',
    title: 'Downloaded Update Still Pending',
    message: 'FlowDeck still has a downloaded update waiting to be installed.',
    detail,
  });
}

function registerUpdaterLifecycleHandlers(): void {
  if (updaterLifecycleRegistered) return;
  updaterLifecycleRegistered = true;

  app.on('before-quit', () => {
    if (
      !app.isPackaged ||
      process.platform !== 'darwin' ||
      updateApplyHelperScheduled ||
      !originalFs.existsSync(getStagedAsarPath())
    ) {
      return;
    }

    try {
      scheduleMacApplyUpdate(false);
    } catch (error) {
      console.error('Failed to schedule pending update on quit:', error);
    }
  });
}

/**
 * Called at app startup BEFORE createWindow().
 * Windows keeps the original startup-swap behavior. macOS applies
 * staged updates from a detached helper after the app fully exits.
 */
export function applyPendingUpdate(): boolean {
  if (!app.isPackaged) return false;

  const staged = getStagedAsarPath();
  if (!originalFs.existsSync(staged)) return false;

  if (process.platform === 'darwin') {
    pendingUpdateLaunchNotice =
      'Quit FlowDeck completely once more to let the detached updater replace the installed app. If the version still does not change after that, install the latest DMG/ZIP manually.';
    return false;
  }

  const target = getInstalledAsarPath();
  const backup = getAsarBackupPath();

  try {
    ensurePendingUpdateDir();

    // Backup current asar
    originalFs.copyFileSync(target, backup);

    // Swap in new asar
    originalFs.copyFileSync(staged, target);
    originalFs.unlinkSync(staged);

    // Clean up backup
    try {
      originalFs.unlinkSync(backup);
    } catch {
      /* ignore */
    }

    // Relaunch with new code
    app.relaunch();
    app.exit(0);
    return true;
  } catch (err) {
    console.error('Failed to apply pending update:', err);
    // Try to restore backup
    if (originalFs.existsSync(backup)) {
      try {
        originalFs.copyFileSync(backup, target);
        originalFs.unlinkSync(backup);
      } catch {
        /* ignore */
      }
    }
    // Remove broken staged file
    try {
      originalFs.unlinkSync(staged);
    } catch {
      /* ignore */
    }
    return false;
  }
}

interface GitHubRelease {
  tag_name: string;
  body?: string;
  html_url?: string;
  assetInfoIncomplete?: boolean;
  assets: Array<{ name: string; browser_download_url: string; size: number }>;
}

class GitHubApiStatusError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'GitHubApiStatusError';
    this.statusCode = statusCode;
  }
}

function readHeaderValue(header: string | string[] | undefined): string | null {
  if (!header) return null;
  return Array.isArray(header) ? header[0] ?? null : header;
}

function parseReleaseTagFromUrl(rawUrl: string): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    const match = url.pathname.match(/\/releases\/(?:tag|download)\/([^/]+)/i);
    if (!match?.[1]) return null;
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function parseReleaseTagFromHtml(html: string): string | null {
  if (!html) return null;
  const match = html.match(/\/releases\/tag\/(v[0-9][0-9A-Za-z._-]*)/i);
  if (!match?.[1]) return null;
  return decodeURIComponent(match[1]);
}

function parseGitHubApiErrorMessage(statusCode: number, body: string): string {
  let details = '';
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      details = parsed.message.trim();
    }
  } catch {
    /* ignore JSON parse failures */
  }

  return details
    ? `GitHub API returned ${statusCode}: ${details}`
    : `GitHub API returned ${statusCode}`;
}

async function fetchLatestReleaseFromApi(): Promise<GitHubRelease> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: 'GET',
      url: `https://api.github.com/repos/${REPO}/releases/latest`,
    });
    request.setHeader('Accept', 'application/vnd.github.v3+json');
    request.setHeader('User-Agent', `FlowDeck/${app.getVersion()}`);

    let body = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => {
        body += chunk.toString();
      });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          const statusCode = response.statusCode ?? 0;
          reject(
            new GitHubApiStatusError(
              statusCode,
              parseGitHubApiErrorMessage(statusCode, body),
            ),
          );
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    request.on('error', reject);
    request.end();
  });
}

async function fetchLatestReleaseTagFromPage(): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: 'GET',
      url: `https://github.com/${REPO}/releases/latest`,
    });
    request.setHeader('Accept', 'text/html');
    request.setHeader('User-Agent', `FlowDeck/${app.getVersion()}`);

    let body = '';
    let redirectTag: string | null = null;

    request.on('redirect', (_statusCode, _method, redirectUrl) => {
      if (redirectTag) return;
      redirectTag = parseReleaseTagFromUrl(redirectUrl);
    });

    request.on('response', (response) => {
      if ((response.statusCode ?? 0) >= 400) {
        reject(
          new Error(`GitHub releases page returned ${response.statusCode}`),
        );
        return;
      }

      const locationTag = parseReleaseTagFromUrl(
        readHeaderValue(response.headers.location) ?? '',
      );
      if (!redirectTag && locationTag) {
        redirectTag = locationTag;
      }

      response.on('data', (chunk) => {
        if (body.length >= 512_000) return;
        body += chunk.toString();
      });

      response.on('end', () => {
        if (redirectTag) {
          resolve(redirectTag);
          return;
        }

        const htmlTag = parseReleaseTagFromHtml(body);
        if (htmlTag) {
          resolve(htmlTag);
          return;
        }

        reject(new Error('Could not resolve latest release tag from GitHub.'));
      });
    });

    request.on('error', reject);
    request.end();
  });
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  try {
    return await fetchLatestReleaseFromApi();
  } catch (error) {
    if (
      !(error instanceof GitHubApiStatusError) ||
      (error.statusCode !== 403 && error.statusCode !== 429)
    ) {
      throw error;
    }

    const tag = await fetchLatestReleaseTagFromPage();
    return {
      tag_name: tag,
      body: '',
      html_url: `https://github.com/${REPO}/releases/tag/${tag}`,
      assetInfoIncomplete: true,
      assets: [
        {
          name: ASAR_ASSET_NAME,
          browser_download_url: `https://github.com/${REPO}/releases/latest/download/${ASAR_ASSET_NAME}`,
          size: 0,
        },
      ],
    };
  }
}

function formatReleaseNotes(body?: string): string {
  const trimmed = typeof body === 'string' ? body.trim() : '';
  if (!trimmed) {
    return 'No release notes were published for this update.';
  }

  return trimmed.length > 12_000 ? `${trimmed.slice(0, 12_000).trim()}\n\n…` : trimmed;
}

function createManualUpdatePromptState(
  release: GitHubRelease,
  remoteVersion: string,
  options: {
    primaryAction: 'download' | 'open-release';
    primaryLabel: string;
    detailSuffix?: string;
    skipped: boolean;
  },
): UpdateWindowState {
  const detailLines = [`FlowDeck ${remoteVersion} is available.`];
  if (options.skipped) {
    detailLines.push('You previously chose to skip this version.');
  }
  if (options.detailSuffix) {
    detailLines.push(options.detailSuffix);
  }

  return {
    title: `Update available · ${remoteVersion}`,
    detail: detailLines.join(' '),
    downloadedBytes: 0,
    totalBytes: 1,
    progress: 0,
    showProgress: false,
    badge: options.skipped ? 'Skipped previously' : 'New release',
    notesLabel: 'Changelog',
    notes: formatReleaseNotes(release.body),
    tertiaryAction: 'skip-version',
    tertiaryLabel: 'Skip This Version',
    secondaryAction: 'close',
    secondaryLabel: 'Not Now',
    primaryAction: options.primaryAction,
    primaryLabel: options.primaryLabel,
  };
}

function promptForManualUpdateAction(
  state: UpdateWindowState,
): Promise<UpdateWindowAction> {
  return new Promise((resolve) => {
    pendingUpdateActionResolver = resolve;
    pushUpdateWindowState(state);
  });
}

async function confirmManualUpdateAvailable(
  release: GitHubRelease,
  remoteVersion: string,
): Promise<UpdateWindowAction> {
  return promptForManualUpdateAction(
    createManualUpdatePromptState(release, remoteVersion, {
      primaryAction: 'download',
      primaryLabel: 'Download Update',
      skipped: isVersionSkipped(remoteVersion),
    }),
  );
}

async function handleManualInstallerOnlyUpdate(
  release: GitHubRelease,
  remoteVersion: string,
): Promise<void> {
  const action = await promptForManualUpdateAction(
    createManualUpdatePromptState(release, remoteVersion, {
      primaryAction: 'open-release',
      primaryLabel: 'Open Release Page',
      detailSuffix:
        'No hot-update package was published for this version, so you will need the full installer.',
      skipped: isVersionSkipped(remoteVersion),
    }),
  );

  if (action === 'skip-version') {
    skipVersion(remoteVersion);
    return;
  }

  if (action === 'open-release' && release.html_url) {
    clearSkippedVersion(remoteVersion);
    await shell.openExternal(release.html_url);
  }
}

async function handleManualUpdateWithUnknownAssets(
  release: GitHubRelease,
  remoteVersion: string,
): Promise<void> {
  const action = await promptForManualUpdateAction(
    createManualUpdatePromptState(release, remoteVersion, {
      primaryAction: 'open-release',
      primaryLabel: 'Open Release Page',
      detailSuffix:
        'FlowDeck could not verify whether a hot-update package is available right now.',
      skipped: isVersionSkipped(remoteVersion),
    }),
  );

  if (action === 'skip-version') {
    skipVersion(remoteVersion);
    return;
  }

  if (action === 'open-release' && release.html_url) {
    clearSkippedVersion(remoteVersion);
    await shell.openExternal(release.html_url);
  }
}

function normalizeByteCount(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.round(raw);
}

function parseContentLength(
  header: string | string[] | undefined,
): number {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return 0;
  const parsed = Number(value);
  return normalizeByteCount(parsed);
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  if (progress < 0) return 0;
  if (progress > 1) return 1;
  return progress;
}

function getUpdateWindowSize(state: UpdateWindowState | null): {
  width: number;
  height: number;
} {
  return state?.notes ? RELEASE_NOTES_WINDOW_SIZE : COMPACT_UPDATE_WINDOW_SIZE;
}

function updateWindowButtonsForState(state: UpdateWindowState | null): Set<UpdateWindowAction> {
  const next = new Set<UpdateWindowAction>();
  if (!state) return next;
  if (state.primaryAction) next.add(state.primaryAction);
  if (state.secondaryAction) next.add(state.secondaryAction);
  if (state.tertiaryAction) next.add(state.tertiaryAction);
  return next;
}

function resolvePendingUpdateAction(action: UpdateWindowAction): void {
  if (!pendingUpdateActionResolver) return;
  const resolve = pendingUpdateActionResolver;
  pendingUpdateActionResolver = null;
  pendingUpdateActionButtons = new Set<UpdateWindowAction>();
  resolve(action);
}

function resizeUpdateWindowForState(state: UpdateWindowState | null): void {
  if (!updateWindow || updateWindow.isDestroyed()) return;
  const size = getUpdateWindowSize(state);
  updateWindow.setContentSize(size.width, size.height);
}

function createUpdateWindow(): BrowserWindow {
  if (updateWindow && !updateWindow.isDestroyed()) return updateWindow;

  const initialSize = getUpdateWindowSize(updateWindowState);
  const win = new BrowserWindow({
    width: initialSize.width,
    height: initialSize.height,
    resizable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ececec',
    title: `Updating ${app.name}`,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
    },
  });

  win.once('ready-to-show', () => {
    resizeUpdateWindowForState(updateWindowState);
    if (!win.isDestroyed()) win.show();
  });

  win.webContents.on('did-finish-load', () => {
    resizeUpdateWindowForState(updateWindowState);
    if (updateWindowState && !win.isDestroyed()) {
      win.webContents.send(UPDATE_WINDOW_CHANNEL, updateWindowState);
    }
  });

  win.on('closed', () => {
    updateWindow = null;
    if (cancelActiveDownload) {
      const cancel = cancelActiveDownload;
      cancelActiveDownload = null;
      cancel();
    }
    resolvePendingUpdateAction('close');
  });

  win.loadFile(
    path.join(__dirname, '..', 'renderer', 'update-window.html'),
  ).catch((err) => {
    console.error('Failed to load update window:', err);
  });

  updateWindow = win;
  return win;
}

function closeUpdateWindow(): void {
  if (!updateWindow || updateWindow.isDestroyed()) {
    updateWindow = null;
    resolvePendingUpdateAction('close');
    return;
  }
  updateWindow.close();
}

function pushUpdateWindowState(state: UpdateWindowState): void {
  updateWindowState = state;
  pendingUpdateActionButtons = updateWindowButtonsForState(state);
  const win = createUpdateWindow();
  resizeUpdateWindowForState(state);
  if (!win.isDestroyed() && !win.webContents.isLoadingMainFrame()) {
    win.webContents.send(UPDATE_WINDOW_CHANNEL, state);
  }
}

function createCheckingForUpdatesState(): UpdateWindowState {
  return {
    title: 'Checking for updates...',
    detail: 'Looking for the latest FlowDeck release now.',
    downloadedBytes: 0,
    totalBytes: 1,
    progress: 0,
    showProgress: false,
    badge: 'Checking',
  };
}

function createDownloadingState(
  version: string,
  downloadedBytes: number,
  totalBytes: number,
): UpdateWindowState {
  const safeTotal = Math.max(
    normalizeByteCount(totalBytes),
    normalizeByteCount(downloadedBytes),
    1,
  );
  const safeDownloaded = Math.min(
    normalizeByteCount(downloadedBytes),
    safeTotal,
  );

  return {
    title: 'Downloading update...',
    detail: `${app.name} ${version}`,
    downloadedBytes: safeDownloaded,
    totalBytes: safeTotal,
    progress: clampProgress(safeDownloaded / safeTotal),
    showProgress: true,
    primaryAction: 'cancel',
    primaryLabel: 'Cancel',
  };
}

async function downloadAsset(
  url: string,
  dest: string,
  options: DownloadAssetOptions,
): Promise<void> {
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  try {
    originalFs.unlinkSync(dest);
  } catch {
    /* ignore */
  }

  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url });
    request.setHeader('User-Agent', `FlowDeck/${app.getVersion()}`);
    request.setHeader('Accept', 'application/octet-stream');

    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      options.onCancelableChange(null);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    const cancel = (): void => {
      if (settled) return;
      try {
        request.abort();
      } catch {
        /* ignore */
      }
      finish(new UpdateCancelledError());
    };

    options.onCancelableChange(cancel);

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        finish(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const reportedTotalBytes = parseContentLength(response.headers['content-length']);
      const fallbackTotalBytes = normalizeByteCount(options.expectedBytes);
      const totalBytes = reportedTotalBytes || fallbackTotalBytes;

      const chunks: Buffer[] = [];
      let downloadedBytes = 0;
      options.onProgress(0, totalBytes);

      response.on('data', (chunk) => {
        if (settled) return;
        const nextChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(nextChunk);
        downloadedBytes += nextChunk.length;
        options.onProgress(downloadedBytes, totalBytes);
      });

      response.on('aborted', () => {
        finish(new UpdateCancelledError());
      });

      response.on('error', (err) => {
        finish(err);
      });

      response.on('end', () => {
        if (settled) return;
        try {
          // Use original-fs to write .asar file without Electron interception
          originalFs.writeFileSync(dest, Buffer.concat(chunks));
          const finalBytes = totalBytes || downloadedBytes;
          options.onProgress(finalBytes, finalBytes);
          finish();
        } catch (e) {
          finish(e);
        }
      });
    });

    request.on('error', (err) => {
      finish(err);
    });

    request.end();
  });
}

async function checkAndDownload(manual: boolean): Promise<void> {
  const release = await fetchLatestRelease();
  const remoteVersion = release.tag_name.replace(/^v/, '');
  const localVersion = app.getVersion();

  if (compareVersions(remoteVersion, localVersion) <= 0) {
    clearSkippedVersion();
    if (manual) {
      closeUpdateWindow();
      dialog.showMessageBox({
        type: 'info',
        title: 'No Updates',
        message: 'You are running the latest version.',
      });
    }
    return;
  }

  const asarAsset = release.assets.find((a) => a.name === ASAR_ASSET_NAME);
  const updatePlan = resolveAvailableUpdatePlan({
    manual,
    skipped: isVersionSkipped(remoteVersion),
    hasHotUpdateAsset: Boolean(asarAsset),
    assetInfoIncomplete: Boolean(release.assetInfoIncomplete),
  });

  if (updatePlan.kind === 'skip') {
    return;
  }

  if (updatePlan.kind === 'prompt-open-release') {
    if (release.assetInfoIncomplete) {
      await handleManualUpdateWithUnknownAssets(release, remoteVersion);
      return;
    }

    await handleManualInstallerOnlyUpdate(release, remoteVersion);
    return;
  }

  const action = await confirmManualUpdateAvailable(release, remoteVersion);
  if (action === 'skip-version') {
    skipVersion(remoteVersion);
    return;
  }
  if (action !== 'download') {
    return;
  }

  if (!asarAsset) {
    return;
  }

  clearSkippedVersion(remoteVersion);

  const staged = getStagedAsarPath();
  const shouldShowProgressWindow = true;

  if (shouldShowProgressWindow) {
    pushUpdateWindowState(
      createDownloadingState(remoteVersion, 0, asarAsset.size),
    );
  }

  try {
    await downloadAsset(asarAsset.browser_download_url, staged, {
      expectedBytes: asarAsset.size,
      onCancelableChange: (cancel) => {
        cancelActiveDownload = cancel;
      },
      onProgress: (downloadedBytes, totalBytes) => {
        if (!shouldShowProgressWindow) return;
        pushUpdateWindowState(
          createDownloadingState(
            remoteVersion,
            downloadedBytes,
            totalBytes || asarAsset.size,
          ),
        );
      },
    });
  } catch (err) {
    if (err instanceof UpdateCancelledError) {
      if (shouldShowProgressWindow) {
        closeUpdateWindow();
      }
      return;
    }

    if (shouldShowProgressWindow) {
      pushUpdateWindowState({
        title: 'Update failed',
        detail: err instanceof Error ? err.message : 'Unknown error',
        downloadedBytes: 0,
        totalBytes: 1,
        progress: 0,
        showProgress: false,
        primaryAction: 'close',
        primaryLabel: 'Close',
      });
      return;
    }

    throw err;
  } finally {
    cancelActiveDownload = null;
  }

  if (shouldShowProgressWindow) {
    pushUpdateWindowState({
      title: 'Update ready',
      detail: `Version ${remoteVersion} has been downloaded. Restart to apply it now.`,
      downloadedBytes: Math.max(asarAsset.size, 1),
      totalBytes: Math.max(asarAsset.size, 1),
      progress: 1,
      showProgress: true,
      primaryAction: 'restart',
      primaryLabel: 'Restart Now',
      secondaryAction: 'close',
      secondaryLabel: 'Later',
    });
    return;
  }

  const result = await dialog.showMessageBox({
    type: 'info',
    title: 'Update Ready',
    message: `Version ${remoteVersion} has been downloaded.`,
    detail:
      process.platform === 'darwin'
        ? 'Choose Restart Now to apply the update immediately, or Later to install it the next time FlowDeck fully closes.'
        : 'The update will be applied when you restart the application.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
  });

  if (result.response === 0) {
    try {
      restartToApplyUpdate();
    } catch (error) {
      showApplyUpdateError(error);
    }
  }
}

export function registerUpdaterIpcHandlers(): void {
  if (updaterIpcRegistered) return;
  updaterIpcRegistered = true;

  ipcMain.handle('flowdeck:update-cancel', () => {
    if (cancelActiveDownload) {
      const cancel = cancelActiveDownload;
      cancelActiveDownload = null;
      cancel();
    }
    closeUpdateWindow();
  });

  ipcMain.handle('flowdeck:update-restart', () => {
    try {
      restartToApplyUpdate();
    } catch (error) {
      showApplyUpdateError(error);
    }
  });

  ipcMain.handle('flowdeck:update-close-window', () => {
    closeUpdateWindow();
  });

  ipcMain.handle('flowdeck:update-run-action', (_event, rawAction: unknown) => {
    if (typeof rawAction !== 'string') return;
    const action = rawAction as UpdateWindowAction;
    if (!pendingUpdateActionButtons.has(action)) return;
    resolvePendingUpdateAction(action);
    if (shouldCloseWindowForAction(action)) {
      closeUpdateWindow();
    }
  });
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) return;

  registerUpdaterLifecycleHandlers();
  showPendingUpdateLaunchNoticeIfNeeded();

  setTimeout(() => {
    checkAndDownload(false).catch(() => {});
  }, 10_000);
}

export function checkForUpdatesManual(): void {
  pushUpdateWindowState(createCheckingForUpdatesState());

  checkAndDownload(true).catch((err) => {
    closeUpdateWindow();
    dialog.showMessageBox({
      type: 'error',
      title: 'Update Error',
      message: 'Could not check for updates.',
      detail: err?.message || 'Unknown error',
    });
  });
}
