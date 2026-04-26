import type { MessageBoxOptions } from 'electron';

export interface AboutDialogOptionsInput {
  appName: string;
  currentVersion: string;
}

export function createAboutDialogOptions({
  appName,
  currentVersion,
}: AboutDialogOptionsInput): MessageBoxOptions {
  return {
    type: 'info',
    buttons: ['OK'],
    defaultId: 0,
    title: `About ${appName}`,
    message: appName,
    detail: `Version ${currentVersion}`,
    noLink: true,
  };
}
