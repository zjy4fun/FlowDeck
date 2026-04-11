import { app, dialog, net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const REPO = 'zjy4fun/FlowDeck';
const ASAR_ASSET_NAME = 'app.asar';

let isManualCheck = false;

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
  if (!fs.existsSync(staged)) return false;

  const target = path.join(process.resourcesPath, 'app.asar');

  try {
    // Backup current asar
    const backup = path.join(process.resourcesPath, 'app.asar.backup');
    fs.copyFileSync(target, backup);

    // Swap in new asar
    fs.copyFileSync(staged, target);
    fs.unlinkSync(staged);

    // Clean up backup on success
    try {
      fs.unlinkSync(backup);
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
    const backup = path.join(process.resourcesPath, 'app.asar.backup');
    if (fs.existsSync(backup)) {
      try {
        fs.copyFileSync(backup, target);
        fs.unlinkSync(backup);
      } catch {
        /* ignore */
      }
    }
    // Remove broken staged file
    try {
      fs.unlinkSync(staged);
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
      // Follow redirects (GitHub redirects to S3)
      if (
        (response.statusCode === 301 || response.statusCode === 302) &&
        response.headers.location
      ) {
        const redirectUrl = Array.isArray(response.headers.location)
          ? response.headers.location[0]
          : response.headers.location;
        downloadAsset(redirectUrl, dest).then(resolve, reject);
        return;
      }

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
          fs.writeFileSync(dest, Buffer.concat(chunks));
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
  isManualCheck = true;
  checkAndDownload(true).catch((err) => {
    dialog.showMessageBox({
      type: 'error',
      title: 'Update Error',
      message: 'Could not check for updates.',
      detail: err?.message || 'Unknown error',
    });
  });
}
