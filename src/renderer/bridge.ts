import type { FlowDeckBridge } from './types';

function createUnavailableBridge(): FlowDeckBridge {
  const fail = (): never => {
    throw new Error('Electron preload bridge is unavailable');
  };

  return {
    platform: navigator.platform.toLowerCase().includes('mac')
      ? 'darwin'
      : 'linux',
    defaultCwd: '.',
    defaultTabTitle: '.',
    createTerminal: fail,
    writeTerminal: fail,
    showTerminalContextMenu: fail,
    openExternalUrl: fail,
    resizeTerminal: fail,
    destroyTerminal: fail,
    getFilePath: () => '',
    selectDirectory: fail,
    loadSettings: fail,
    saveSettings: fail,
    getDeveloperContext: fail,
    onTerminalData: () => () => {},
    onTerminalExit: () => () => {},
    onTerminalContextMenuAction: () => () => {},
    onMenuNewTab: () => () => {},
    onMenuCloseTab: () => () => {},
    confirmQuit: () => Promise.resolve(true),
    onSettingsChanged: () => () => {},
    onUpdateWindowState: () => () => {},
    cancelUpdateDownload: () => Promise.resolve(),
    restartForUpdate: () => Promise.resolve(),
    closeUpdateWindow: () => Promise.resolve(),
    runUpdateAction: () => Promise.resolve(),
    toggleMaximizeWindow: () => Promise.resolve(),
  };
}

declare global {
  interface Window {
    flowdeck?: FlowDeckBridge;
  }
}

export const bridge: FlowDeckBridge = window.flowdeck ?? createUnavailableBridge();
