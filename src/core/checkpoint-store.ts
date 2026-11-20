import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { keyForProject, inspectProjectLock } from './project-lock.ts';
import type { Stage } from './workflow.ts';
import type { AgentRole } from './kilo-process.ts';

const SCHEMA_VERSION = 1;
const HEX = /^[0-9a-f]{40,64}$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const SESSION = /^[a-zA-Z0-9_-]{8,128}$/;
const STAGES: ReadonlyArray<Stage> = ['plan','build','review','quality','publish','done','blocked'];

export interface GitIdentity {
  head: string; branch: string; worktreeHash: string;
}
export interface CoreCheckpoint {
  schemaVersion: 1;
  projectKey: string;
  runId: string;
  issueNumber: number;
  stage: Stage;
  revision: number;
  git: GitIdentity;
  sessions: Partial<Record<AgentRole,string>>;
  reviewPassed: boolean;
  qualityPassed: boolean;
  savedAt: string;
}
export type CheckpointDraft = Omit<CoreCheckpoint, 'schemaVersion' | 'projectKey' | 'revision' | 'savedAt'>;

function getFilename(base: string, key: string): string {
  const dir = path.join(base, 'core-checkpoints');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, key + '.json');
}
function validCheckpoint(item: unknown, projectKey: string): item is CoreCheckpoint {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const cp = item as CoreCheckpoint;
  return cp.schemaVersion === SCHEMA_VERSION && cp.projectKey === projectKey &&
    typeof cp.runId === 'string' && /^[a-f0-9-]{36}$/.test(cp.runId) &&
    Number.isSafeInteger(cp.issueNumber) && cp.issueNumber > 0 &&
    STAGES.includes(cp.stage) && Number.isSafeInteger(cp.revision) && cp.revision > 0 &&
    !!cp.git && HEX.test(cp.git.head) && typeof cp.git.branch === 'string' && cp.git.branch.length > 0 &&
    FINGERPRINT.test(cp.git.worktreeHash) &&
    cp.sessions !== null && typeof cp.sessions === 'object' && !Array.isArray(cp.sessions) &&
    Object.entries(cp.sessions).every(([role,id]) =>
      ['planner','builder','reviewer'].includes(role) && typeof id === 'string' && SESSION.test(id)) &&
    typeof cp.reviewPassed === 'boolean' && typeof cp.qualityPassed === 'boolean' &&
    typeof cp.savedAt === 'string';
}

export function loadCoreCheckpoint(base: string, projectPath: string): CoreCheckpoint | null {
  const key = keyForProject(projectPath);
  const file = getFilename(base, key);
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) {
    throw new Error('Unsafe or oversized checkpoint');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(fs.readFileSync(file,'utf8')); }
  catch { throw new Error('Corrupted checkpoint: manual recovery required'); }
  if (!validCheckpoint(parsed, key)) throw new Error('Invalid checkpoint: manual recovery required');
  return parsed;
}
function assertOwner(base: string, projectPath: string, token: string): void {
  const current = inspectProjectLock(base, projectPath);
  if (!current || current.token !== token) throw new Error('Checkpoint write requires owned project lock');
}

/** Optimistic revision protects stale writers; a project lock is additionally mandatory.
 * Checkpoints are NOT project files and do not alter selected repos.
 */
export function saveCoreCheckpoint(
  base: string, projectPath: string, lockToken: string, draft: CheckpointDraft,
  expectedRevision: number | null,
): CoreCheckpoint {
  assertOwner(base, projectPath, lockToken);
  const key = keyForProject(projectPath);
  const file = getFilename(base, key);
  const current = loadCoreCheckpoint(base, projectPath);
  if ((current?.revision ?? null) !== expectedRevision) {
    throw new Error('Checkpoint revision conflict');
  }
  const checkpoint: CoreCheckpoint = {
    ...draft, schemaVersion: 1, projectKey: key,
    revision: (current?.revision ?? 0) + 1, savedAt: new Date().toISOString(),
  };
  if (!validCheckpoint(checkpoint, key)) throw new Error('Invalid checkpoint draft');
  if (checkpoint.stage === 'publish' && (!checkpoint.reviewPassed || !checkpoint.qualityPassed)) {
    throw new Error('Cannot checkpoint publish without review and quality gates');
  }
  const tmp = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(checkpoint, null, 2), { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* renamed or already removed */ }
  }
  return checkpoint;
}

export function assertCoreResumeEligible(
  checkpoint: CoreCheckpoint, projectPath: string, current: GitIdentity,
): void {
  if (checkpoint.projectKey !== keyForProject(projectPath)) throw new Error('Project identity changed');
  if (checkpoint.git.head !== current.head || checkpoint.git.branch !== current.branch ||
      checkpoint.git.worktreeHash !== current.worktreeHash) {
    throw new Error('Repository drift detected: manual recovery required');
  }
  if (checkpoint.stage === 'build' && !checkpoint.sessions.builder) {
    throw new Error('Cannot resume builder without a verified session ID');
  }
  if (checkpoint.stage === 'review' && !checkpoint.sessions.reviewer) {
    throw new Error('Cannot resume reviewer without a verified session ID');
  }
  if (checkpoint.stage === 'publish') {
    throw new Error('Publish resume needs explicit manual verification; automatic publication forbidden');
  }
  if (checkpoint.stage === 'done' || checkpoint.stage === 'blocked') {
    throw new Error('Finished or blocked workflow cannot auto-resume');
  }
}
