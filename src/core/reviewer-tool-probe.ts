import { runReadonlyReviewerTool, ReviewerToolFailure, type ReviewerToolExecutor, type ReviewerToolFailureReason } from './reviewer-tool-runner.ts';

export interface ReviewerToolProbe {
  supported: boolean;
  passed: boolean;
  reason: 'passed' | 'unsupported-platform' | 'tool-failed';
  detail: ReviewerToolFailureReason | null;
}

/** Read-only local validation of the actual sandboxed Git binary.
 * It never launches Kilo, changes Git state or returns the command output
 * to the renderer; results cannot activate production workflow by themselves.
 */
export async function probeReadonlyReviewerTool(
  projectPath: string,
  executor?: ReviewerToolExecutor,
): Promise<ReviewerToolProbe> {
  if (process.platform !== 'linux') {
    return { supported: false, passed: false, reason: 'unsupported-platform', detail: null };
  }
  try {
    const result = await runReadonlyReviewerTool({
      projectPath, binary: '/usr/bin/git',
      args: ['--no-pager','status','--porcelain=v1','--untracked-files=all'],
    }, undefined, executor);
    if (!result.isolated || !result.readonly)
      return { supported: true, passed: false, reason: 'tool-failed', detail: null };
    return { supported: true, passed: true, reason: 'passed', detail: null };
  } catch {
    return { supported: true, passed: false, reason: 'tool-failed' };
  }
}
