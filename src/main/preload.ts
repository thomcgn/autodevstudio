import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('studio', {
  projects: () => ipcRenderer.invoke('project:list'),
  addProject: () => ipcRenderer.invoke('project:add'),
  removeProject: (id: string) => ipcRenderer.invoke('project:remove', id),
  start: (id: string, mode: 'status' | 'dry-run') => ipcRenderer.invoke('run:start', id, mode),
  stop: () => ipcRenderer.invoke('run:stop'),
  active: () => ipcRenderer.invoke('run:active'),
  onEvent: (callback: (event: StudioEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: StudioEvent): void => callback(value);
    ipcRenderer.on('run:event', listener);
    return () => ipcRenderer.removeListener('run:event', listener);
  },
});
export interface StudioEvent {
  runId: string; type: 'start' | 'stdout' | 'stderr' | 'exit';
  message?: string; code?: number | null; signal?: string | null; mode?: string; project?: string; time: number;
}
