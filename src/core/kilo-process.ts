import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

export type AgentRole = 'planner' | 'builder' | 'reviewer';
export type KiloStream = 'stdout' | 'stderr';
export interface KiloInvocation {
  cwd: string;
  role: AgentRole;
  agent: string;
  model: string;
  prompt: string;
  /** Without --auto the CLI may never automatically approve tool execution. */
  autoApprove?: boolean;
  resumeSessionId?: string;
  inactivityTimeoutMs: number;
  heartbeatIntervalMs?: number;
  signal?: AbortSignal;
  onOutput?: (stream: KiloStream, text: string) => void;
  onSessionId?: (sessionId: string) => void;
  onHeartbeat?: (silenceMs: number, elapsedMs: number) => void;
  /** Isolated test injection. Production always uses direct spawn without a shell. */
  spawnProcess?: (binary: string, args: string[], options: SpawnOptions) => ChildProcess;
}
export interface KiloInvocationResult {
  output: string;
  sessionId: string | null;
  elapsedMs: number;
}
export class KiloProcessError extends Error {
  readonly reason: 'spawn' | 'exit' | 'abort' | 'inactivity' | 'permission';
  readonly sessionId: string | null;
  constructor(message: string, reason: KiloProcessError['reason'], sessionId: string | null) {
    super(message);
    this.reason = reason;
    this.sessionId = sessionId;
  }
}

const SESSION_PATTERN = /\bsession(?:[ \t]+id)?[ \t]*[:=][ \t]*([a-zA-Z0-9_-]{8,128})/i;
const OUTPUT_LIMIT = 256 * 1024;
const PROMPT_LIMIT = 32 * 1024;

export function createKiloArgs(input: Pick<KiloInvocation, 'agent' | 'model' | 'prompt' | 'resumeSessionId' | 'autoApprove'>): string[] {
  if (!/^[\w][\w.-]{0,100}$/.test(input.agent) || !/^[\w][\w./:-]{0,160}$/.test(input.model)) {
    throw new Error('Invalid agent or model');
  }
  if (!input.prompt.trim() || Buffer.byteLength(input.prompt) > PROMPT_LIMIT) throw new Error('Invalid prompt length');
  if (input.resumeSessionId && !/^[a-zA-Z0-9_-]{8,128}$/.test(input.resumeSessionId)) throw new Error('Invalid resume session ID');
  const args = ['run', ...(input.autoApprove===false?[]:['--auto']), '--model', input.model, '--agent', input.agent];
  if (input.resumeSessionId) args.push('--session', input.resumeSessionId);
  args.push(input.prompt);
  return args;
}

/** Provider process primitive only; never called from renderer or enabled for production yet.
 * No shell, no Git operations, no implicit retry, and no auto publication.
 * Studio's caller must persist a session ID immediately through onSessionId.
 */
export function runKilo(input: KiloInvocation): Promise<KiloInvocationResult> {
  // This runner passes --auto, which can approve model-requested tool actions.
  // An independent reviewer MUST use a separate tool-free, OS-isolated transport.
  if (input.role === 'reviewer') {
    return Promise.reject(new KiloProcessError(
      'Unisolated Kilo reviewer execution is forbidden', 'permission', null));
  }
  if (!Number.isFinite(input.inactivityTimeoutMs) || input.inactivityTimeoutMs < 100 ||
      input.inactivityTimeoutMs > 60 * 60 * 1000) throw new Error('Invalid inactivity timeout');
  const interval = input.heartbeatIntervalMs ?? 30_000;
  if (!Number.isFinite(interval) || interval < 10 || interval > input.inactivityTimeoutMs) {
    throw new Error('Invalid heartbeat interval');
  }
  const args = createKiloArgs(input);
  if (input.signal?.aborted) {
    return Promise.reject(new KiloProcessError('Agent cancelled before start', 'abort', input.resumeSessionId ?? null));
  }
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let lastOutput = start;
    let tail = '';
    let sessionId: string | null = input.resumeSessionId ?? null;
    let failure: Error | null = null;
    let stopping: 'abort' | 'inactivity' | null = null;
    let finished = false;
    let forced: NodeJS.Timeout | null = null;
    const detached = process.platform !== 'win32';
    let child: ChildProcess;
    try {
      child = (input.spawnProcess ?? spawn)('kilo', args,
        { cwd: input.cwd, detached, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(new KiloProcessError(String(error), 'spawn', sessionId));
      return;
    }
    const sendSignal = (signal: NodeJS.Signals): void => {
      try {
        if (detached && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* already exited */ }
    };
    const stop = (reason: 'abort' | 'inactivity'): void => {
      if (finished || stopping) return;
      stopping = reason;
      sendSignal('SIGTERM');
      forced = setTimeout(() => { if (!finished) sendSignal('SIGKILL'); }, 4000);
      forced.unref();
    };
    const onAbort = (): void => stop('abort');
    input.signal?.addEventListener('abort', onAbort, { once: true });
    if (input.signal?.aborted) stop('abort');

    const accept = (stream: KiloStream, chunk: Buffer | string): void => {
      const text = chunk.toString();
      lastOutput = Date.now();
      tail = (tail + text).slice(-OUTPUT_LIMIT);
      const match = tail.slice(-1024).match(SESSION_PATTERN);
      if (match && match[1] !== sessionId) {
        sessionId = match[1];
        try { input.onSessionId?.(sessionId); }
        catch (error) { failure = error instanceof Error ? error : new Error(String(error)); stop('abort'); }
      }
      try { input.onOutput?.(stream, text); }
      catch (error) { failure = error instanceof Error ? error : new Error(String(error)); stop('abort'); }
    };
    child.stdout?.on('data', (chunk: Buffer) => accept('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => accept('stderr', chunk));
    child.on('error', (error: Error) => { failure = error; });
    const heartbeat = setInterval(() => {
      if (finished) return;
      const silence = Date.now() - lastOutput;
      try { input.onHeartbeat?.(silence, Date.now() - start); }
      catch (error) { failure = error instanceof Error ? error : new Error(String(error)); stop('abort'); }
      if (silence >= input.inactivityTimeoutMs) stop('inactivity');
    }, interval);
    heartbeat.unref();

    child.on('close', (code, signal) => {
      finished = true;
      clearInterval(heartbeat);
      if (forced) clearTimeout(forced);
      input.signal?.removeEventListener('abort', onAbort);
      const reason = stopping ?? (failure ? 'spawn' : code === 0 && !signal ? null : 'exit');
      if (reason) {
        reject(new KiloProcessError(`Kilo ${input.role}: ${reason}, exit ${code}, signal ${signal}; ${failure?.message ?? ''}`,
          reason, sessionId));
      } else if (/auto-rejected permission|user rejected permission/i.test(tail)) {
        reject(new KiloProcessError('Kilo rejected a tool permission', 'permission', sessionId));
      } else {
        resolve({ output: tail, sessionId, elapsedMs: Date.now() - start });
      }
    });
  });
}
