import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('studio', {
  projects: () => ipcRenderer.invoke('project:list'),
  issues: (id: string) => ipcRenderer.invoke('core:issues', id),
  techStackProfile: (id:string) => ipcRenderer.invoke('core:tech-stack',id),
  issueStatusPreviews: (id:string) => ipcRenderer.invoke('core:issue-status-previews',id),
  installIssueLabels: (id:string) => ipcRenderer.invoke('core:issue-labels:install',id),
  branchProtection: (id: string) => ipcRenderer.invoke('core:branch-protection', id),
  gitPreflight: (id: string) => ipcRenderer.invoke('core:preflight', id),
  studioStatus: (id: string) => ipcRenderer.invoke('core:status', id),
  publicRepoHistory: (input: string, limit: number) => ipcRenderer.invoke('learning:public-history', input, limit),
  generateLearningBook: (input:string,page=1,pinnedHead?:string) => ipcRenderer.invoke('learning:generate', input,page,pinnedHead),
  loadLearningBook: (repo:string) => ipcRenderer.invoke('learning:load', repo),
  exportLearningBook: (repo:string,kind:'book'|'solutions'|'reports',format:'md'|'pdf') =>
    ipcRenderer.invoke('learning:export',repo,kind,format),
  studioActivity: (id: string) => ipcRenderer.invoke('core:activity', id),
  diagnostics: (id: string) => ipcRenderer.invoke('core:diagnostics', id),
  sandboxProbe: (id: string) => ipcRenderer.invoke('core:sandbox-probe', id),
  reviewerProbe: (id: string) => ipcRenderer.invoke('core:reviewer-probe', id),
  qualityProbe: (id: string) => ipcRenderer.invoke('core:quality-probe', id),
  qualityScriptProbe: (id: string) => ipcRenderer.invoke('core:quality-script-probe', id),
  fullPipelineProbe: (id: string) => ipcRenderer.invoke('core:full-pipeline-probe', id),
  offlineKiloProbe: (id: string) => ipcRenderer.invoke('core:offline-kilo-probe', id),
  offlineReviewerProbe: (id: string) => ipcRenderer.invoke('core:offline-reviewer-probe', id),
  localModelProbe: (id: string) => ipcRenderer.invoke('core:local-model-probe', id),
  reviewerCalibration: (id: string) => ipcRenderer.invoke('core:reviewer-calibration', id),
  ollamaReadiness: (id: string) => ipcRenderer.invoke('core:ollama-readiness', id),
  kiloFreeModels: (id: string) => ipcRenderer.invoke('core:kilo-free-models', id),
  kiloFreeUsage: (id: string) => ipcRenderer.invoke('core:kilo-free-usage', id),
  freeRunReadiness: (id: string) => ipcRenderer.invoke('core:free-run-readiness', id),
  localReviewFallback: (id: string) => ipcRenderer.invoke('core:local-review-fallback:get',id),
  setLocalReviewFallback: (id: string, enabled:boolean) => ipcRenderer.invoke('core:local-review-fallback:set',id,enabled),
  freeRoutePreview: (id: string) => ipcRenderer.invoke('core:free-route-preview',id),
  kiloRoleModels: (id: string) => ipcRenderer.invoke('core:kilo-role-models:get', id),
  kiloReviewerCalibrate: (id: string) => ipcRenderer.invoke('core:kilo-reviewer-calibrate', id),
  saveKiloRoleModels: (id: string, roles: {planner:string;builder:string;reviewer:string}) => ipcRenderer.invoke('core:kilo-role-models:save', id, roles),
  simulateIssue: (id: string, issueNumber: number) => ipcRenderer.invoke('core:simulate', id, issueNumber),
  issueToCode: (id: string, issueNumber: number) => ipcRenderer.invoke('core:issue-to-code', id, issueNumber),
  issueQueue: (id: string) => ipcRenderer.invoke('core:issue-queue', id),
  automateDraftIssue: (id: string, issueNumber: number) => ipcRenderer.invoke('core:issue-auto-draft', id, issueNumber),
  verifyIssue: (id: string, issueNumber: number) => ipcRenderer.invoke('core:issue-verify', id, issueNumber),
  publishDraftIssuePr: (id: string, issueNumber: number) => ipcRenderer.invoke('core:issue-draft-pr', id, issueNumber),
  cancelIssueCode: () => ipcRenderer.invoke('core:issue-to-code:cancel'),
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
  onIssueProgress: (callback: (event: IssueProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: IssueProgressEvent): void => callback(value);
    ipcRenderer.on('issue:progress', listener);
    return () => ipcRenderer.removeListener('issue:progress', listener);
  },
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

export interface IssueProgressEvent {
  projectId:string;
  issueNumber:number;
  stage:'build'|'review'|'quality'|'publish'|'done';
  time:number;
}
