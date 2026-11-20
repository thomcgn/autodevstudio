import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('studio', {
  projects: () => ipcRenderer.invoke('project:list'),
  snapshot: (id: string) => ipcRenderer.invoke('project:snapshot', id),
  addProject: () => ipcRenderer.invoke('project:add'),
  removeProject: (id: string) => ipcRenderer.invoke('project:remove', id),
  start: (id: string, mode: 'status' | 'dry-run' | 'execute', approval?: string) => ipcRenderer.invoke('run:start', id, mode, approval),
  runInfo: () => ipcRenderer.invoke('run:info'),
  history: (id: string) => ipcRenderer.invoke('history:list', id),
  historyLog: (id: string, runId: string) => ipcRenderer.invoke('history:log', id, runId),
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
  message?: string; code?: number | null; signal?: string | null; mode?: string; project?: string; projectId?: string; time: number;
}
