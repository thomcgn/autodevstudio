import type { StudioEvent } from '../main/preload';
export interface StudioIssue {
  number: number; title: string; body: string; url: string; labels: string[];
}
export interface WorkflowStageDescription { stage: string; title: string; explanation: string }
export interface RunRecord {
  runId: string; projectId: string; projectName: string;
  mode: 'status' | 'dry-run' | 'execute'; startedAt: number; endedAt: number | null;
  outcome: 'running' | 'success' | 'failed' | 'interrupted';
  exitCode: number | null; signal: string | null; bytesLogged: number; truncated: boolean;
}
export interface Project { id: string; name: string; path: string; isGitRepo: boolean; hasCore: boolean }
export interface ControllerSnapshot {
  currentIssue: number | null;
  reviewIteration: number;
  processedIssues: number[];
  failedIssues: number[];
  checkpoint: { issueNumber: number; phase: string; reason: string; sessionId: string | null; timestamp: string } | null;
  hasState: boolean;
  updatedAt: number | null;
}
declare global {
  interface Window { studio: {
    projects(): Promise<Project[]>;
    issues(id: string): Promise<StudioIssue[]>;
    workflowStages(): Promise<WorkflowStageDescription[]>;
    snapshot(id: string): Promise<ControllerSnapshot>;
    addProject(): Promise<Project | null>;
    removeProject(id: string): Promise<boolean>;
    start(id: string, mode: 'status' | 'dry-run' | 'execute', approval?: string): Promise<{ runId: string }>;
    runInfo(): Promise<{ runId: string; projectId: string; mode: string; startedAt: number } | null>;
    history(id: string): Promise<RunRecord[]>;
    historyLog(id: string, runId: string): Promise<string>;
    stop(): Promise<boolean>;
    active(): Promise<boolean>;
    onEvent(fn: (event: StudioEvent) => void): () => void;
  } }
}
