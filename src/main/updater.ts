import { app, dialog, net } from 'electron';
// Use original-fs to bypass Electron's asar interception on .asar paths
import * as originalFs from 'original-fs';
import * as fs from 'fs';
import * as path from 'path';

const REPO = 'zjy4fun/FlowDeck';
const ASAR_ASSET_NAME = 'app.asar';

function getPendingUpdateDir(): string {
  return path.join(app.getPath('userData'), 'pending-update');
}

function getStagedAsarPath(): string {
  return path.join(getPendingUpdateDir(), 'app.asar');
}

/**
 * Called at app startup BEFORE createWindow().
 * If a staged app.asar exists, swap it in and relaunch.
 */
export function applyPendingUpdate(): boolean {
  if (!app.isPackaged) return false;

  const staged = getStagedAsarPath();
  if (!originalFs.existsSync(staged)) return false;

  const target = path.join(process.resourcesPath, 'app.asar');
  const backup = path.join(process.resourcesPath, 'app.asar.backup');

  try {
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
  assets: Array<{ name: string; browser_download_url: string; size: number }>;
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
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: 'GET',
      url: `https://api.github.com/repos/${REPO}/releases/latest`,
    });
    request.setHeader('Accept', 'application/vnd.github.v3+json');
    request.setHeader('User-Agent', `FlowDeck/${app.getVersion()}`);

    let body = '';
    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`GitHub API returned ${response.statusCode}`));
        return;
      }
      response.on('data', (chunk) => {
        body += chunk.toString();
      });
      response.on('end', () => {
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

async function downloadAsset(url: string, dest: string): Promise<void> {
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url });
    request.setHeader('User-Agent', `FlowDeck/${app.getVersion()}`);
    request.setHeader('Accept', 'application/octet-stream');

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const chunks: Buffer[] = [];
      response.on('data', (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      response.on('end', () => {
        try {
          // Use original-fs to write .asar file without Electron interception
          originalFs.writeFileSync(dest, Buffer.concat(chunks));
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
    request.on('error', reject);
    request.end();
  });
}

async function checkAndDownload(manual: boolean): Promise<void> {
  const release = await fetchLatestRelease();
  const remoteVersion = release.tag_name.replace(/^v/, '');
  const localVersion = app.getVersion();

  if (compareVersions(remoteVersion, localVersion) <= 0) {
    if (manual) {
      dialog.showMessageBox({
        type: 'info',
        title: 'No Updates',
        message: 'You are running the latest version.',
      });
    }
    return;
  }

  const asarAsset = release.assets.find((a) => a.name === ASAR_ASSET_NAME);
  if (!asarAsset) {
    if (manual) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Update Available',
        message: `Version ${remoteVersion} is available, but no hot-update asset found. Please download the full installer from GitHub.`,
      });
    }
    return;
  }

  if (manual) {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `Downloading version ${remoteVersion}...`,
    });
  }

  const staged = getStagedAsarPath();
  await downloadAsset(asarAsset.browser_download_url, staged);

  const result = await dialog.showMessageBox({
    type: 'info',
    title: 'Update Ready',
    message: `Version ${remoteVersion} has been downloaded.`,
    detail: 'The update will be applied when you restart the application.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
  });

  if (result.response === 0) {
    app.relaunch();
    app.exit(0);
  }
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) return;

  setTimeout(() => {
    checkAndDownload(false).catch(() => {});
  }, 10_000);
}

export function checkForUpdatesManual(): void {
  checkAndDownload(true).catch((err) => {
    dialog.showMessageBox({
      type: 'error',
      title: 'Update Error',
      message: 'Could not check for updates.',
      detail: err?.message || 'Unknown error',
    });
  });
}
