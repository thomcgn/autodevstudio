import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export interface ProjectLockRecord {
  token: string; pid: number; startedAt: string; projectKey: string;
}
export interface AcquiredProjectLock {
  readonly record: ProjectLockRecord;
  release(): void;
}
export function keyForProject(projectPath: string): string {
  const canonical = fs.realpathSync(projectPath);
  if (!fs.statSync(canonical).isDirectory()) throw new Error('Not a project directory');
  return createHash('sha256').update(canonical).digest('hex');
}
function lockDirectory(base: string, key: string): string {
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('Invalid project key');
  const root = path.join(base, 'core-locks');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  return path.join(root, key + '.lock');
}
function lockOwner(dir: string): ProjectLockRecord | null {
  try {
    const meta = fs.lstatSync(dir);
    if (!meta.isDirectory() || meta.isSymbolicLink()) return null;
    const file = path.join(dir, 'owner.json');
    if (fs.statSync(file).size > 4096) return null;
    const item: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!item || typeof item !== 'object') return null;
    const record = item as ProjectLockRecord;
    return typeof record.token === 'string' && typeof record.pid === 'number' &&
      typeof record.projectKey === 'string' && typeof record.startedAt === 'string' ? record : null;
  } catch { return null; }
}
export function inspectProjectLock(base: string, projectPath: string): ProjectLockRecord | null {
  return lockOwner(lockDirectory(base, keyForProject(projectPath)));
}

/** A malformed or ownerless lock must still be shown as occupied: acquisition
 * refuses its directory and manual recovery is required.
 */
export function projectLockDirectoryExists(base: string, projectPath: string): boolean {
  const dir = lockDirectory(base, keyForProject(projectPath));
  try { fs.lstatSync(dir); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Directory creation is atomic across Studio instances; locked directories are never
 * reclaimed automatically, even when a PID appears dead. Recovery requires explicit action.
 */
export function acquireProjectLock(base: string, projectPath: string): AcquiredProjectLock {
  const projectKey = keyForProject(projectPath);
  const dir = lockDirectory(base, projectKey);
  try { fs.mkdirSync(dir, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('This Git project is locked by another run; explicit recovery required');
    }
    throw error;
  }
  const record: ProjectLockRecord = {
    token: randomUUID(), pid: process.pid, startedAt: new Date().toISOString(), projectKey,
  };
  try { fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify(record), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    try { fs.rmdirSync(dir); } catch { /* preserve unexpected contents */ }
    throw error;
  }
  let released = false;
  return {
    record,
    release() {
      if (released) return;
      const owner = lockOwner(dir);
      if (!owner || owner.token !== record.token || owner.projectKey !== projectKey) {
        throw new Error('Lock ownership has changed; refusing to release');
      }
      fs.unlinkSync(path.join(dir, 'owner.json'));
      fs.rmdirSync(dir);
      released = true;
    },
  };
}
