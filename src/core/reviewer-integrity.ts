import { captureGitIdentity } from './git-identity.ts';
import type { GitIdentity } from './checkpoint-store.ts';

export type IdentityCapture = (directory: string) => Promise<GitIdentity>;

/** Defense in depth for an independent reviewer:
 * A reviewer is NOT automatically read-only just because its prompt says so.
 * If any branch, HEAD, staged, unstaged or untracked content changes during
 * its invocation, refuse its verdict. This does not replace OS sandboxing
 * (an agent might write and later revert files).
 */
export async function withReviewIntegrity<T>(
  projectPath: string,
  invoke: () => Promise<T>,
  capture: IdentityCapture = captureGitIdentity,
): Promise<T> {
  const before = await capture(projectPath);
  let result: T | undefined;
  let failure: unknown;
  try { result = await invoke(); }
  catch (error) { failure = error; }
  // Always attempt to detect mutations, including on reviewer failure.
  let after: GitIdentity;
  try { after = await capture(projectPath); }
  catch (error) {
    throw new Error('Reviewer integrity could not be verified; workflow blocked', { cause: error });
  }
  if (before.head !== after.head || before.branch !== after.branch ||
      before.worktreeHash !== after.worktreeHash) {
    throw new Error('Reviewer changed Git repository state; workflow blocked');
  }
  if (failure !== undefined) throw failure;
  return result as T;
}
