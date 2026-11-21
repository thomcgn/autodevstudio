import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {inspectProjectLock,keyForProject} from './project-lock.ts';
import {loadCoreCheckpoint,type CoreCheckpoint,type GitIdentity} from './checkpoint-store.ts';

const HASH=/^[0-9a-f]{64}$/;
const MAX_BYTES=2048;
export interface ReviewedEvidenceProof {
  schemaVersion:1;
  runId:string;
  issueNumber:number;
  checkpointRevision:number;
  evidenceFingerprint:string;
  git:GitIdentity;
}
function proofFile(base:string,projectPath:string):string{
  const folder=path.join(base,'review-proofs');
  fs.mkdirSync(folder,{recursive:true,mode:0o700});
  return path.join(folder,keyForProject(projectPath)+'.json');
}
function sameGit(a:GitIdentity,b:GitIdentity):boolean{
  return a.head===b.head&&a.branch===b.branch&&a.worktreeHash===b.worktreeHash;
}
function valid(proof:unknown,cp:CoreCheckpoint):proof is ReviewedEvidenceProof{
  if(!proof||typeof proof!=='object'||Array.isArray(proof))return false;
  const data=proof as Record<string,unknown>;
  const git=data.git;
  if(!git||typeof git!=='object'||Array.isArray(git))return false;
  const identity=git as GitIdentity;
  return Object.keys(data).length===6&&
    data.schemaVersion===1&&data.runId===cp.runId&&
    data.issueNumber===cp.issueNumber&&
    data.checkpointRevision===cp.revision&&
    typeof data.evidenceFingerprint==='string'&&HASH.test(data.evidenceFingerprint)&&
    Object.keys(git).length===3&&sameGit(identity,cp.git);
}
/** Only the trusted reviewed PASS handoff may issue this certificate.
 * Even if the checkpoint survives a crash but the proof write does not,
 * later quality verification must fail closed.
 */
export function saveReviewedEvidenceProof(
  base:string,projectPath:string,lockToken:string,
  checkpoint:CoreCheckpoint,evidenceFingerprint:string,
):ReviewedEvidenceProof{
  const owner=inspectProjectLock(base,projectPath);
  if(!owner||owner.token!==lockToken)
    throw Error('Review proof requires owned project lock');
  const current=loadCoreCheckpoint(base,projectPath);
  if(!current||current.revision!==checkpoint.revision||
    current.runId!==checkpoint.runId||current.stage!=='quality'||
    !current.reviewPassed||current.qualityPassed||
    !HASH.test(evidenceFingerprint))
    throw Error('Review proof requires current quality-pending checkpoint');
  const proof:ReviewedEvidenceProof={
    schemaVersion:1,runId:current.runId,issueNumber:current.issueNumber,
    checkpointRevision:current.revision,evidenceFingerprint,
    git:{...current.git},
  };
  if(!valid(proof,current))throw Error('Invalid review proof');
  const file=proofFile(base,projectPath),temp=file+'.'+randomUUID()+'.tmp';
  try{
    fs.writeFileSync(temp,JSON.stringify(proof),{flag:'wx',mode:0o600});
    fs.renameSync(temp,file);
  }finally{try{fs.unlinkSync(temp)}catch{/* renamed */}}
  return proof;
}
/** Verifies that a durable PASS belongs to EXACTLY this checkpoint revision,
 * run, issue and Git tree. Missing/corrupt/stale proof never passes Quality.
 * Caller must separately verify the actual current Git identity.
 */
export function requireReviewedEvidenceProof(
  base:string,projectPath:string,checkpoint:CoreCheckpoint,
  currentGit:GitIdentity,
):ReviewedEvidenceProof{
  if(checkpoint.stage!=='quality'||!checkpoint.reviewPassed||
    checkpoint.qualityPassed||!sameGit(checkpoint.git,currentGit))
    throw Error('Review proof invalid for current quality stage');
  const file=proofFile(base,projectPath);
  let proof:unknown;
  try{
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES)
      throw Error('Unsafe review proof');
    proof=JSON.parse(fs.readFileSync(file,'utf8'));
  }catch{throw Error('Review proof missing or corrupt: manual recovery required');}
  if(!valid(proof,checkpoint))
    throw Error('Review proof stale or mismatched: manual recovery required');
  return proof;
}
