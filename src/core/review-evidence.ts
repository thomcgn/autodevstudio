import { createHash } from 'node:crypto';
import { captureGitIdentity } from './git-identity.ts';
import { runReadonlyReviewerTool, type ReviewerToolOutput } from './reviewer-tool-runner.ts';
import type { GitIdentity } from './checkpoint-store.ts';

export interface ReviewEvidence {
  identity: GitIdentity;
  status: string;
  unstagedDiff: string;
  stagedDiff: string;
  recentCommits: string;
  fingerprint: string;
}
export type ReviewEvidenceTool = (
  projectPath: string, args: readonly string[], signal?: AbortSignal
) => Promise<ReviewerToolOutput>;
export type ReviewEvidenceIdentity = (projectPath: string) => Promise<GitIdentity>;
const COMMANDS = {
  status: ['--no-pager','status','--porcelain=v1','--untracked-files=all'],
  unstagedDiff: ['--no-pager','diff','--no-ext-diff','--no-textconv','--'],
  stagedDiff: ['--no-pager','diff','--cached','--no-ext-diff','--no-textconv','--'],
  recentCommits: ['--no-pager','log','-5','--format=%h %s'],
} as const;
const PER_COMMAND_BYTES = 128 * 1024;
const TOTAL_BYTES = 256 * 1024;

/** Takes bounded, immutable-in-time reviewer evidence from the strictly offline,
 * read-only tool runner. All content remains inside the trusted controller.
 * Untracked content is included in the identity hash, but is NOT sent as raw file
 * contents. This is not permission to invoke a Kilo reviewer or publish a PR.
 */
export async function collectReviewEvidence(
  projectPath: string,
  signal?: AbortSignal,
  tool: ReviewEvidenceTool = (cwd,args,abort) =>
    runReadonlyReviewerTool({projectPath:cwd,binary:'/usr/bin/git',args},abort),
  capture: ReviewEvidenceIdentity = captureGitIdentity,
): Promise<ReviewEvidence> {
  if (signal?.aborted) throw new Error('Review evidence cancelled before start');
  const before = await capture(projectPath);
  const values: Record<keyof typeof COMMANDS,string> = {
    status:'',unstagedDiff:'',stagedDiff:'',recentCommits:'',
  };
  let total = 0;
  for (const name of Object.keys(COMMANDS) as Array<keyof typeof COMMANDS>) {
    if (signal?.aborted) throw new Error('Review evidence cancelled');
    const outcome = await tool(projectPath,COMMANDS[name],signal);
    if (!outcome.isolated || !outcome.readonly || typeof outcome.output !== 'string') {
      throw new Error('Reviewer evidence tool was not isolated and readonly');
    }
    const bytes=Buffer.byteLength(outcome.output);
    total+=bytes;
    if (bytes>PER_COMMAND_BYTES || total>TOTAL_BYTES) {
      throw new Error('Reviewer evidence exceeds output limits');
    }
    values[name]=outcome.output;
  }
  if (signal?.aborted) throw new Error('Review evidence cancelled');
  const after=await capture(projectPath);
  if (before.head!==after.head || before.branch!==after.branch ||
      before.worktreeHash!==after.worktreeHash) {
    throw new Error('Repository changed while review evidence was collected');
  }
  const hash=createHash('sha256');
  for(const field of [before.head,before.branch,before.worktreeHash,
    values.status,values.unstagedDiff,values.stagedDiff,values.recentCommits]) {
    const content=Buffer.from(field,'utf8');
    hash.update(String(content.length)+':').update(content);
  }
  return {identity:before,...values,fingerprint:hash.digest('hex')};
}
