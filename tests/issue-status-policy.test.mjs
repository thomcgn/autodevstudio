import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {keyForProject} from '../src/core/project-lock.ts';
import {previewCheckpointIssueStatus} from '../src/core/issue-status-policy.ts';

function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-status-preview-'));
 const dir=path.join(root,'project');fs.mkdirSync(dir);
 const git={head:'a'.repeat(40),branch:'autodev/issue-5',worktreeHash:'b'.repeat(64)};
 const cp={schemaVersion:1,projectKey:keyForProject(dir),runId:randomUUID(),
  issueNumber:5,stage:'review',revision:2,git,
  sessions:{reviewer:'verified-reviewer-1'},reviewPassed:false,qualityPassed:false,
  savedAt:'2026-11-22T14:00:00Z'};
 return {dir,root,cp,git,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('read-only checkpoint preview suggests review but cannot mutate GitHub',()=>{
 const f=fixture();try{
  const result=previewCheckpointIssueStatus(f.dir,5,['status:in-progress','priority:p1'],
    f.cp,f.git);
  assert.equal(result.proposed,'status:review');
  assert.equal(result.allowed,false);
  assert.equal(result.provenance,'checkpoint');
 }finally{f.close();}
});
test('review and quality flags alone never approve; independent evidence required',()=>{
 const f=fixture();try{
  const quality={...f.cp,stage:'quality',reviewPassed:true,qualityPassed:true};
  const unsafe=previewCheckpointIssueStatus(f.dir,5,['status:review'],quality,f.git);
  assert.equal(unsafe.proposed,'status:review');
  const proven=previewCheckpointIssueStatus(f.dir,5,['status:review'],quality,f.git,true);
  assert.equal(proven.proposed,'status:approved');
  assert.equal(proven.allowed,false);
 }finally{f.close();}
});
test('local done is only Draft PR, and never proves merged or closed',()=>{
 const f=fixture();try{
  const cp={...f.cp,stage:'done',reviewPassed:true,qualityPassed:true};
  assert.equal(previewCheckpointIssueStatus(f.dir,5,['status:review'],cp,f.git).proposed,null);
  const approved=previewCheckpointIssueStatus(f.dir,5,['status:review'],cp,f.git,true);
  assert.equal(approved.proposed,'status:approved');
  assert.notEqual(approved.proposed,'status:done');
 }finally{f.close();}
});
test('drift, status conflicts, cross-issue and project mismatch block proposals',()=>{
 const f=fixture();try{
  const variants=[
   [f.dir,5,['status:review','status:ready'],f.cp,f.git],
   [f.dir,6,['status:ready'],f.cp,f.git],
   [f.dir,5,['status:ready'],f.cp,{...f.git,head:'c'.repeat(40)}],
   [f.dir,5,['status:ready'],{...f.cp,projectKey:'z'.repeat(64)},f.git],
  ];
  for(const args of variants){
   const r=previewCheckpointIssueStatus(...args);
   assert.equal(r.proposed,null);
   assert.equal(r.allowed,false);
  }
 }finally{f.close();}
});
test('blocked labels cannot be silently cleared, and no done can be downgraded',()=>{
 const f=fixture();try{
  assert.equal(previewCheckpointIssueStatus(f.dir,5,['status:blocked'],f.cp,f.git).proposed,null);
  assert.equal(previewCheckpointIssueStatus(f.dir,5,['status:done'],f.cp,f.git).proposed,null);
  assert.equal(previewCheckpointIssueStatus(f.dir,5,['status:ready'],null,f.git).proposed,null);
 }finally{f.close();}
});
