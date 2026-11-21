import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export type SandboxProbeRunner = (args: readonly string[], cwd: string) => Promise<void>;

/** Categorize only recognized OS/process errors. Never forward raw stderr. */
export function classifySandboxError(error: unknown): NonNullable<SandboxProbeResult['detail']> {
  const item = error as { code?: unknown; killed?: unknown; stderr?: unknown } | null;
  if (item?.code === 'ETIMEDOUT' || item?.killed === true) return 'timeout';
  const stderr = typeof item?.stderr === 'string' ? item.stderr.slice(0, 8192) : '';
  if (/loopback.*(?:operation not permitted|permission denied)|RTM_NEWADDR/i.test(stderr)) return 'network-setup-denied';
  if (/(?:user namespace|namespace|uid map|gid map).*(?:operation not permitted|permission denied|not allowed)|no permissions to create new namespace/i.test(stderr)) return 'namespace-permission-denied';
  if (/(?:mount|bind|ro-bind).*(?:failed|permission denied|no such file or directory|operation not permitted)/i.test(stderr)) return 'mount-setup-failed';
  if (item?.code === 40) return 'canary-read-failed';
  if (item?.code === 41) return 'write-protection-failed';
  if (item?.code === 42) return 'canary-verification-failed';
  if (typeof item?.code === 'number') return 'probe-command-failed';
  return 'unknown';
}
export interface SandboxProbeResult {
  available: boolean;
  isolated: boolean;
  reason: 'passed' | 'unsupported-platform' | 'sandbox-failed' | 'canary-modified';
  detail: 'namespace-permission-denied' | 'network-setup-denied' | 'mount-setup-failed' | 'canary-read-failed' | 'write-protection-failed' | 'canary-verification-failed' | 'probe-command-failed' | 'timeout' | 'unknown' | null;
  exitCode: number | null;
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
    return { available: false, isolated: false, reason: 'unsupported-platform', detail: null, exitCode: null };

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'autodev-sandbox-probe-'));
  const canary = path.join(temp, 'canary.txt');
  try {
    fs.writeFileSync(canary, 'original', { flag: 'wx', mode: 0o600 });
    // Root is read-only; /tmp is a fresh tmpfs; network is disabled.
    // /tmp/probe contains only the canary, never the user's project.
    const args = [
      '--die-with-parent', '--unshare-net',
      '--ro-bind', '/', '/',
      // Create a writable mountpoint in the private tmpfs BEFORE the readonly bind.
      // /probe cannot be created on the read-only root mount.
      '--tmpfs', '/tmp',
      '--ro-bind', temp, '/tmp/probe',
      '--chdir', '/tmp/probe',
      '--', '/bin/sh', '-c',
      'test "$(cat /tmp/probe/canary.txt)" = original || exit 40; ' +
      'if printf modified > /tmp/probe/canary.txt 2>/dev/null; then exit 41; fi; ' +
      'test "$(cat /tmp/probe/canary.txt)" = original || exit 42',
    ];
    let runnerFailure: unknown = null;
    try { await runner(args, temp); }
    catch (error) { runnerFailure = error; }
    // Even if an injected or defective runner claims PASS, verify host canary.
    if (fs.readFileSync(canary, 'utf8') !== 'original')
      return { available: true, isolated: false, reason: 'canary-modified', detail: null, exitCode: null };
    if (runnerFailure !== null) {
      const code = (runnerFailure as { code?: unknown }).code;
      const exitCode = typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 255 ? code : null;
      return { available: true, isolated: false, reason: 'sandbox-failed',
        detail: classifySandboxError(runnerFailure), exitCode };
    }
    return { available: true, isolated: true, reason: 'passed', detail: null, exitCode: null };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
