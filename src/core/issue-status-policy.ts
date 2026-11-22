import type {CoreCheckpoint,GitIdentity} from './checkpoint-store.ts';
import {keyForProject} from './project-lock.ts';
export type IssueWorkflowStatus=
 'status:backlog'|'status:triage'|'status:ready'|'status:planning'|
 'status:in-progress'|'status:review'|'status:approved'|'status:blocked'|'status:done';
export interface StatusReconciliation {
 proposed:IssueWorkflowStatus|null;current:IssueWorkflowStatus|null;
 allowed:false;reason:string;provenance:'checkpoint'|'none';
}
const STATUS=new Set<IssueWorkflowStatus>([
 'status:backlog','status:triage','status:ready','status:planning',
 'status:in-progress','status:review','status:approved','status:blocked','status:done',
]);
function currentStatus(labels:readonly string[]):IssueWorkflowStatus|null {
 const statuses=labels.filter(l=>l.toLowerCase().startsWith('status:'))
  .map(s=>s.toLowerCase());
 if(statuses.length!==1||!STATUS.has(statuses[0] as IssueWorkflowStatus))return null;
 return statuses[0] as IssueWorkflowStatus;
}
/** Read-only checkpoint reconciliation. Never marks an issue completed
 * merely because a local checkpoint says done: done means Draft PR in this
 * controller. GitHub status:done requires independently verified merge and
 * issue closure. Quality flags alone do not prove independent review.
 */
export function previewCheckpointIssueStatus(
 projectPath:string,issueNumber:number,labels:readonly string[],
 checkpoint:CoreCheckpoint|null,currentGit:GitIdentity|null,
 verifiedReviewProof=false,
):StatusReconciliation {
 const current=currentStatus(labels);
 const held=(reason:string):StatusReconciliation=>({proposed:null,current,
   allowed:false,reason,provenance:'none'});
 if(!current)return held('Exactly one recognized GitHub status is required');
 if(!checkpoint)return held('No checkpoint available: GitHub status remains authoritative');
 if(!Number.isSafeInteger(issueNumber)||issueNumber<1||checkpoint.issueNumber!==issueNumber)
  return held('Checkpoint belongs to a different issue');
 if(checkpoint.projectKey!==keyForProject(projectPath))
  return held('Checkpoint belongs to a different project');
 if(!currentGit||checkpoint.git.head!==currentGit.head||
    checkpoint.git.branch!==currentGit.branch||
    checkpoint.git.worktreeHash!==currentGit.worktreeHash)
  return held('Git identity drift: no status transition permitted');
 let next:IssueWorkflowStatus|null=null;
 switch(checkpoint.stage){
  case 'plan':next='status:planning';break;
  case 'build':next='status:in-progress';break;
  case 'review':next='status:review';break;
  case 'quality':
    next=checkpoint.reviewPassed&&checkpoint.qualityPassed&&verifiedReviewProof
      ?'status:approved':checkpoint.reviewPassed?'status:review':null;
    break;
  case 'blocked':next='status:blocked';break;
  case 'publish':
  case 'done':
    next=checkpoint.reviewPassed&&checkpoint.qualityPassed&&verifiedReviewProof
      ?'status:approved':null;
    break;
  default:next=null;
 }
 if(!next)return held('No trustworthy stage evidence; manual reconciliation required');
 if(current==='status:done')return held('GitHub done must not be downgraded from local state');
 if(current==='status:blocked'&&next!=='status:blocked')
  return held('Blocked status requires an explicit recovery decision');
 return {proposed:next,current,allowed:false,reason:next===current
  ?'GitHub status already matches verified checkpoint'
  :'Checkpoint suggests '+next+'; preview only, no remote mutation',
  provenance:'checkpoint'};
}
