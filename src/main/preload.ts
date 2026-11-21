import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('studio', {
  projects: () => ipcRenderer.invoke('project:list'),
  issues: (id: string) => ipcRenderer.invoke('core:issues', id),
  gitPreflight: (id: string) => ipcRenderer.invoke('core:preflight', id),
  studioStatus: (id: string) => ipcRenderer.invoke('core:status', id),
  diagnostics: (id: string) => ipcRenderer.invoke('core:diagnostics', id),
  sandboxProbe: (id: string) => ipcRenderer.invoke('core:sandbox-probe', id),
  reviewerProbe: (id: string) => ipcRenderer.invoke('core:reviewer-probe', id),
  qualityProbe: (id: string) => ipcRenderer.invoke('core:quality-probe', id),
  qualityScriptProbe: (id: string) => ipcRenderer.invoke('core:quality-script-probe', id),
  fullPipelineProbe: (id: string) => ipcRenderer.invoke('core:full-pipeline-probe', id),
  offlineKiloProbe: (id: string) => ipcRenderer.invoke('core:offline-kilo-probe', id),
  offlineReviewerProbe: (id: string) => ipcRenderer.invoke('core:offline-reviewer-probe', id),
  localModelProbe: (id: string) => ipcRenderer.invoke('core:local-model-probe', id),
  simulateIssue: (id: string, issueNumber: number) => ipcRenderer.invoke('core:simulate', id, issueNumber),
  workflowStages: () => ipcRenderer.invoke('core:workflow'),
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
