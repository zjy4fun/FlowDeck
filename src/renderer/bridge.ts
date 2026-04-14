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
    loadUsageQuota: async (provider) => ({
      provider,
      sessionUsedPercent: null,
      sessionResetsAt: null,
      weeklyUsedPercent: null,
      weeklyResetsAt: null,
      sessionInputTokens: null,
      sessionOutputTokens: null,
      sessionTotalTokens: null,
      queriedAt: new Date().toISOString(),
    }),
    createTerminal: fail,
    writeTerminal: fail,
    resizeTerminal: fail,
    destroyTerminal: fail,
    getFilePath: () => '',
    selectDirectory: fail,
    loadSettings: fail,
    saveSettings: fail,
    onTerminalData: () => () => {},
    onTerminalExit: () => () => {},
    onMenuNewTab: () => () => {},
    onMenuCloseTab: () => () => {},
    confirmQuit: () => Promise.resolve(true),
    onSettingsChanged: () => () => {},
    onUpdateWindowState: () => () => {},
    cancelUpdateDownload: () => Promise.resolve(),
    restartForUpdate: () => Promise.resolve(),
    closeUpdateWindow: () => Promise.resolve(),
  };
}

declare global {
  interface Window {
    flowdeck?: FlowDeckBridge;
  }
}

export const bridge: FlowDeckBridge = window.flowdeck ?? createUnavailableBridge();
