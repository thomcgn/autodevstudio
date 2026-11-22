import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {auditCodeSource,type CodeQualityFinding} from './clean-code-audit.ts';

const exec=promisify(execFile);
const SAFE=/^(?:src|tests)\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.(?:ts|tsx|js|jsx)$/;
export interface ReviewedSourceAudit {
  passed:boolean;
  changedFile:string;
  findings:CodeQualityFinding[];
}
export type AuditGitRunner=(args:string[],root:string)=>Promise<string>;
const git:AuditGitRunner=async(args,root)=>{
  const r=await exec('git',args,{cwd:root,encoding:'utf8',
    timeout:15000,maxBuffer:256*1024,windowsHide:true,shell:false,
    env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
  return r.stdout;
};
const countByRule=(findings:readonly CodeQualityFinding[]):Map<string,number>=>{
  const counts=new Map<string,number>();
  for(const finding of findings)
    counts.set(finding.rule,(counts.get(finding.rule)??0)+1);
  return counts;
};
/** Audits EXACTLY the single changed, tracked TS/JS source file that the
 * first local Builder is permitted to modify. Baseline comparison prevents
 * blocking legacy code for PRE-EXISTING long functions, duplication etc.
 * No shell, no execution, no model, no cloud and no project file mutation.
 */
export async function auditReviewedSource(
  projectPath:string,runner:AuditGitRunner=git,
):Promise<ReviewedSourceAudit>{
  const root=fs.realpathSync(projectPath);
  const status=await runner(['status','--porcelain=v1','--untracked-files=all','-z'],root);
  const match=/^ M ((?:src|tests)\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.(?:ts|tsx|js|jsx))\0$/.exec(status);
  if(!match||!SAFE.test(match[1])||match[1].includes('..'))
    throw Error('Code audit requires exactly one reviewed source change');
  const file=match[1];
  const sourcePath=path.join(root,...file.split('/'));
  const stat=fs.lstatSync(sourcePath);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024)
    throw Error('Code audit source is unsafe or too large');
  const after=fs.readFileSync(sourcePath,'utf8');
  const before=await runner(['show','HEAD:'+file],root);
  const current=auditCodeSource(file,after);
  const baseline=auditCodeSource(file,before);
  const existing=countByRule(baseline.findings);
  const fresh:CodeQualityFinding[]=[];
  const seen=new Map<string,number>();
  // Report only new violations compared with their baseline counts.
  // Existing code debt can be reduced without failing an unrelated fix.
  for(const finding of current.findings){
    const n=(seen.get(finding.rule)??0)+1;
    seen.set(finding.rule,n);
    if(n>(existing.get(finding.rule)??0))fresh.push(finding);
  }
  return {passed:fresh.length===0,changedFile:file,findings:fresh};
}
