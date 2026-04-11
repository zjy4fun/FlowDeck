import { autoUpdater } from 'electron-updater';
import { app, dialog } from 'electron';

let isManualCheck = false;

export function initAutoUpdater(): void {
  if (!app.isPackaged) {
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    if (isManualCheck) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Update Available',
        message: `A new version (${info.version}) is available and is being downloaded.`,
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    if (isManualCheck) {
      dialog.showMessageBox({
        type: 'info',
        title: 'No Updates',
        message: 'You are running the latest version.',
      });
      isManualCheck = false;
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    isManualCheck = false;
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: `Version ${info.version} has been downloaded.`,
        detail: 'The update will be installed when you restart the application.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on('error', (err) => {
    if (isManualCheck) {
      dialog.showMessageBox({
        type: 'error',
        title: 'Update Error',
        message: 'Failed to check for updates.',
        detail: err?.message || 'Unknown error',
      });
      isManualCheck = false;
    }
  });

  // Silent check on launch after a delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 10_000);
}

export function checkForUpdatesManual(): void {
  isManualCheck = true;
  autoUpdater.checkForUpdates().catch((err) => {
    isManualCheck = false;
    dialog.showMessageBox({
      type: 'error',
      title: 'Update Error',
      message: 'Could not check for updates.',
      detail: err?.message || 'Unknown error',
    });
  });
}
