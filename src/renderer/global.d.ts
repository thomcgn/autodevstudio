import type { StudioEvent } from '../main/preload';
export interface RunRecord {
  runId: string; projectId: string; projectName: string;
  mode: 'status' | 'dry-run' | 'execute'; startedAt: number; endedAt: number | null;
  outcome: 'running' | 'success' | 'failed' | 'interrupted';
  exitCode: number | null; signal: string | null; bytesLogged: number; truncated: boolean;
}
export interface Project { id: string; name: string; path: string }
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
