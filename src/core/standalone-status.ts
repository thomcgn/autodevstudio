import { inspectGitPreflight, type GitPreflight } from './git-preflight.ts';
import { inspectProjectLock } from './project-lock.ts';
import { loadCoreCheckpoint } from './checkpoint-store.ts';

export interface StandaloneStatus {
  git: GitPreflight;
  lock: { held: boolean; startedAt: string | null };
  checkpoint: {
    issueNumber: number; stage: string; revision: number;
    savedAt: string; reviewPassed: boolean; qualityPassed: boolean;
  } | null;
  executionEnabled: false;
}

/** Read-only status for any Git repository. Never assumes a legacy in-project core.
 * Malformed checkpoints fail closed: report an error, never silently clear them.
 * Tokens and role session IDs must not be exposed to the renderer.
 */
export async function inspectStandaloneStatus(base: string, projectPath: string): Promise<StandaloneStatus> {
  const git = await inspectGitPreflight(projectPath);
  const lock = inspectProjectLock(base, projectPath);
  const checkpoint = loadCoreCheckpoint(base, projectPath);
  return {
    git,
    lock: { held: lock !== null, startedAt: lock?.startedAt ?? null },
    checkpoint: checkpoint ? {
      issueNumber: checkpoint.issueNumber, stage: checkpoint.stage,
      revision: checkpoint.revision, savedAt: checkpoint.savedAt,
      reviewPassed: checkpoint.reviewPassed, qualityPassed: checkpoint.qualityPassed,
    } : null,
    executionEnabled: false,
  };
}
