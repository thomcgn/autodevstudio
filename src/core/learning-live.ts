import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadCoreCheckpoint} from './checkpoint-store.ts';
import {captureGitIdentity} from './git-identity.ts';
import {parseGitHubRemote} from './git-preflight.ts';
import type {PublicHistoryIndex,GitHubHistoryRead} from './public-history.ts';
import {generateHistoricalBook,mergeHistoricalBook} from './historical-lessons.ts';
import {saveHistoricalBook,loadHistoricalBook} from './learning-store.ts';

const exec=promisify(execFile);
const SHA=/^[0-9a-f]{40}$/i;
const SAFE_PATH=/^(?:src|tests)\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|java)$/;
export type LearningGitRead=(args:readonly string[],cwd:string)=>Promise<string>;
const git:LearningGitRead=async(args,cwd)=>
 (await exec('git',[...args],{cwd,encoding:'utf8',timeout:15000,
  shell:false,maxBuffer:150000,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}})).stdout;

export interface CompletedIssueLearning {
  recorded:boolean;topicCount:number;commitSha:string;
  reason:'saved'|'no-verified-evidence'|'unsupported-repository'|'write-failed';
}
export interface VerifiedIssueEvidence {
  repository:string;issueNumber:number;commitSha:string;draftUrl:string;
  reviewPassed:true;qualityPassed:true;
}
function isEvidence(e:VerifiedIssueEvidence):boolean {
 return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(e.repository)&&SHA.test(e.commitSha)&&
  Number.isSafeInteger(e.issueNumber)&&e.issueNumber>0&&e.reviewPassed===true&&
  e.qualityPassed===true&&e.draftUrl.startsWith('https://github.com/'+e.repository+'/pull/');
}
/** Pure orchestration from already verified local commit. No project writes.
 * This step must run only after the official publisher has returned a confirmed Draft PR.
 */
export async function createVerifiedIssueLearning(
 base:string,project:string,evidence:VerifiedIssueEvidence,
 readGit:LearningGitRead=git,
):Promise<CompletedIssueLearning>{
 if(!isEvidence(evidence))return {recorded:false,topicCount:0,
  commitSha:evidence.commitSha,reason:'no-verified-evidence'};
 const names=(await readGit(['show','--format=','--name-only','--no-renames',
  evidence.commitSha],project)).split('\n').map(s=>s.trim()).filter(Boolean);
 const files=[...new Set(names)].filter(p=>SAFE_PATH.test(p)&&!p.includes('..')).slice(0,25);
 if(files.length===0)return {recorded:false,topicCount:0,
  commitSha:evidence.commitSha,reason:'unsupported-repository'};
 const parsedFiles:{filename:string;patch:string}[]=[];
 for(const file of files){
  const patch=await readGit(['show','--format=','--no-ext-diff','--no-renames',
    '--unified=0',evidence.commitSha,'--',file],project);
  if(patch.length<=12000)parsedFiles.push({filename:file,patch});
 }
 if(parsedFiles.length===0)return {recorded:false,topicCount:0,
  commitSha:evidence.commitSha,reason:'unsupported-repository'};
 const index:PublicHistoryIndex={repository:evidence.repository,
  defaultBranch:'local-verified-issue',fixedHead:evidence.commitSha,licenseSpdx:null,
  readOnly:true,requiresInterpretation:true,page:1,hasMore:false,
  commits:[{sha:evidence.commitSha,title:'Geprüfter Issue-Commit #'+evidence.issueNumber,
    committedAt:null,changedPaths:files,pathsComplete:true,
    evidenceUrl:'https://github.com/'+evidence.repository+'/commit/'+evidence.commitSha}]};
 const reader:GitHubHistoryRead=async endpoint=>{
  if(endpoint!=='repos/'+evidence.repository+'/commits/'+evidence.commitSha)
    throw Error('Unexpected source endpoint');
  return {files:parsedFiles};
 };
 const candidate=await generateHistoricalBook(index,reader);
 const previous=loadHistoricalBook(base,evidence.repository);
 if(previous&&previous.lessons>0&&previous.lessonEntries.length===0)
  throw Error('Previous learning snapshot lacks typed topic records');
 const book=mergeHistoricalBook(previous?{
  repository:previous.repository,head:previous.head,license:previous.license,
  lessons:previous.lessonEntries,bookMarkdown:previous.bookMarkdown,
  solutionsMarkdown:previous.solutionsMarkdown,reportsMarkdown:previous.reportsMarkdown,
 }:null,candidate);
 const marker='\n## Abgeschlossener AutoDev-Lauf\n';
 const oldReports=previous?.reportsMarkdown??'';
 const firstAudit=oldReports.indexOf(marker);
 if(firstAudit>=0)book.reportsMarkdown+=oldReports.slice(firstAudit);
 if(!book.reportsMarkdown.includes('- Draft-PR: '+evidence.draftUrl))
 book.reportsMarkdown+='\n## Abgeschlossener AutoDev-Lauf\n'+
  '- Issue: https://github.com/'+evidence.repository+'/issues/'+evidence.issueNumber+'\n'+
  '- Draft-PR: '+evidence.draftUrl+'\n'+
  '- Verifizierter Commit: '+evidence.commitSha+'\n'+
  '- Reviewer-Checkpoint: PASS\n- Quality-Checkpoint: PASS\n'+
  '- Die ursprüngliche Motivation lässt sich ohne Review- oder Issue-Dokumentation nicht sicher ableiten.\n';
 saveHistoricalBook(base,book,'issue-'+evidence.issueNumber);
 return {recorded:true,topicCount:book.lessons.length,
  commitSha:evidence.commitSha,reason:'saved'};
}
/** After completed Draft PR, the irreversible publication has already happened.
 * Never make documentation failure look like a failed PR needing a second push.
 */
export async function documentFinishedIssue(
 base:string,project:string,issueNumber:number,draftUrl:string,
 readGit:LearningGitRead=git,
):Promise<CompletedIssueLearning>{
 const cp=loadCoreCheckpoint(base,project);
 const fallback={recorded:false,topicCount:0,commitSha:cp?.git.head??'',
  reason:'no-verified-evidence' as const};
 if(!cp||cp.stage!=='done'||cp.issueNumber!==issueNumber||
    !cp.reviewPassed||!cp.qualityPassed||!SHA.test(cp.git.head))return fallback;
 const actual=await captureGitIdentity(project);
 if(actual.head!==cp.git.head||actual.branch!==cp.git.branch||
    actual.worktreeHash!==cp.git.worktreeHash)return fallback;
 const remote=parseGitHubRemote(await readGit(['remote','get-url','origin'],project));
 if(!remote)return {...fallback,reason:'unsupported-repository'};
 return createVerifiedIssueLearning(base,project,{
  repository:remote,issueNumber,commitSha:cp.git.head,draftUrl,
  reviewPassed:true,qualityPassed:true,
 },readGit);
}
