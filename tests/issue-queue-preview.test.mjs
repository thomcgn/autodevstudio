import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {acquireProjectLock} from '../src/core/project-lock.ts';
import {saveCoreCheckpoint} from '../src/core/checkpoint-store.ts';
import {planIssueQueue} from '../src/core/issue-queue-preview.ts';

const issue=(number,labels=[])=>({number,title:'Issue '+number,body:'',
 url:'https://github.com/example/project/issues/'+number,labels});
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-issue-queue-'));
 const project=path.join(root,'project'),base=path.join(root,'studio');
 fs.mkdirSync(project);
 const git={root:project,branch:'main',head:'a'.repeat(40),
  remoteSlug:'example/project',clean:true,canExecute:false,
  reasons:['Protected branch – create an isolated feature branch first']};
 return {root,project,base,git,
  close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('stable priority and issue ID ordering from explicit trusted labels',()=>{
 const f=fixture();try{
  const q=planIssueQueue(f.base,f.project,[
   issue(8,['status:ready','priority:p3']),issue(5,['status:ready','priority:p1']),
   issue(6,['status:ready','priority:p0']),issue(4,['status:ready','priority:p1'])],f.git);
  assert.equal(q.previewOnly,true);
  assert.equal(q.executionEnabled,false);
  assert.equal(q.readyToStart,true);
  assert.equal(q.nextIssueNumber,6);
  assert.deepEqual(q.queue.map(i=>i.number),[6,4,5,8]);
 }finally{f.close();}
});
test('manual/blocked labels never become queue candidates',()=>{
 const f=fixture();try{
  const q=planIssueQueue(f.base,f.project,[
   issue(2,['status:ready','blocked','priority:p0']),issue(3,['status:ready','manual-only','priority:p1']),
   issue(4,['status:ready','priority:p2'])],f.git);
  assert.equal(q.nextIssueNumber,4);
  assert.equal(q.queue.find(i=>i.number===2)?.state,'held');
  assert.equal(q.queue.find(i=>i.number===3)?.state,'held');
  assert.equal(q.queue[0].number,4);
 }finally{f.close();}
});
test('any checkpoint, including done, blocks next issue without cleanup',()=>{
 const f=fixture();try{
  const lock=acquireProjectLock(f.base,f.project);
  saveCoreCheckpoint(f.base,f.project,lock.record.token,{
   runId:randomUUID(),issueNumber:1,stage:'done',
   git:{head:'a'.repeat(40),branch:'autodev/issue-1',
     worktreeHash:'b'.repeat(64)},
   sessions:{},reviewPassed:true,qualityPassed:true,
  },null);
  lock.release();
  const q=planIssueQueue(f.base,f.project,[issue(5,['status:ready','priority:p2'])],f.git);
  assert.equal(q.readyToStart,false);
  assert.equal(q.nextIssueNumber,null);
  assert.match(q.reason,/checkpoint/);
 }finally{f.close();}
});
test('dirty/untracked Git and active project lock block next issue',()=>{
 const f=fixture();try{
  let q=planIssueQueue(f.base,f.project,[issue(3,['status:ready','priority:p2'])],{
   ...f.git,clean:false});
  assert.equal(q.readyToStart,false);
  const lock=acquireProjectLock(f.base,f.project);
  q=planIssueQueue(f.base,f.project,[issue(3,['status:ready','priority:p2'])],f.git);
  assert.match(q.reason,/locked/);
  lock.release();
 }finally{f.close();}
});
test('duplicate issue IDs are rejected rather than silently reordered',()=>{
 const f=fixture();try{
  assert.throws(()=>planIssueQueue(f.base,f.project,[issue(1),issue(1)],f.git),
   /duplicate/);
 }finally{f.close();}
});

test('only exactly one ready status and one explicit priority permit start',()=>{
 const f=fixture();try{
 const q=planIssueQueue(f.base,f.project,[
  issue(11,['status:backlog','priority:p0']),
  issue(12,['status:ready','priority:p1','status:review']),
  issue(13,['status:ready']),
  issue(14,['status:ready','priority:p2','priority:p0']),
  issue(15,['status:ready','priority:p2']),
  issue(16,['priority:p0']),
  issue(17,['status:blocked','priority:p0']),
 ],f.git);
 assert.equal(q.nextIssueNumber,15);
 for(const n of [11,12,13,14,16,17])
  assert.equal(q.queue.find(item=>item.number===n)?.state,'held');
 }finally{f.close();}
});

test('explicit open issue dependency blocks even a P0 ready candidate',()=>{
 const f=fixture();try{
  const q=planIssueQueue(f.base,f.project,[
   issue(15,['status:ready','priority:p0','depends-on:#14']),
   issue(14,['status:ready','priority:p2']),
  ],f.git);
  assert.equal(q.nextIssueNumber,14);
  assert.equal(q.queue.find(x=>x.number===15)?.state,'held');
  assert.match(q.queue.find(x=>x.number===15)?.reason??'',/open issue #14/);
  assert.deepEqual(q.queue.find(x=>x.number===15)?.triage.dependencyIssues,[14]);
 }finally{f.close();}
});
test('missing or malformed dependency must not silently count as completed',()=>{
 const f=fixture();try{
  const labels=[
   ['status:ready','priority:p1','depends-on:#999'],
   ['status:ready','priority:p1','depends-on:latest'],
   ['status:ready','priority:p1','depends-on:#1'],
   ['status:ready','priority:p1','depends-on:#2','depends-on:#2'],
  ];
  const q=planIssueQueue(f.base,f.project,labels.map((l,i)=>issue(i+1,l)),f.git);
  assert.equal(q.readyToStart,false);
  assert.equal(q.nextIssueNumber,null);
  for(const item of q.queue)assert.equal(item.state,'held');
  assert.match(q.queue.find(x=>x.number===1)?.reason??'',/completion unverified/);
  assert.match(q.queue.find(x=>x.number===2)?.reason??'',/Invalid depends-on/);
  assert.match(q.queue.find(x=>x.number===3)?.reason??'',/open issue #1/);
  assert.match(q.queue.find(x=>x.number===4)?.reason??'',/Duplicate issue dependency/);
 }finally{f.close();}
});
test('triage shows authoritative label evidence but never promotes or changes labels',()=>{
 const f=fixture();try{
  const original=['status:ready','priority:p3'];
  const q=planIssueQueue(f.base,f.project,[issue(17,original)],f.git);
  const entry=q.queue[0];
  assert.equal(entry.priority,3);
  assert.equal(entry.triage.proposalOnly,true);
  assert.equal(entry.triage.source,'github-labels');
  assert.match(entry.triage.evidence.join(' '),/Explicit GitHub priority: P3/);
  assert.deepEqual(original,['status:ready','priority:p3']);
 }finally{f.close();}
});
