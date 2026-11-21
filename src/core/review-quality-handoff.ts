import {runGuardedEvidenceReview,type GuardedReviewDependencies} from './guarded-evidence-review.ts';
import {loadCoreCheckpoint,saveCoreCheckpoint,type GitIdentity} from './checkpoint-store.ts';
import {inspectProjectLock} from './project-lock.ts';
import {captureGitIdentity} from './git-identity.ts';
import type {EvidenceOnlyReviewerTransport} from './evidence-only-reviewer.ts';
import type {IssueTask,PlanResult,BuildResult} from './orchestrator.ts';

export interface ReviewHandoff {
  kind:'quality-pending'|'fix-required';
  issueNumber:number;
  reviewedFingerprint:string;
  checkpointRevision:number;
  publishAuthorized:false;
  feedback?:string;
}
function sameGit(a:GitIdentity,b:GitIdentity):boolean{
  return a.head===b.head&&a.branch===b.branch&&a.worktreeHash===b.worktreeHash;
}
/** A single trusted code path from reviewed evidence to quality-pending.
 *
 * Validates the lock, checkpoint revision, reviewed fingerprint and actual
 * Git state via runGuardedEvidenceReview. A reviewed PASS only marks the
 * current checkpoint `reviewPassed` and changes stage to `quality`.
 * Quality is explicitly false, and publishing is NEVER enabled.
 *
 * For FAIL, preserve the existing review checkpoint and hand feedback to a
 * separately authorized Builder retry. No model text may become a command.
 */
export async function reviewAndCheckpointQuality(
  base:string,projectPath:string,lockToken:string,
  revision:number,issue:IssueTask,plan:PlanResult,build:BuildResult,
  transport:EvidenceOnlyReviewerTransport,signal?:AbortSignal,
  dependencies?:GuardedReviewDependencies,
):Promise<ReviewHandoff> {
  const result=await runGuardedEvidenceReview(base,projectPath,lockToken,
    revision,issue,plan,build,transport,signal,dependencies);
  if(result.verdict.verdict==='FAIL'){
    return {kind:'fix-required',issueNumber:issue.number,
      reviewedFingerprint:result.evidenceFingerprint,
      checkpointRevision:revision,publishAuthorized:false,
      feedback:result.verdict.feedback};
  }
  if(signal?.aborted)throw Error('Review handoff cancelled');
  // A new capture after inference and immediately before checkpointing
  // prevents approving the tree captured only before the model ran.
  // The exclusive project lock still remains mandatory.
  const capture=dependencies?.capture??captureGitIdentity;
  const currentGit=await capture(projectPath);
  if(!sameGit(currentGit,result.git))
    throw Error('Repository drift during quality handoff');
  if(signal?.aborted)throw Error('Review handoff cancelled');
  const owner=inspectProjectLock(base,projectPath);
  if(!owner||owner.token!==lockToken)throw Error('Review handoff requires owned lock');
  const cp=loadCoreCheckpoint(base,projectPath);
  if(!cp||cp.revision!==revision||cp.issueNumber!==issue.number||
    cp.stage!=='review'||cp.reviewPassed||cp.qualityPassed||
    !sameGit(cp.git,currentGit))
    throw Error('Review handoff checkpoint changed');
  const next=saveCoreCheckpoint(base,projectPath,lockToken,{
    runId:cp.runId,issueNumber:cp.issueNumber,stage:'quality',
    git:currentGit,sessions:cp.sessions,reviewPassed:true,qualityPassed:false,
  },revision);
  return {kind:'quality-pending',issueNumber:issue.number,
    reviewedFingerprint:result.evidenceFingerprint,
    checkpointRevision:next.revision,publishAuthorized:false};
}
