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
  triage:{source:'github-labels';evidence:readonly string[];dependencyIssues:readonly number[];
    proposalOnly:true;confidence:'high'|'limited'};
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
const STATUS=new Set([
 'status:backlog','status:triage','status:ready','status:planning','status:in-progress',
 'status:review','status:approved','status:blocked','status:done',
]);
/** A new issue may start only with exactly one valid status and approved triage.
 * Existing interrupted workflows are resumed through checkpoint validation, not
 * by treating a label change as proof that a prior agent action completed.
 */
export function issueStartReadiness(labels:readonly string[]):{ready:boolean;reason:string}{
 const normalized=labels.map(value=>value.trim().toLowerCase());
 const statuses=normalized.filter(value=>value.startsWith('status:'));
 if(statuses.length!==1||!STATUS.has(statuses[0]))
   return {ready:false,reason:'Exactly one recognized workflow status is required'};
 if(statuses[0]!=='status:ready')
   return {ready:false,reason:'Issue status is '+statuses[0]+'; manual triage or recovery required'};
 if(normalized.some(value=>SKIP.has(value)))
   return {ready:false,reason:'Issue is blocked for manual triage'};
 const priorities=normalized.filter(value=>/^priority:p[0-3]$/.test(value));
 if(priorities.length!==1)
   return {ready:false,reason:'Exactly one P0–P3 priority is required'};
 return {ready:true,reason:'Ready with explicit workflow status and priority'};
}
/** Only explicit project-local GitHub issue dependencies count as blockers.
 * No GitHub close event is inferred from missing entries in the open-issue list.
 */
export function inspectIssueDependencies(labels:readonly string[],issueNumber:number):{
  dependencies:readonly number[];error:string|null
}{
 const dependencyLabels=labels.map(x=>x.trim().toLowerCase())
  .filter(x=>x.startsWith('depends-on:'));
 const dependencies:number[]=[];
 for(const label of dependencyLabels){
  const match=/^depends-on:#([1-9][0-9]*)$/.exec(label);
  if(!match)return {dependencies:[],error:'Invalid depends-on label; expected depends-on:#N'};
  const number=Number(match[1]);
  if(!Number.isSafeInteger(number)||number===issueNumber)
   return {dependencies:[],error:'Invalid or self-referencing issue dependency'};
  if(dependencies.includes(number))
   return {dependencies:[],error:'Duplicate issue dependency'};
  dependencies.push(number);
 }
 return {dependencies:dependencies.sort((a,b)=>a-b),error:null};
}
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
  const readiness=issueStartReadiness(labels);
  const dependencies=inspectIssueDependencies(labels,issue.number);
  const missing=dependencies.dependencies.find(number=>!issues.some(candidate=>
    candidate.number===number));
  const unresolved=dependencies.dependencies.find(number=>issues.some(candidate=>
    candidate.number===number));
  const dependencyReason=dependencies.error??(unresolved!==undefined
    ?'Depends on open issue #'+unresolved+'; resolve that issue first'
    :missing!==undefined
      ?'Dependency #'+missing+' not in open issues: completion unverified; manual reconciliation required'
      :null);
  const isReady=readiness.ready&&!dependencyReason;
  const priorityValue=priority(issue.labels);
  const evidence=[
    'Explicit GitHub priority: P'+priorityValue,
    'Workflow: '+(labels.find(label=>label.startsWith('status:'))??'unknown'),
    ...(dependencies.dependencies.length?['Dependencies: '+
      dependencies.dependencies.map(n=>'#'+n).join(', ')]:[]),
    'Tie-breaker: issue number (only within equal priorities)',
  ];
  entries.push({number:issue.number,title:issue.title.slice(0,300),
    priority:priorityValue,state:isReady?'candidate':'held',
    reason:dependencyReason??readiness.reason,
    triage:{source:'github-labels',evidence,dependencyIssues:dependencies.dependencies,
      proposalOnly:true,confidence:dependencyReason?'limited':'high'}});
 }
 entries.sort((a,b)=>(a.state==='held'?1:0)-(b.state==='held'?1:0)||
   a.priority-b.priority||a.number-b.number);
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
