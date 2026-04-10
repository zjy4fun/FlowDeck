import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { homedir } from 'os';

const cwd = homedir();
const defaultTabTitle = '~';

contextBridge.exposeInMainWorld('flowdeck', {
  platform: process.platform,
  defaultCwd: cwd,
  defaultTabTitle,

  createTerminal: (payload: unknown) =>
    ipcRenderer.invoke('flowdeck:terminal-create', payload),
  writeTerminal: (payload: unknown) =>
    ipcRenderer.invoke('flowdeck:terminal-write', payload),
  resizeTerminal: (payload: unknown) =>
    ipcRenderer.invoke('flowdeck:terminal-resize', payload),
  destroyTerminal: (payload: unknown) =>
    ipcRenderer.invoke('flowdeck:terminal-destroy', payload),

  loadSettings: () => ipcRenderer.invoke('flowdeck:settings-load'),
  saveSettings: (settings: unknown) =>
    ipcRenderer.invoke('flowdeck:settings-save', settings),

  onTerminalData: (
    handler: (payload: { paneId: string; data: string }) => void,
  ) => {
    const listener = (
      _event: IpcRendererEvent,
      payload: { paneId: string; data: string },
    ) => handler(payload);
    ipcRenderer.on('flowdeck:terminal-data', listener);
    return () => ipcRenderer.removeListener('flowdeck:terminal-data', listener);
  },

  onTerminalExit: (
    handler: (payload: { paneId: string; exitCode: number }) => void,
  ) => {
    const listener = (
      _event: IpcRendererEvent,
      payload: { paneId: string; exitCode: number },
    ) => handler(payload);
    ipcRenderer.on('flowdeck:terminal-exit', listener);
    return () => ipcRenderer.removeListener('flowdeck:terminal-exit', listener);
  },

  onMenuNewTab: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on('flowdeck:menu-new-tab', listener);
    return () => ipcRenderer.removeListener('flowdeck:menu-new-tab', listener);
  },

  onMenuCloseTab: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on('flowdeck:menu-close-tab', listener);
    return () => ipcRenderer.removeListener('flowdeck:menu-close-tab', listener);
  },

  onSettingsChanged: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on('flowdeck:settings-changed', listener);
    return () => ipcRenderer.removeListener('flowdeck:settings-changed', listener);
  },
});
