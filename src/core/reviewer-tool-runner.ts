import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadonlyReviewerToolLaunch, type ReviewerSandboxSpec, type ReviewerSandboxLaunch } from './reviewer-sandbox-policy.ts';

const exec = promisify(execFile);
const OUTPUT_LIMIT = 128 * 1024;
const TIMEOUT_MS = 15000;
export type ReviewerToolExecutor = (launch: ReviewerSandboxLaunch, signal?: AbortSignal) => Promise<string>;

export type ReviewerToolFailureReason =
  | 'mountpoint-failed' | 'runtime-library-missing' | 'git-repository-rejected'
  | 'git-command-failed' | 'timeout' | 'sandbox-launch-failed';

export class ReviewerToolFailure extends Error {
  constructor(readonly reason: ReviewerToolFailureReason) {
    super('Isolated reviewer tool failed; result cannot count as PASS');
  }
}
/** No raw stderr, paths or credentials cross the trust boundary. */
function classifyReviewerFailure(error: unknown): ReviewerToolFailureReason {
  const e = error as { code?: unknown; killed?: unknown; stderr?: unknown };
  if (e?.code === 'ETIMEDOUT' || e?.killed === true) return 'timeout';
  const stderr = typeof e?.stderr === 'string' ? e.stderr.slice(0, 4096) : '';
  if (/Can't create file|Read-only file system|Creating new namespace failed|mount.*(?:failed|denied)/i.test(stderr))
    return 'mountpoint-failed';
  if (/error while loading shared libraries|No such file or directory.*\/usr\/bin\/git|cannot execute binary file/i.test(stderr))
    return 'runtime-library-missing';
  if (/not a git repository|dubious ownership|unsafe repository|detected dubious ownership/i.test(stderr))
    return 'git-repository-rejected';
  if (typeof e?.code === 'number') return 'git-command-failed';
  return 'sandbox-launch-failed';
}


const executeSandbox: ReviewerToolExecutor = async (launch, signal) => {
  const result = await exec(launch.binary, launch.args, {
    cwd: launch.cwd,
    timeout: TIMEOUT_MS, maxBuffer: OUTPUT_LIMIT,
    encoding: 'utf8', windowsHide: true, shell: false, signal,
    env: { PATH: '/usr/bin:/bin', LANG: 'C' },
  });
  return result.stdout;
};

export interface ReviewerToolOutput {
  output: string;
  isolated: true;
  readonly: true;
}

/** Only runs a narrowly constrained offline reviewer tool under Bubblewrap.
 * It is not a model runner: Kilo credentials and API/network access are
 * intentionally absent. Real provider/tool transport remains future work.
 *
 * Never return raw process errors, which can contain private host paths.
 */
export async function runReadonlyReviewerTool(
  spec: ReviewerSandboxSpec,
  signal?: AbortSignal,
  executor: ReviewerToolExecutor = executeSandbox,
): Promise<ReviewerToolOutput> {
  if (signal?.aborted) throw new Error('Reviewer tool cancelled before start');
  const launch = createReadonlyReviewerToolLaunch(spec);
  try {
    const output = await executor(launch, signal);
    if (typeof output !== 'string' || Buffer.byteLength(output) > OUTPUT_LIMIT) {
      throw new Error('Reviewer tool output invalid or oversized');
    }
    if (signal?.aborted) throw new Error('Reviewer tool cancelled');
    return { output, isolated: true, readonly: true };
  } catch (error) {
    throw error instanceof ReviewerToolFailure
      ? error : new ReviewerToolFailure(classifyReviewerFailure(error));
  }
}
