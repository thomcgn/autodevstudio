import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export type SandboxProbeRunner = (args: readonly string[], cwd: string) => Promise<void>;
export interface SandboxProbeResult {
  available: boolean;
  isolated: boolean;
  reason: 'passed' | 'unsupported-platform' | 'sandbox-failed' | 'canary-modified';
}

/** A deliberate local smoke-test, not a production sandbox and not a model run.
 * An isolated throwaway file lives outside the selected project. No agent tools
 * or project commands are invoked. Output and paths never reach the renderer.
 */
export async function probeBubblewrap(
  runner: SandboxProbeRunner = async (args, cwd) => {
    await exec('bwrap', [...args], {
      cwd, timeout: 10000, maxBuffer: 8 * 1024, windowsHide: true,
      encoding: 'utf8',
    });
  },
): Promise<SandboxProbeResult> {
  if (process.platform !== 'linux')
    return { available: false, isolated: false, reason: 'unsupported-platform' };

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'autodev-sandbox-probe-'));
  const canary = path.join(temp, 'canary.txt');
  try {
    fs.writeFileSync(canary, 'original', { flag: 'wx', mode: 0o600 });
    // Root is read-only; /tmp is a fresh tmpfs; network is disabled.
    // /probe contains only the canary, never the user's project.
    const args = [
      '--die-with-parent', '--unshare-net',
      '--ro-bind', '/', '/',
      '--proc', '/proc',
      '--tmpfs', '/tmp',
      '--ro-bind', temp, '/probe',
      '--chdir', '/probe',
      '--', '/bin/sh', '-c',
      'test "$(cat /probe/canary.txt)" = original || exit 40; ' +
      'if printf modified > /probe/canary.txt 2>/dev/null; then exit 41; fi; ' +
      'test "$(cat /probe/canary.txt)" = original || exit 42',
    ];
    let runnerFailed = false;
    try { await runner(args, temp); }
    catch { runnerFailed = true; }
    // Even if an injected or defective runner claims PASS, verify host canary.
    if (fs.readFileSync(canary, 'utf8') !== 'original')
      return { available: true, isolated: false, reason: 'canary-modified' };
    return runnerFailed
      ? { available: true, isolated: false, reason: 'sandbox-failed' }
      : { available: true, isolated: true, reason: 'passed' };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
