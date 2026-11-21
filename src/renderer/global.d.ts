import type { StudioEvent } from '../main/preload';
export interface StandaloneStatus {
  git: GitPreflight;
  lock: { held: boolean; startedAt: string | null };
  checkpoint: { issueNumber: number; stage: string; revision: number; savedAt: string; reviewPassed: boolean; qualityPassed: boolean } | null;
  executionEnabled: false;
}
export interface SimulationResult {
  state: { issueNumber: number; stage: string; fixAttempts: number; maxFixAttempts: number };
  events: Array<{ stage: string; message: string; issueNumber: number; fixAttempts: number }>;
}
export interface ReviewerToolProbe { supported: boolean; passed: boolean; reason: 'passed' | 'unsupported-platform' | 'tool-failed'; detail: 'mountpoint-failed' | 'runtime-library-missing' | 'git-repository-rejected' | 'git-command-failed' | 'timeout' | 'sandbox-launch-failed' | null }
export interface SandboxProbeResult { available: boolean; isolated: boolean; reason: 'passed' | 'unsupported-platform' | 'sandbox-failed' | 'canary-modified'; detail: 'namespace-permission-denied' | 'network-setup-denied' | 'mount-setup-failed' | 'canary-read-failed' | 'write-protection-failed' | 'canary-verification-failed' | 'probe-command-failed' | 'timeout' | 'unknown' | null; exitCode: number | null }
export interface ProviderDiagnostics {
  kiloInstalled: boolean; kiloVersion: string | null; supportedFlags: string[];
  kiloRunCommandReady: boolean; agentCatalogReadable: boolean;
  agentCatalogProblem: 'timeout' | 'output-limit' | 'command-failed' | 'not-found' | 'empty-output' | null;
  sandboxTool: 'bwrap' | 'sandbox-exec' | null; sandboxToolAvailable: boolean;
  ghInstalled: boolean; ghAuthenticated: boolean; checkedAt: string;
}
export interface GitPreflight {
  root: string; branch: string; head: string; remoteSlug: string | null;
  clean: boolean; canExecute: boolean; reasons: string[];
}
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
    gitPreflight(id: string): Promise<GitPreflight>;
    studioStatus(id: string): Promise<StandaloneStatus>;
    diagnostics(id: string): Promise<ProviderDiagnostics>;
    sandboxProbe(id: string): Promise<SandboxProbeResult>;
    reviewerProbe(id: string): Promise<ReviewerToolProbe>;
    simulateIssue(id: string, issueNumber: number): Promise<SimulationResult>;
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
