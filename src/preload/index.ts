import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

type ShareMode = 'tab-or-window' | 'full-screen' | 'unknown';
type CredentialInput = Partial<Record<'tencentAppId' | 'tencentSecretId' | 'tencentSecretKey' | 'llmApiKey' | 'llmBaseUrl' | 'llmModel' | 'llmPreset', string>>;
contextBridge.exposeInMainWorld('interviewAPI', Object.freeze({
  setIgnoreMouse: (ignore: boolean): void => ipcRenderer.send('overlay:mouse-ignore', ignore),
  hide: (): void => ipcRenderer.send('overlay:hide'),
  quit: (): void => ipcRenderer.send('overlay:quit'),
  setCollapsed: (collapsed: boolean): void => ipcRenderer.send('overlay:collapse', collapsed),
  openSettings: (): void => ipcRenderer.send('settings:open'),
  overlayRendered: (ticket: number): void => ipcRenderer.send('overlay:rendered', ticket),
  startListener: () => ipcRenderer.invoke('listener:start'),
  stopListener: () => ipcRenderer.invoke('listener:stop'),
  listenerPermission: (action: 'check' | 'request') => ipcRenderer.invoke('listener:permission', action),
  openListenerPermissionSettings: () => ipcRenderer.invoke('listener:open-permission-settings'),
  restartApp: () => ipcRenderer.invoke('listener:restart-app'),
  getGuardState: () => ipcRenderer.invoke('guard:get'),
  declareShare: (mode: ShareMode) => ipcRenderer.invoke('guard:declare', mode),
  resetShare: () => ipcRenderer.invoke('guard:reset'),
  onGuardState: (callback: (state: unknown) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, state: unknown): void => callback(state);
    ipcRenderer.on('guard:state', listener);
    return () => ipcRenderer.removeListener('guard:state', listener);
  },
  getCredentials: () => ipcRenderer.invoke('credentials:get'),
  saveCredentials: (input: CredentialInput) => ipcRenderer.invoke('credentials:save', input),
}));
