import {loadCoreCheckpoint} from './checkpoint-store.ts';
import {acquireProjectLock} from './project-lock.ts';
import {captureGitIdentity} from './git-identity.ts';
import {implementIssueLocally,type IssueCodeResult} from './local-issue-to-code.ts';
import {repairGeneratedIssue} from './repair-generated-issue.ts';
import {MAX_LOCAL_REPAIR_ATTEMPTS} from './repair-budget.ts';
import {verifyGeneratedIssue,type IssueVerificationResult} from './verify-generated-issue.ts';
import {verifyQualityForReviewedIssue,type VerifiedQualityResult} from './reviewed-quality-gate.ts';
import {publishVerifiedDraftPullRequest,type DraftPullRequest} from './verified-draft-pr.ts';
import type {EvidenceOnlyReviewerTransport} from './evidence-only-reviewer.ts';
import type {IssueTask} from './orchestrator.ts';

export type IssueAutomationStage='build'|'review'|'quality'|'publish'|'done';
export interface IssueAutomationOutcome {
  status:'paused'|'draft-created';
  stage:IssueAutomationStage;
  issueNumber:number;
  checkpointRevision:number|null;
  reason:string;
  draftUrl?:string;
  autoMerge:false;
}
export type IssueAutomationStep=(stage:IssueAutomationStage)=>void;
export interface IssueAutomationDependencies {
  build:(base:string,project:string,issue:IssueTask,signal?:AbortSignal)=>Promise<IssueCodeResult>;
  review:(base:string,project:string,issue:IssueTask,transport:EvidenceOnlyReviewerTransport,
    scripts:readonly string[],signal?:AbortSignal)=>Promise<IssueVerificationResult>;
  quality:(base:string,project:string,revision:number,scripts:readonly string[],
    signal?:AbortSignal)=>Promise<VerifiedQualityResult>;
  draft:(base:string,project:string,issueNumber:number)=>Promise<DraftPullRequest>;
  repair?:(base:string,project:string,issue:IssueTask,feedback:string,signal?:AbortSignal)=>Promise<unknown>;
}
export const defaultIssueAutomationDependencies:IssueAutomationDependencies={
  build:(base,project,issue,signal)=>implementIssueLocally(base,project,issue,undefined,signal),
  review:(base,project,issue,transport,scripts,signal)=>
    verifyGeneratedIssue(base,project,issue,transport,scripts,signal),
  quality:async(base,project,revision,scripts,signal)=>{
    const lock=acquireProjectLock(base,project);
    try{return await verifyQualityForReviewedIssue(base,project,lock.record.token,revision,scripts,signal);}
    finally{lock.release();}
  },
  draft:(base,project,issueNumber)=>publishVerifiedDraftPullRequest(base,project,issueNumber),
  repair:(base,project,issue,feedback,signal)=>repairGeneratedIssue(base,project,issue,feedback,signal),
};
const checkpointFor=(base:string,project:string,issueNumber:number)=>{
  const cp=loadCoreCheckpoint(base,project);
  if(cp&&cp.issueNumber!==issueNumber)
    throw Error('Another issue owns the current Studio checkpoint');
  if(cp&&cp.git.branch!==`autodev/issue-${issueNumber}`)
    throw Error('Checkpoint belongs to an unexpected branch');
  return cp;
};
const pause=(stage:IssueAutomationStage,issueNumber:number,
  checkpointRevision:number|null,reason:string):IssueAutomationOutcome=>({
  status:'paused',stage,issueNumber,checkpointRevision,reason,autoMerge:false,
});

/** One user action can drive the previously verified building blocks.
 *
 * Resume policy is based ONLY on Studio's persisted checkpoint, not UI state.
 * Empty -> build; review -> review; quality&&!qualityPassed -> tests;
 * quality&&qualityPassed -> draft. publish/done/blocked never repeat network
 * actions. A reviewer FAIL or Quality FAIL pauses without auto-fixing.
 *
 * Caller must provide an independent reviewer transport from trusted Main.
 * This coordinator never bypasses unknown cloud quota and does not enable
 * self-review. Git commit/push/PR is delegated only to the proof-verified
 * publisher. It intentionally never merges the Draft PR.
 */
export async function runIssueToDraftPr(
  base:string,project:string,issue:IssueTask,
  reviewer:EvidenceOnlyReviewerTransport,
  approvedScripts:readonly string[],
  signal?:AbortSignal,onStep?:IssueAutomationStep,
  deps:IssueAutomationDependencies=defaultIssueAutomationDependencies,
  canReview?:()=>Promise<{ready:boolean;reason:string}>,
  repairDepth=0,
):Promise<IssueAutomationOutcome>{
  if(!Number.isSafeInteger(issue?.number)||issue.number<1||
    typeof issue.title!=='string'||typeof issue.body!=='string')
    throw Error('Invalid issue');
  if(!Array.isArray(approvedScripts)||approvedScripts.length<2)
    throw Error('Quality requires approved typecheck and tests');
  if(signal?.aborted)throw Error('Automation cancelled');
  const report=(stage:IssueAutomationStage)=>{onStep?.(stage);};
  let cp=checkpointFor(base,project,issue.number);
  if(!cp){
    report('build');
    await deps.build(base,project,issue,signal);
    cp=checkpointFor(base,project,issue.number);
    if(!cp||cp.stage!=='review'||cp.reviewPassed||cp.qualityPassed)
      throw Error('Builder did not create a valid review checkpoint');
  }
  if(signal?.aborted)throw Error('Automation cancelled');
  if(cp.stage==='review'){
    report('review');
    if(canReview){
      const gate=await canReview();
      if(!gate.ready)return pause('review',issue.number,cp.revision,gate.reason);
    }
    const result=await deps.review(base,project,issue,reviewer,approvedScripts,signal);
    if(result.kind==='review-failed'||result.kind==='quality-failed'){
      const stage=result.kind==='review-failed'?'review':'quality';
      const feedback=result.feedback??'Review or quality rejected';
      if(deps.repair&&repairDepth<MAX_LOCAL_REPAIR_ATTEMPTS&&!signal?.aborted){
        report('build');
        await deps.repair(base,project,issue,feedback,signal);
        return runIssueToDraftPr(base,project,issue,reviewer,approvedScripts,
          signal,onStep,deps,canReview,repairDepth+1);
      }
      return pause(stage,issue.number,result.checkpointRevision,
        feedback+'; automatic repair exhausted or unavailable');
    }
    cp=checkpointFor(base,project,issue.number);
    if(!cp||cp.stage!=='quality'||!cp.reviewPassed||!cp.qualityPassed)
      throw Error('Reviewer/Quality result did not persist both PASS gates');
  }else if(cp.stage==='quality'&&cp.reviewPassed&&!cp.qualityPassed){
    report('quality');
    const result=await deps.quality(base,project,cp.revision,approvedScripts,signal);
    if(result.kind==='quality-failed'){
      const feedback=result.feedback??'Quality tests failed';
      if(deps.repair&&repairDepth<MAX_LOCAL_REPAIR_ATTEMPTS&&!signal?.aborted){
        report('build');
        await deps.repair(base,project,issue,feedback,signal);
        return runIssueToDraftPr(base,project,issue,reviewer,approvedScripts,
          signal,onStep,deps,canReview,repairDepth+1);
      }
      return pause('quality',issue.number,result.checkpointRevision,
        feedback+'; automatic repair exhausted or unavailable');
    }
    cp=checkpointFor(base,project,issue.number);
    if(!cp||cp.stage!=='quality'||!cp.reviewPassed||!cp.qualityPassed)
      throw Error('Quality result did not persist a valid PASS');
  }
  if(signal?.aborted)throw Error('Automation cancelled before publishing');
  if(cp.stage==='publish'||cp.stage==='done'||cp.stage==='blocked')
    return pause('publish',issue.number,cp.revision,
      'Publishing already started or completed; manual reconciliation required');
  if(cp.stage!=='quality'||!cp.reviewPassed||!cp.qualityPassed)
    return pause('quality',issue.number,cp.revision,
      'Checkpoint not eligible for publication');
  report('publish');
  // This action may commit and push; no safe automatic retry after it starts.
  const draft=await deps.draft(base,project,issue.number);
  if(!draft.draft||draft.autoMerge!==false)
    throw Error('Publisher did not return a verified draft PR');
  return {
    status:'draft-created',stage:'done',issueNumber:issue.number,
    checkpointRevision:draft.checkpointRevision,
    reason:'Draft PR created; human review and merge required',
    draftUrl:draft.url,autoMerge:false,
  };
}
