import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadonlyReviewerToolLaunch, type ReviewerSandboxSpec, type ReviewerSandboxLaunch } from './reviewer-sandbox-policy.ts';

const exec = promisify(execFile);
const OUTPUT_LIMIT = 128 * 1024;
const TIMEOUT_MS = 15000;
export type ReviewerToolExecutor = (launch: ReviewerSandboxLaunch, signal?: AbortSignal) => Promise<string>;

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
  } catch {
    throw new Error('Isolated reviewer tool failed; result cannot count as PASS');
  }
}
