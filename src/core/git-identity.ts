import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { GitIdentity } from './checkpoint-store.ts';

const exec = promisify(execFile);
const MAX_OUTPUT = 16 * 1024 * 1024;
const MAX_UNTRACKED_FILE = 16 * 1024 * 1024;
const MAX_UNTRACKED_TOTAL = 64 * 1024 * 1024;

async function git(cwd: string, args: string[]): Promise<Buffer> {
  const result = await exec('git', args, {
    cwd, encoding: 'buffer', timeout: 15000, maxBuffer: MAX_OUTPUT,
    windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  return result.stdout;
}

function gitText(value: Buffer): string {
  return value.toString('utf8').trim();
}
function addField(hash: ReturnType<typeof createHash>, name: string, value: Buffer): void {
  hash.update(name + ':' + value.length + ':');
  hash.update(value);
  hash.update(';');
}

/** Capture actual local Git identity immediately before a workflow or resume.
 * Hash covers staged and unstaged tracked diffs, repository status, plus untracked
 * file contents. Git never mutates the project here. Oversized/unsafe states fail closed.
 * This is a drift detector, NOT a sandbox or authorization to execute/publish.
 */
export async function captureGitIdentity(directory: string): Promise<GitIdentity> {
  const root = fs.realpathSync(directory);
  if (!fs.statSync(root).isDirectory()) throw new Error('Invalid project directory');
  const top = fs.realpathSync(gitText(await git(root, ['rev-parse', '--show-toplevel'])));
  if (root !== top) throw new Error('Selected directory is not the repository root');
  const head = gitText(await git(root, ['rev-parse', '--verify', 'HEAD']));
  if (!/^[0-9a-f]{40,64}$/.test(head)) throw new Error('Invalid Git HEAD');
  const branch = gitText(await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']));
  if (!branch || branch.includes('\0')) throw new Error('Detached or invalid Git branch');

  const status = await git(root, ['status', '--porcelain=v1', '--untracked-files=all', '-z']);
  const trackedDiff = await git(root, ['-c', 'diff.external=', 'diff', '--no-ext-diff',
    '--binary', '--submodule=log', 'HEAD', '--']);
  const untrackedPaths = await git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  const hash = createHash('sha256');
  addField(hash, 'status', status);
  addField(hash, 'tracked-diff', trackedDiff);
  let total = 0;
  for (const relative of untrackedPaths.toString('utf8').split('\0').filter(Boolean).sort()) {
    // Git emits repository-relative paths, but refuse an unexpected escape anyway.
    const full = path.resolve(root, relative);
    const rel = path.relative(root, full);
    if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel) ||
        rel.split(path.sep).includes('.git')) {
      throw new Error('Unsafe untracked path');
    }
    const stat = fs.lstatSync(full);
    let content: Buffer;
    if (stat.isSymbolicLink()) {
      content = Buffer.from('symlink:' + fs.readlinkSync(full));
    } else if (stat.isFile()) {
      if (stat.size > MAX_UNTRACKED_FILE || total + stat.size > MAX_UNTRACKED_TOTAL) {
        throw new Error('Untracked content exceeds fingerprint limits');
      }
      content = fs.readFileSync(full);
      if (content.length !== stat.size) throw new Error('Untracked file changed during fingerprint');
      total += content.length;
    } else {
      throw new Error('Untracked path is not a regular file or symlink');
    }
    addField(hash, 'path', Buffer.from(relative));
    addField(hash, 'content', content);
  }
  // Detect quick working-tree changes during capture; a later resume still
  // requires an exact HEAD/branch/hash match under the project's exclusive lock.
  const statusAfter = await git(root, ['status', '--porcelain=v1', '--untracked-files=all', '-z']);
  if (!status.equals(statusAfter)) throw new Error('Git status changed during fingerprint');
  return { head, branch, worktreeHash: hash.digest('hex') };
}
