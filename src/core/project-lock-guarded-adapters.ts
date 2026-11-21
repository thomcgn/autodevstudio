import type { WorkflowAdapters } from './orchestrator.ts';
import { inspectProjectLock, keyForProject } from './project-lock.ts';

export interface OwnedWorkflowLock {
  base: string;
  projectPath: string;
  token: string;
}

/** Verify lock ownership at every async boundary, including immediately before
 * publish. The lock token must come from acquireProjectLock in trusted Main.
 *
 * This is an adapter safety boundary, not authority to begin a run. It cannot
 * replace a lock held for the entire lifecycle or a permission decision.
 */
export function assertWorkflowLockOwned(lock: OwnedWorkflowLock): void {
  if (!lock.token || typeof lock.token !== 'string')
    throw new Error('Missing owned workflow lock');
  const current = inspectProjectLock(lock.base, lock.projectPath);
  if (!current || current.token !== lock.token ||
      current.projectKey !== keyForProject(lock.projectPath)) {
    throw new Error('Workflow project lock lost or ownership changed; publication forbidden');
  }
}

export function createProjectLockGuardedAdapters(
  lock: OwnedWorkflowLock, adapters: WorkflowAdapters,
): WorkflowAdapters {
  const guarded = async <T>(action: () => Promise<T>): Promise<T> => {
    assertWorkflowLockOwned(lock);
    const value = await action();
    assertWorkflowLockOwned(lock);
    return value;
  };
  return {
    planner: issue => guarded(() => adapters.planner(issue)),
    builder: (issue,plan,feedback) => guarded(() => adapters.builder(issue,plan,feedback)),
    reviewer: (issue,plan,build) => guarded(() => adapters.reviewer(issue,plan,build)),
    quality: issue => guarded(() => adapters.quality(issue)),
    publish: issue => guarded(() => adapters.publish(issue)),
  };
}
