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
   issue(8,['priority:low']),issue(5,['priority:p1']),
   issue(6,['priority:p0']),issue(4,['priority:p1'])],f.git);
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
   issue(2,['blocked','priority:p0']),issue(3,['manual-only']),
   issue(4,['priority:p2'])],f.git);
  assert.equal(q.nextIssueNumber,4);
  assert.equal(q.queue[0].state,'held');
  assert.equal(q.queue[1].state,'held');
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
  const q=planIssueQueue(f.base,f.project,[issue(5)],f.git);
  assert.equal(q.readyToStart,false);
  assert.equal(q.nextIssueNumber,null);
  assert.match(q.reason,/checkpoint/);
 }finally{f.close();}
});
test('dirty/untracked Git and active project lock block next issue',()=>{
 const f=fixture();try{
  let q=planIssueQueue(f.base,f.project,[issue(3)],{
   ...f.git,clean:false});
  assert.equal(q.readyToStart,false);
  const lock=acquireProjectLock(f.base,f.project);
  q=planIssueQueue(f.base,f.project,[issue(3)],f.git);
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
