import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const exec = promisify(execFile);
export type GitCommand = (args: readonly string[], cwd: string) => Promise<string>;
const runGit: GitCommand = async (args, cwd) => {
  const result = await exec('git', [...args], { cwd, timeout: 10000,
    maxBuffer: 2 * 1024 * 1024, encoding: 'utf8', windowsHide: true });
  return result.stdout;
};
export interface GitPreflight {
  root: string;
  branch: string;
  head: string;
  remoteSlug: string | null;
  clean: boolean;
  canExecute: boolean;
  reasons: string[];
}

export function parseGitHubRemote(raw: string): string | null {
  const url = raw.trim();
  const ssh = /^git@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url);
  if (ssh) return ssh[1];
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com' || parsed.protocol !== 'https:' ||
        parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    const match = /^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(parsed.pathname);
    return match ? match[1] + '/' + match[2] : null;
  } catch { return null; }
}

const PROTECTED = new Set(['main','master','develop','development','production','release']);

export async function inspectGitPreflight(directory: string, runner: GitCommand = runGit): Promise<GitPreflight> {
  const root = fs.realpathSync(directory);
  if (!fs.statSync(root).isDirectory()) throw new Error('Repository path is not a directory');
  const reasons: string[] = [];
  const top = (await runner(['rev-parse','--show-toplevel'], root)).trim();
  if (fs.realpathSync(top) !== root) {
    throw new Error('Selected folder is not the Git repository root');
  }
  const head = (await runner(['rev-parse','--verify','HEAD'], root)).trim();
  if (!/^[0-9a-f]{40,64}$/.test(head)) throw new Error('Invalid Git HEAD');
  let branch = '';
  try { branch = (await runner(['symbolic-ref','--quiet','--short','HEAD'], root)).trim(); }
  catch { reasons.push('Detached HEAD – no branch selected'); }
  if (branch && PROTECTED.has(branch.toLowerCase())) {
    reasons.push('Protected branch – create an isolated feature branch first');
  }
  let remoteSlug: string | null = null;
  try { remoteSlug = parseGitHubRemote(await runner(['remote','get-url','origin'],root)); }
  catch { reasons.push('No origin remote configured'); }
  if (!remoteSlug && !reasons.includes('No origin remote configured')) {
    reasons.push('Origin must be a GitHub SSH or HTTPS remote without embedded credentials');
  }
  const changes = await runner(['status','--porcelain=v1','--untracked-files=all','-z'], root);
  const clean = changes.length === 0;
  if (!clean) reasons.push('Uncommitted/staged/untracked changes – avoid inherited changes');
  return { root: path.normalize(root), branch, head, remoteSlug, clean,
    canExecute: reasons.length === 0, reasons };
}

/** This is an advisory gate until the standalone controller invokes it immediately
 * before any mutation. UI display alone does NOT authorize execution. */
export function assertGitPreflightReady(status: GitPreflight): void {
  if (!status.canExecute || status.reasons.length > 0 || !status.clean ||
      !status.remoteSlug || !status.branch) {
    throw new Error('Git preflight failed: ' + (status.reasons.join('; ') || 'Invalid readiness'));
  }
}
