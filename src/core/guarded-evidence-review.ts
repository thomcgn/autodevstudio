import {inspectProjectLock} from './project-lock.ts';
import {loadCoreCheckpoint,assertCoreResumeEligible,type GitIdentity} from './checkpoint-store.ts';
import {collectReviewEvidence,type ReviewEvidence} from './review-evidence.ts';
import {captureGitIdentity} from './git-identity.ts';
import {createEvidenceOnlyReviewer,type EvidenceOnlyReviewerTransport} from './evidence-only-reviewer.ts';
import type {IssueTask,PlanResult,BuildResult,ReviewResult} from './orchestrator.ts';

export interface GuardedReviewResult {
  readonly verdict:ReviewResult;
  readonly issueNumber:number;
  readonly checkpointRevision:number;
  readonly evidenceFingerprint:string;
  readonly git:GitIdentity;
  /** This is NOT publish authorization. All publish and quality gates remain closed. */
  readonly publishAuthorized:false;
}
export interface GuardedReviewDependencies {
  capture:(projectPath:string)=>Promise<GitIdentity>;
  evidence:(projectPath:string,signal?:AbortSignal)=>Promise<ReviewEvidence>;
}
const actualDependencies:GuardedReviewDependencies={
  capture:captureGitIdentity,evidence:collectReviewEvidence,
};
function sameGit(a:GitIdentity,b:GitIdentity):boolean{
  return a.head===b.head&&a.branch===b.branch&&a.worktreeHash===b.worktreeHash;
}
/** Trusted controller boundary for an evidence-only reviewer (including
 * the attested Kilo→Ollama model transport).
 *
 * Fails closed if the owner lock, checkpoint, revision, issue, repository
 * contents, or reviewer evidence changes. A stale model PASS is discarded
 * if Git changes during inference. It NEVER sets reviewPassed or publishes:
 * a later, separately authorized stage must match the fingerprint and
 * revision and independently pass the quality gates.
 */
export async function runGuardedEvidenceReview(
  base:string,projectPath:string,lockToken:string,
  expectedRevision:number,
  issue:IssueTask,plan:PlanResult,build:BuildResult,
  transport:EvidenceOnlyReviewerTransport,
  signal?:AbortSignal,
  dependencies:GuardedReviewDependencies=actualDependencies,
):Promise<GuardedReviewResult> {
  if(signal?.aborted)throw Error('Review cancelled');
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1||
    !Number.isSafeInteger(issue?.number)||issue.number<1)
    throw Error('Invalid review identity');
  const owner=inspectProjectLock(base,projectPath);
  if(!owner||owner.token!==lockToken)throw Error('Review requires exclusive project lock');
  const checkpoint=loadCoreCheckpoint(base,projectPath);
  if(!checkpoint||checkpoint.revision!==expectedRevision||
    checkpoint.issueNumber!==issue.number||checkpoint.stage!=='review'||
    checkpoint.reviewPassed||checkpoint.qualityPassed)
    throw Error('Reviewer checkpoint invalid, stale or previously approved');
  const before=await dependencies.capture(projectPath);
  if(!sameGit(checkpoint.git,before))
    throw Error('Repository drift before review');
  const evidence=await dependencies.evidence(projectPath,signal);
  if(!sameGit(evidence.identity,before))
    throw Error('Reviewer evidence does not match checkpoint');
  if(signal?.aborted)throw Error('Review cancelled');
  const review=createEvidenceOnlyReviewer(transport,signal);
  const verdict=await review(issue,plan,build,evidence);
  if(signal?.aborted)throw Error('Review cancelled');
  // Re-read both the actual tree and the persisted checkpoint. Never trust
  // the model result without proving the reviewed inputs are still current.
  const after=await dependencies.capture(projectPath);
  if(!sameGit(after,before))
    throw Error('Repository changed during reviewer inference; discard verdict');
  const lockAfter=inspectProjectLock(base,projectPath);
  if(!lockAfter||lockAfter.token!==lockToken)
    throw Error('Project lock changed during review');
  const checkpointAfter=loadCoreCheckpoint(base,projectPath);
  if(!checkpointAfter||checkpointAfter.revision!==expectedRevision||
    checkpointAfter.runId!==checkpoint.runId||
    checkpointAfter.issueNumber!==issue.number||
    checkpointAfter.stage!=='review'||
    !sameGit(checkpointAfter.git,before)||
    checkpointAfter.reviewPassed||checkpointAfter.qualityPassed)
    throw Error('Checkpoint changed during review; discard verdict');
  return Object.freeze({
    verdict,issueNumber:issue.number,checkpointRevision:expectedRevision,
    evidenceFingerprint:evidence.fingerprint,git:before,publishAuthorized:false as const,
  });
}
