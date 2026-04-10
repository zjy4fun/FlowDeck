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
    resizeTerminal: fail,
    destroyTerminal: fail,
    loadSettings: fail,
    saveSettings: fail,
    onTerminalData: () => () => {},
    onTerminalExit: () => () => {},
  };
}

declare global {
  interface Window {
    flowdeck?: FlowDeckBridge;
  }
}

export const bridge: FlowDeckBridge = window.flowdeck ?? createUnavailableBridge();
