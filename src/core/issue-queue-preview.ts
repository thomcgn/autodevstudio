import {loadCoreCheckpoint} from './checkpoint-store.ts';
import {inspectProjectLock,projectLockDirectoryExists} from './project-lock.ts';
import {inspectGitPreflight,type GitPreflight} from './git-preflight.ts';
import type {StudioIssue} from './issues.ts';

export interface QueueItem {
  number:number;
  title:string;
  priority:0|1|2|3;
  state:'candidate'|'held';
  reason:string;
}
export interface IssueQueuePreview {
  previewOnly:true;
  executionEnabled:false;
  readyToStart:boolean;
  nextIssueNumber:number|null;
  reason:string;
  queue:QueueItem[];
}
const SKIP=new Set(['blocked','do-not-automate','manual-only','needs-discussion','needs-triage']);
function priority(labels:readonly string[]):0|1|2|3{
 const l=labels.map(x=>x.toLowerCase().trim());
 if(l.some(x=>['priority:p0','priority:critical','p0'].includes(x)))return 0;
 if(l.some(x=>['priority:p1','priority:high','p1'].includes(x)))return 1;
 if(l.some(x=>['priority:p2','priority:medium','p2'].includes(x)))return 2;
 return 3;
}
/** A read-only queue. Labels, not issue descriptions or model instructions,
 * determine ordering. Existing checkpoint (EVEN done) is intentionally a
 * stop sign until explicit post-PR reconciliation and cleanup exist.
 * This function NEVER clears a checkpoint, changes Git, or starts a model.
 */
export function planIssueQueue(
 base:string,projectPath:string,issues:readonly StudioIssue[],git:GitPreflight,
):IssueQueuePreview{
 if(!Array.isArray(issues)||issues.length>50)
  throw Error('Invalid issue queue input');
 const seen=new Set<number>();
 const entries:QueueItem[]=[];
 for(const issue of issues as readonly StudioIssue[]){
  if(!Number.isSafeInteger(issue.number)||issue.number<1||
    seen.has(issue.number)||typeof issue.title!=='string'||
    !Array.isArray(issue.labels))
    throw Error('Invalid or duplicate queue issue');
  seen.add(issue.number);
  const labels=issue.labels.map(x=>x.toLowerCase().trim());
  const held=labels.some(x=>SKIP.has(x));
  entries.push({number:issue.number,title:issue.title.slice(0,300),
    priority:priority(issue.labels),state:held?'held':'candidate',
    reason:held?'Issue requires manual triage':'Priority derived from explicit labels'});
 }
 entries.sort((a,b)=>a.priority-b.priority||a.number-b.number);
 const checkpoint=loadCoreCheckpoint(base,projectPath);
 const lock=projectLockDirectoryExists(base,projectPath)||Boolean(inspectProjectLock(base,projectPath));
 let reason='';
 if(lock)reason='Project currently locked by an active or interrupted run';
 else if(checkpoint)reason='Existing checkpoint #'+checkpoint.issueNumber+' ('+
   checkpoint.stage+') requires explicit recovery or completed-PR reconciliation';
 else if(!git.clean||!git.branch||!git.remoteSlug||
   git.branch.startsWith('autodev/'))
   reason='Git repository is not a clean eligible starting point';
 else if(!entries.some(e=>e.state==='candidate'))reason='No eligible open issues';
 const next=!reason?entries.find(e=>e.state==='candidate')?.number??null:null;
 return {previewOnly:true,executionEnabled:false,readyToStart:next!==null,
  nextIssueNumber:next,reason:reason||'One issue may be explicitly started',
  queue:entries};
}
export async function previewIssueQueue(
 base:string,projectPath:string,issues:readonly StudioIssue[],
):Promise<IssueQueuePreview>{
 const git=await inspectGitPreflight(projectPath);
 return planIssueQueue(base,projectPath,issues,git);
}
