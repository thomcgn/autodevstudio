import type { StudioEvent } from '../main/preload';
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
    stop(): Promise<boolean>;
    active(): Promise<boolean>;
    onEvent(fn: (event: StudioEvent) => void): () => void;
  } }
}
