import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {acquireProjectLock,inspectProjectLock} from './project-lock.ts';
import {loadCoreCheckpoint,saveCoreCheckpoint} from './checkpoint-store.ts';
import {captureGitIdentity} from './git-identity.ts';
import {requireReviewedEvidenceProof} from './review-approval-proof.ts';
import {parseGitHubRemote} from './git-preflight.ts';

const exec=promisify(execFile);
const SOURCE=/^(?:src|tests)\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.(?:ts|tsx|js|jsx)$/;
const BRANCH=/^autodev\/issue-([1-9][0-9]*)$/;
type Command='git'|'gh';
export type PublishCommandRunner=(binary:Command,args:string[],cwd:string)=>Promise<string>;
const defaultRunner:PublishCommandRunner=async(binary,args,cwd)=>{
  const result=await exec(binary,args,{cwd,encoding:'utf8',timeout:60000,maxBuffer:128*1024,
    windowsHide:true,shell:false,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
  return result.stdout;
};
export interface DraftPullRequest {
  issueNumber:number;
  branch:string;
  url:string;
  checkpointRevision:number;
  draft:true;
  autoMerge:false;
}
/** This is the ONLY writing publication path for the first local Builder.
 * It does not accept raw model commands, a file list, a PR body or permission
 * flags from the renderer. Strictly one already tracked and reviewed file.
 * Every model output is untrusted until reviewed evidence and Quality PASS.
 * Any post-commit exception leaves the stage publish for explicit recovery.
 */
export async function publishVerifiedDraftPullRequest(
  base:string,projectPath:string,issueNumber:number,
  runner:PublishCommandRunner=defaultRunner,
):Promise<DraftPullRequest>{
  if(!Number.isSafeInteger(issueNumber)||issueNumber<1)
    throw Error('Invalid issue number');
  const root=fs.realpathSync(projectPath);
  const lock=acquireProjectLock(base,root);
  try {
    const assertOwner=()=>{
      if(inspectProjectLock(base,root)?.token!==lock.record.token)
        throw Error('Publication project lock lost');
    };
    assertOwner();
    const cp=loadCoreCheckpoint(base,root);
    if(!cp||cp.issueNumber!==issueNumber||cp.stage!=='quality'||
       !cp.reviewPassed||!cp.qualityPassed||
       cp.git.branch!==`autodev/issue-${issueNumber}`||
       !BRANCH.test(cp.git.branch)||cp.revision<3)
      throw Error('No fully reviewed, quality-approved issue checkpoint');
    const before=await captureGitIdentity(root);
    if(before.head!==cp.git.head||before.branch!==cp.git.branch||
       before.worktreeHash!==cp.git.worktreeHash)
      throw Error('Publication Git identity drift');
    // The proof points at the immediately previous quality-pending revision.
    // A bare bool reviewPassed/qualityPassed must NEVER authorize publication.
    const evidence=requireReviewedEvidenceProof(base,root,{
      ...cp,revision:cp.revision-1,qualityPassed:false,
    },before);
    if(!/^[a-f0-9]{64}$/.test(evidence.evidenceFingerprint))
      throw Error('Invalid review fingerprint');
    const remote=await runner('git',['remote','get-url','origin'],root);
    const slug=parseGitHubRemote(remote);
    if(!slug)throw Error('Publication requires a verified GitHub origin');
    const status=await runner('git',['status','--porcelain=v1','--untracked-files=all','-z'],root);
    const match=/^ M ((?:src|tests)\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.(?:ts|tsx|js|jsx))\0$/.exec(status);
    if(!match||!SOURCE.test(match[1])||match[1].includes('..')||
       match[1].split('/').some(part=>part.startsWith('.')))
      throw Error('Publication requires exactly one unstaged safe source edit');
    const file=match[1];
    const source=path.join(root,...file.split('/'));
    const st=fs.lstatSync(source);
    if(!st.isFile()||st.isSymbolicLink())throw Error('Unsafe file for publication');
    const checked=await runner('git',['diff','--check','--',file],root);
    if(checked.trim())throw Error('Publication diff whitespace check failed');
    const diff=await runner('git',['diff','--name-only','-z','--'],root);
    if(diff!==file+'\0')throw Error('Unexpected changed file during publication');

    const current=await captureGitIdentity(root);
    if(current.head!==before.head||current.branch!==before.branch||
       current.worktreeHash!==before.worktreeHash)
      throw Error('Git changed during publication preflight');
    assertOwner();
    await runner('git',['add','--',file],root);
    const staged=await runner('git',['diff','--cached','--name-only','-z','--'],root);
    if(staged!==file+'\0')throw Error('Unexpected staged files; manual recovery required');
    if((await runner('git',['diff','--cached','--check','--'],root)).trim())
      throw Error('Staged change rejected');
    assertOwner();
    await runner('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false',
      'commit','-m',`autodev: implement issue #${issueNumber}`],root);
    const committed=await captureGitIdentity(root);
    if(committed.branch!==before.branch||
       committed.head===before.head)
      throw Error('Unexpected branch or HEAD after commit');
    if((await runner('git',['status','--porcelain=v1','--untracked-files=all','-z'],root))!=='')
      throw Error('Unexpected changes after commit; manual recovery required');
    assertOwner();
    // Persist the irreversible commit BEFORE network operations. Any failure
    // can then be inspected without accidentally committing twice.
    const postCommit=saveCoreCheckpoint(base,root,lock.record.token,{
      runId:cp.runId,issueNumber:cp.issueNumber,stage:'publish',git:committed,
      sessions:cp.sessions,reviewPassed:true,qualityPassed:true,
    },cp.revision);
    if((await captureGitIdentity(root)).head!==postCommit.git.head)
      throw Error('Git drift before push');
    assertOwner();
    await runner('git',['push','--set-upstream','origin',cp.git.branch],root);
    if((await captureGitIdentity(root)).head!==postCommit.git.head)
      throw Error('Git drift after push; PR not created');
    assertOwner();
    const response=await runner('gh',['pr','create','--draft','--base','main',
      '--head',cp.git.branch,
      '--title',`Draft: AutoDev issue #${issueNumber}`,
      '--body',`Related to #${issueNumber}.

Generated code reviewed at fingerprint ${evidence.evidenceFingerprint}.
Local Builder: qwen2.5-coder:3b.
Independent Reviewer PASS and isolated Quality PASS verified by AutoDev Studio.
Manual PR review and merge still required.`],root);
    const url=response.trim();
    const expected=new RegExp('^https://github\\.com/'+slug.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/pull/[1-9][0-9]*$');
    if(!expected.test(url))
      throw Error('GitHub PR creation returned unexpected URL; manual recovery required');
    const final=saveCoreCheckpoint(base,root,lock.record.token,{
      runId:cp.runId,issueNumber:cp.issueNumber,stage:'done',git:committed,
      sessions:cp.sessions,reviewPassed:true,qualityPassed:true,
    },postCommit.revision);
    return {issueNumber,branch:cp.git.branch,url,
      checkpointRevision:final.revision,draft:true,autoMerge:false};
  } finally {lock.release();}
}
