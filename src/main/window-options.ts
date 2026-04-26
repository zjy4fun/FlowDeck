import * as path from 'path';

export interface WindowIconPathOptions {
  platform: NodeJS.Platform;
  appPath: string;
  resourcesPath: string;
  isPackaged: boolean;
}

export interface FullScreenInputOptions {
  platform: NodeJS.Platform;
  key: string;
  isFullScreen?: boolean;
}

export function getWindowIconPath(options: WindowIconPathOptions): string | undefined {
  if (options.platform === 'darwin') return undefined;

  const basePath = options.isPackaged ? options.resourcesPath : options.appPath;
  return path.join(basePath, 'build', 'icon.png');
}

export function shouldToggleFullScreenForInput(options: FullScreenInputOptions): boolean {
  if (options.platform === 'darwin') return false;
  if (options.key === 'F11') return true;
  if (options.key === 'Escape') return options.isFullScreen === true;
  return false;
}
