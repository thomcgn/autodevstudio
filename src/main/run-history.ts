import fs from 'node:fs';
import path from 'node:path';

export type RunMode = 'status' | 'dry-run' | 'execute';
export type RunOutcome = 'running' | 'success' | 'failed' | 'interrupted';
export interface RunRecord {
  runId: string;
  projectId: string;
  projectName: string;
  mode: RunMode;
  startedAt: number;
  endedAt: number | null;
  outcome: RunOutcome;
  exitCode: number | null;
  signal: string | null;
  bytesLogged: number;
  truncated: boolean;
}

const RUN_LIMIT = 5 * 1024 * 1024;
const MAX_ITEMS = 150;
const ID = /^[a-f0-9-]{36}$/i;

export class RunHistory {
  private readonly base: string;
  constructor(base: string) { this.base = base; }

  private directory(): string {
    const dir = path.join(this.base, 'run-history');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  private recordFile(id: string): string {
    if (!ID.test(id)) throw new Error('Invalid run ID');
    return path.join(this.directory(), id + '.json');
  }

  private logFile(id: string): string {
    if (!ID.test(id)) throw new Error('Invalid run ID');
    return path.join(this.directory(), id + '.log');
  }

  private read(id: string): RunRecord | null {
    try {
      const data: unknown = JSON.parse(fs.readFileSync(this.recordFile(id), 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      const record = data as RunRecord;
      return record.runId === id && typeof record.projectId === 'string'
        && typeof record.startedAt === 'number' && typeof record.mode === 'string' ? record : null;
    } catch { return null; }
  }

  private write(record: RunRecord): void {
    const target = this.recordFile(record.runId);
    const temp = target + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(record, null, 2), { mode: 0o600 });
    fs.renameSync(temp, target);
  }

  start(record: Pick<RunRecord, 'runId' | 'projectId' | 'projectName' | 'mode' | 'startedAt'>): void {
    if (this.read(record.runId)) throw new Error('Run already exists');
    fs.writeFileSync(this.logFile(record.runId), '', { flag: 'wx', mode: 0o600 });
    this.write({ ...record, endedAt: null, outcome: 'running', exitCode: null,
      signal: null, bytesLogged: 0, truncated: false });
  }

  append(id: string, stream: 'stdout' | 'stderr', message: string): void {
    const record = this.read(id);
    if (!record || record.outcome !== 'running' || record.truncated) return;
    const line = `[${new Date().toISOString()}] [${stream}] ${message}`;
    const bytes = Buffer.from(line, 'utf8');
    const remaining = RUN_LIMIT - record.bytesLogged;
    if (remaining <= 0) {
      record.truncated = true;
    } else {
      const portion = bytes.subarray(0, remaining);
      fs.appendFileSync(this.logFile(id), portion);
      record.bytesLogged += portion.length;
      if (portion.length < bytes.length) record.truncated = true;
    }
    if (record.truncated) fs.appendFileSync(this.logFile(id), '\n[Studio: log limit reached]\n');
    this.write(record);
  }

  finish(id: string, code: number | null, signal: string | null): void {
    const record = this.read(id);
    if (!record || record.outcome !== 'running') return;
    record.endedAt = Date.now();
    record.exitCode = code;
    record.signal = signal;
    record.outcome = signal ? 'interrupted' : code === 0 ? 'success' : 'failed';
    this.write(record);
  }

  // Called once on startup; a prior Studio crash cannot imply successful completion.
  recoverInterrupted(): void {
    for (const record of this.listAll()) {
      if (record.outcome === 'running') {
        record.outcome = 'interrupted';
        record.endedAt = Date.now();
        this.write(record);
      }
    }
  }

  private listAll(): RunRecord[] {
    let files: string[];
    try { files = fs.readdirSync(this.directory()).filter(f => ID.test(f.slice(0, -5)) && f.endsWith('.json')); }
    catch { return []; }
    return files.flatMap(f => { const record = this.read(f.slice(0, -5)); return record ? [record] : []; })
      .sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_ITEMS);
  }

  list(projectId: string): RunRecord[] {
    return this.listAll().filter(record => record.projectId === projectId);
  }

  getLog(projectId: string, id: string): string {
    const record = this.read(id);
    if (!record || record.projectId !== projectId) throw new Error('Run not found in selected project');
    // Recent tail only; no path from renderer is ever read.
    const data = fs.readFileSync(this.logFile(id));
    return data.subarray(Math.max(0, data.length - 512 * 1024)).toString('utf8');
  }
}
