interface WindowAllClosedOptions {
  platform: NodeJS.Platform;
  destroyAllSessions: () => void;
  quit: () => void;
}

export function handleWindowAllClosed(options: WindowAllClosedOptions): void {
  options.destroyAllSessions();
  if (options.platform !== 'darwin') {
    options.quit();
  }
}
