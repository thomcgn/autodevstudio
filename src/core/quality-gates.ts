import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { QualityResult } from './orchestrator.ts';

const SCRIPT_NAME = /^[a-zA-Z][a-zA-Z0-9:_-]{0,79}$/;
const MAX_PACKAGE_BYTES = 256 * 1024;
const MAX_LOG_BYTES = 32 * 1024;

export interface QualityGateConfig {
  /** Exact repository root, never a user-supplied subdirectory. */
  cwd: string;
  /** Explicitly approved package.json scripts, in execution order. */
  scripts: readonly string[];
  timeoutMs: number;
  signal?: AbortSignal;
  onOutput?: (script: string, stream: 'stdout' | 'stderr', text: string) => void;
}

export type QualityScriptRunner = (
  cwd: string, script: string, timeoutMs: number, signal?: AbortSignal,
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void,
) => Promise<void>;

function readAvailableScripts(root: string): Record<string, unknown> {
  const file = path.join(root, 'package.json');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PACKAGE_BYTES) {
    throw new Error('Unsafe package.json for quality gates');
  }
  const packageData: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!packageData || typeof packageData !== 'object' || Array.isArray(packageData)) {
    throw new Error('Invalid package.json');
  }
  const scripts = (packageData as { scripts?: unknown }).scripts;
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
    throw new Error('No package.json scripts defined');
  }
  return scripts as Record<string, unknown>;
}

/** Scripts themselves can execute arbitrary code. The controller must explicitly
 * trust the repository and configured script names before invoking this function.
 * Never derive script names from issue text or agent output.
 */
export async function runTrustedQualityGates(
  config: QualityGateConfig, runner: QualityScriptRunner = runNpmScript,
): Promise<QualityResult> {
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1000 ||
      config.timeoutMs > 30 * 60 * 1000) throw new Error('Invalid gate timeout');
  if (!Array.isArray(config.scripts) || config.scripts.length === 0 || config.scripts.length > 10 ||
      new Set(config.scripts).size !== config.scripts.length ||
      config.scripts.some(name => typeof name !== 'string' || !SCRIPT_NAME.test(name))) {
    throw new Error('Quality gates require distinct, explicitly configured script names');
  }
  const root = fs.realpathSync(config.cwd);
  if (!fs.statSync(root).isDirectory()) throw new Error('Invalid project root');
  const scripts = readAvailableScripts(root);
  for (const name of config.scripts) {
    if (typeof scripts[name] !== 'string' || !(scripts[name] as string).trim()) {
      throw new Error('Required quality gate script is unavailable: ' + name);
    }
  }
  for (const name of config.scripts) {
    if (config.signal?.aborted) return { passed: false, feedback: 'Quality gates cancelled' };
    try {
      await runner(root, name, config.timeoutMs, config.signal,
        (stream, text) => config.onOutput?.(name, stream, text));
    } catch (error) {
      return { passed: false, feedback: 'Quality gate ' + name + ' failed: ' +
        (error instanceof Error ? error.message.slice(0, 500) : 'unknown error') };
    }
  }
  return { passed: true, summary: 'Required quality gates passed: ' + config.scripts.join(', ') };
}

/** Explicit npm script name, no shell invocation by Studio. Note that npm
 * scripts are project-controlled programs, not inherently read-only.
 */
export function runNpmScript(
  cwd: string, script: string, timeoutMs: number, signal?: AbortSignal,
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void,
): Promise<void> {
  if (!SCRIPT_NAME.test(script)) return Promise.reject(new Error('Invalid gate script name'));
  if (signal?.aborted) return Promise.reject(new Error('Cancelled before gate start'));
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', '--', script], {
      cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
    });
    let closed = false;
    let logBytes = 0;
    let stopRequested = false;
    let failure: Error | null = null;
    let forceTimer: NodeJS.Timeout | undefined;
    const kill = (): void => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch { /* exited */ }
      forceTimer = setTimeout(() => {
        if (closed) return;
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch { /* exited */ }
      }, 3000);
      forceTimer.unref();
    };
    const interrupt = (reason: string): void => {
      if (closed || stopRequested) return;
      stopRequested = true;
      failure = new Error(reason);
      kill();
    };
    const onAbort = (): void => interrupt('Cancelled');
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const timeout = setTimeout(() => interrupt('Timed out'), timeoutMs);
    timeout.unref();
    const accept = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      if (logBytes >= MAX_LOG_BYTES) return;
      const limited = chunk.subarray(0, MAX_LOG_BYTES - logBytes);
      logBytes += limited.length;
      try { onOutput?.(stream, limited.toString('utf8')); }
      catch { interrupt('Quality log sink rejected output'); }
    };
    child.stdout?.on('data', (chunk: Buffer) => accept('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => accept('stderr', chunk));
    child.on('error', err => { failure = err; });
    child.on('close', (code, sig) => {
      closed = true;
      clearTimeout(timeout);
      if (forceTimer) clearTimeout(forceTimer);
      signal?.removeEventListener('abort', onAbort);
      if (failure) reject(failure);
      else if (code !== 0 || sig) reject(new Error('Exit code ' + code + (sig ? ', signal ' + sig : '')));
      else resolve();
    });
  });
}
