import { randomUUID } from 'node:crypto';
import { acquireProjectLock, type AcquiredProjectLock } from './project-lock.ts';
import { loadCoreCheckpoint, saveCoreCheckpoint, type CoreCheckpoint } from './checkpoint-store.ts';
import { prepareIssueBranch } from './issue-branch.ts';
import { captureGitIdentity } from './git-identity.ts';

export interface PreparedIssueRun {
  readonly checkpoint: CoreCheckpoint;
  readonly branch: string;
  /** Controller remains responsible for releasing the lock after finishing or stopping. */
  readonly lock: AcquiredProjectLock;
}

/** This function is deliberately NOT exposed via renderer IPC.
 * Preparation writes only a new local issue branch and an external Studio checkpoint.
 * A real controller must hold the returned lock across the complete agent workflow.
 * It must never blindly auto-resume or publish an orphaned preparation.
 */
export async function prepareControlledIssueRun(
  base: string, projectPath: string, issueNumber: number,
): Promise<PreparedIssueRun> {
  const lock = acquireProjectLock(base, projectPath);
  try {
    if (loadCoreCheckpoint(base, projectPath)) {
      throw new Error('Existing Studio checkpoint requires explicit recovery before a new run');
    }
    const prepared = await prepareIssueBranch(base, projectPath, lock.record.token, issueNumber);
    const git = await captureGitIdentity(projectPath);
    if (git.head !== prepared.startingHead || git.branch !== prepared.branch ||
        !prepared.remoteSlug) throw new Error('Issue branch drift before checkpoint');
    const checkpoint = saveCoreCheckpoint(base,projectPath,lock.record.token,{
      runId:randomUUID(),
      issueNumber,
      stage:'plan',
      git,
      sessions:{},
      reviewPassed:false,
      qualityPassed:false,
    },null);
    return {checkpoint,branch:prepared.branch,lock};
  } catch (error) {
    // A created issue branch is intentionally NOT deleted on failure.
    // Retrying requires explicit inspection; no reset/force checkout is ever used.
    lock.release();
    throw error;
  }
}
