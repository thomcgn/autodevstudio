import {acquireProjectLock} from './project-lock.ts';
import {loadCoreCheckpoint} from './checkpoint-store.ts';
import {captureGitIdentity} from './git-identity.ts';
import {reviewAndCheckpointQuality,type ReviewHandoff} from './review-quality-handoff.ts';
import {verifyQualityForReviewedIssue,type VerifiedQualityResult} from './reviewed-quality-gate.ts';
import type {EvidenceOnlyReviewerTransport} from './evidence-only-reviewer.ts';
import type {IssueTask,PlanResult,BuildResult} from './orchestrator.ts';
import type {GuardedReviewDependencies} from './guarded-evidence-review.ts';
import type {QualityGateDependencies} from './reviewed-quality-gate.ts';

export type IssueVerificationResult={
  kind:'review-failed'|'quality-failed'|'quality-passed';
  issueNumber:number;
  checkpointRevision:number;
  feedback?:string;
  publishAuthorized:false;
};
export interface IssueVerificationDependencies {
  reviewer?:GuardedReviewDependencies;
  quality?:QualityGateDependencies;
}
const gitEqual=(a:{head:string;branch:string;worktreeHash:string},
                b:{head:string;branch:string;worktreeHash:string}):boolean=>
  a.head===b.head&&a.branch===b.branch&&a.worktreeHash===b.worktreeHash;

/** Resume a generated issue at its exact original revision, WITHOUT resuming
 * any CLI model session or trusting a caller-provided PASS. Reacquires the
 * exclusive project lock and verifies the exact Git tree before calling
 * the independent tool-free reviewer. On PASS, immediately runs approved
 * isolated quality gates. FAILs leave the checkpoint for explicit inspection.
 *
 * No builder, shell, branch switch, commit, push, or PR publication here.
 */
export async function verifyGeneratedIssue(
  base:string,projectPath:string,issue:IssueTask,
  transport:EvidenceOnlyReviewerTransport,
  approvedScripts:readonly string[],
  signal?:AbortSignal,
  deps:IssueVerificationDependencies={},
):Promise<IssueVerificationResult>{
  if(!Number.isSafeInteger(issue?.number)||issue.number<1||
    typeof issue.title!=='string'||typeof issue.body!=='string')
    throw Error('Invalid issue for verification');
  if(signal?.aborted)throw Error('Verification cancelled');
  const lock=acquireProjectLock(base,projectPath);
  try{
    const cp=loadCoreCheckpoint(base,projectPath);
    if(!cp||cp.issueNumber!==issue.number||
      cp.stage!=='review'||cp.reviewPassed||cp.qualityPassed||
      cp.git.branch!==`autodev/issue-${issue.number}`)
      throw Error('No eligible generated issue review checkpoint');
    const git=await (deps.reviewer?.capture??captureGitIdentity)(projectPath);
    if(!gitEqual(cp.git,git))throw Error('Generated issue Git tree changed before verification');
    const plan:PlanResult={
      summary:'Bounded one-file implementation prepared by configured primary Builder; full plan remains tracked by Builder session.',
      steps:['Inspect actual single-file code diff against issue acceptance criteria',
        'Reject missing tests, unsafe changes and incomplete requirements'],
    };
    const build:BuildResult={summary:
      'Local Qwen2.5-Coder 3B produced one uncommitted change on this issue branch. '+
      'No unit tests or functional correctness have been established.'};
    const handoff:ReviewHandoff=await reviewAndCheckpointQuality(
      base,projectPath,lock.record.token,cp.revision,issue,plan,build,
      transport,signal,deps.reviewer);
    if(handoff.kind==='fix-required')return {
      kind:'review-failed',issueNumber:issue.number,
      checkpointRevision:handoff.checkpointRevision,feedback:handoff.feedback,
      publishAuthorized:false,
    };
    const quality:VerifiedQualityResult=await verifyQualityForReviewedIssue(
      base,projectPath,lock.record.token,handoff.checkpointRevision,
      approvedScripts,signal,deps.quality);
    return {
      kind:quality.kind,issueNumber:issue.number,
      checkpointRevision:quality.checkpointRevision,
      feedback:quality.feedback,publishAuthorized:false,
    };
  }finally{
    lock.release();
  }
}
