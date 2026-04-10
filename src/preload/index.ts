import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const cwd = process.cwd();
const defaultTabTitle = cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;

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
});
