import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectProjectLock } from './project-lock.ts';
import { inspectGitPreflight, parseGitHubRemote } from './git-preflight.ts';

const exec = promisify(execFile);
export type BranchRunner = (args: readonly string[], cwd: string) => Promise<string>;
const defaultRunner: BranchRunner = async (args,cwd) =>
  (await exec('git',[...args],{cwd,encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024,
    windowsHide:true,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}})).stdout;
export interface IssueBranch { branch: string; startingHead: string; remoteSlug: string }
const PROTECTED_REASON = 'Protected branch – create an isolated feature branch first';

/** Only call after acquiring the project lock in the trusted Studio controller.
 * No worktrees, reset, commit, push, or force; the old branch is not modified.
 */
export async function prepareIssueBranch(
  base:string, directory:string, token:string, issueNumber:number,
  git:BranchRunner=defaultRunner,
):Promise<IssueBranch> {
  if (!Number.isSafeInteger(issueNumber) || issueNumber<1 || issueNumber>1_000_000_000)
    throw new Error('Invalid issue number');
  const root=fs.realpathSync(directory);
  const assertOwner=():void=>{
    if (!token || inspectProjectLock(base,root)?.token!==token)
      throw new Error('Issue branch preparation requires owned project lock');
  };
  assertOwner();
  const ready=await inspectGitPreflight(root,git);
  const problems=ready.reasons.filter(reason=>reason!==PROTECTED_REASON);
  if (!ready.clean || !ready.branch || !ready.remoteSlug || problems.length)
    throw new Error('Unsafe branch preparation: '+(problems.join('; ')||'invalid readiness'));
  if (ready.branch.startsWith('autodev/'))
    throw new Error('Existing AutoDev branch requires explicit completion or recovery');
  const name='autodev/issue-'+issueNumber;
  if (ready.branch===name) throw new Error('Issue branch already active');
  if ((await git(['branch','--list','--format=%(refname:short)',name],root)).trim())
    throw new Error('Issue branch already exists; explicit recovery required');
  // Revalidate immediately before the one mutation; never inherit user changes.
  assertOwner();
  const currentHead=(await git(['rev-parse','--verify','HEAD'],root)).trim();
  const currentBranch=(await git(['symbolic-ref','--quiet','--short','HEAD'],root)).trim();
  const currentRemote=parseGitHubRemote(await git(['remote','get-url','origin'],root));
  const status=await git(['status','--porcelain=v1','--untracked-files=all','-z'],root);
  if (currentHead!==ready.head || currentBranch!==ready.branch ||
      currentRemote!==ready.remoteSlug || status.length)
    throw new Error('Git drift before issue branch creation');
  await git(['switch','-c',name],root);
  const after=await inspectGitPreflight(root,git);
  if (!after.canExecute || !after.clean || after.head!==ready.head ||
      after.branch!==name || after.remoteSlug!==ready.remoteSlug)
    throw new Error('Issue branch needs manual inspection after creation');
  return {branch:name,startingHead:ready.head,remoteSlug:ready.remoteSlug};
}
