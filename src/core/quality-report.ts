import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {keyForProject,inspectProjectLock} from './project-lock.ts';
import type {CodeQualityFinding} from './clean-code-audit.ts';

export interface QualityRunReport {
  schemaVersion:1;
  issueNumber:number;
  runId:string;
  reviewFingerprint:string;
  checkpointRevision:number;
  outcome:'passed'|'failed';
  checks:readonly string[];
  findings:readonly CodeQualityFinding[];
  feedback:string;
  recordedAt:string;
}
const HASH=/^[0-9a-f]{64}$/;
const RUN=/^[0-9a-f-]{36}$/;
const MAX_BYTES=32*1024;
function reportPath(base:string,project:string){
  const dir=path.join(base,'quality-reports');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  return path.join(dir,keyForProject(project)+'.json');
}
/** Quality reports are immutable evidence metadata, never model transcripts or
 * code snippets. Write requires a live owner lock; no renderer may forge PASS.
 */
export function writeQualityRunReport(
  base:string,project:string,token:string,
  report:QualityRunReport,
):void {
  if(inspectProjectLock(base,project)?.token!==token)
    throw Error('Quality report requires owned project lock');
  if(!RUN.test(report.runId)||!HASH.test(report.reviewFingerprint)||
    !Number.isSafeInteger(report.issueNumber)||report.issueNumber<1||
    !Number.isSafeInteger(report.checkpointRevision)||report.checkpointRevision<1||
    (report.outcome!=='passed'&&report.outcome!=='failed')||
    !Array.isArray(report.checks)||report.checks.length>10||
    !Array.isArray(report.findings)||report.findings.length>40)
    throw Error('Invalid quality report');
  const bytes=JSON.stringify(report);
  if(Buffer.byteLength(bytes)>MAX_BYTES)throw Error('Quality report too large');
  const file=reportPath(base,project),tmp=file+'.'+randomUUID()+'.tmp';
  try{
    fs.writeFileSync(tmp,bytes,{flag:'wx',mode:0o600});
    fs.renameSync(tmp,file);
  }finally{try{fs.unlinkSync(tmp)}catch{/* renamed */}}
}
export function readQualityRunReport(base:string,project:string):QualityRunReport|null{
  const file=reportPath(base,project);
  try{
    const st=fs.lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_BYTES)
      throw Error('Unsafe quality report');
    const data:unknown=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!data||typeof data!=='object'||Array.isArray(data))
      throw Error('Corrupt quality report');
    const r=data as QualityRunReport;
    if(r.schemaVersion!==1||!RUN.test(r.runId)||
      !HASH.test(r.reviewFingerprint)||!Number.isSafeInteger(r.issueNumber)||
      !Array.isArray(r.checks)||!Array.isArray(r.findings)||
      !['passed','failed'].includes(r.outcome))
      throw Error('Invalid quality report');
    return r;
  }catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOENT')return null;
    throw Error('Quality report invalid: manual recovery required');
  }
}
