import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {implementIssueLocally} from '../src/core/local-issue-to-code.ts';
import {loadCoreCheckpoint} from '../src/core/checkpoint-store.ts';
import {inspectProjectLock,projectLockDirectoryExists} from '../src/core/project-lock.ts';

const issue={number:42,title:'Make greeting helpful',body:'Make greet() return "Hello, world!"'};
const file='src/greet.ts';
const old='export function greet() { return "hi"; }\n';
const next='export function greet() { return "Hello, world!"; }\n';
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-real-issue-code-'));
 const project=path.join(root,'repo'),base=path.join(root,'studio');
 fs.mkdirSync(path.join(project,'src'),{recursive:true});
 fs.writeFileSync(path.join(project,file),old);
 function git(...args){return execFileSync('git',args,{cwd:project,encoding:'utf8'}).trim();}
 git('init','-b','main');
 git('config','user.name','Test');
 git('config','user.email','test@example.org');
 git('remote','add','origin','https://github.com/example/fixture.git');
 git('add','.');
 git('commit','-m','Initial');
 return {root,base,project,git,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const fakeModel=async prompt=>{
 if(prompt.startsWith('Choose exactly ONE'))return JSON.stringify({path:file});
 if(prompt.startsWith('Create ONE minimal edit'))return JSON.stringify({
  search:old.trimEnd(),replace:next.trimEnd(),
 });
 throw Error('Unexpected prompt');
};
test('REAL issue becomes an uncommitted code diff on its own Git branch with review checkpoint',async()=>{
 const f=fixture();
 try{
  const before=f.git('rev-parse','HEAD');
  const result=await implementIssueLocally(f.base,f.project,issue,fakeModel);
  assert.equal(result.issueNumber,42);
  assert.equal(result.branch,'autodev/issue-42');
  assert.equal(result.changedFile,file);
  assert.equal(result.stage,'review');
  assert.equal(result.checkpointRevision,2);
  assert.equal(result.published,false);
  assert.equal(f.git('branch','--show-current'),'autodev/issue-42');
  assert.equal(f.git('rev-parse','HEAD'),before,'No commit was made');
  assert.equal(fs.readFileSync(path.join(f.project,file),'utf8'),next);
  assert.match(f.git('status','--short'),/src\/greet.ts/);
  const cp=loadCoreCheckpoint(f.base,f.project);
  assert.equal(cp.stage,'review');
  assert.equal(cp.reviewPassed,false);
  assert.equal(cp.qualityPassed,false);
  assert.equal(projectLockDirectoryExists(f.base,f.project),false);
 }finally{f.close();}
});
test('invalid, unsafe or ambiguous model patch cannot touch project or create branch',async()=>{
 const cases=[
  async()=>JSON.stringify({path:'../secret.env'}),
  async prompt=>prompt.startsWith('Choose')?JSON.stringify({path:file}):
    JSON.stringify({search:'does-not-exist',replace:'x'}),
  async prompt=>prompt.startsWith('Choose')?JSON.stringify({path:file}):
    JSON.stringify({search:'return',replace:'changed'}),
 ];
 for(const [index,model]of cases.entries()){
  const f=fixture();
  try{
   if(index===2)fs.writeFileSync(path.join(f.project,file),'return return'); // uncommitted: fail
   await assert.rejects(implementIssueLocally(f.base,f.project,issue,model));
   assert.equal(f.git('branch','--show-current'),'main');
   assert.equal(loadCoreCheckpoint(f.base,f.project),null);
  }finally{f.close();}
 }
});
test('dirty Git worktree cannot be used to overwrite files',async()=>{
 const f=fixture();
 try{
  fs.writeFileSync(path.join(f.project,file),'user edits');
  await assert.rejects(implementIssueLocally(f.base,f.project,issue,fakeModel),/Unsafe branch preparation|Repository changed/);
  assert.equal(fs.readFileSync(path.join(f.project,file),'utf8'),'user edits');
  assert.equal(f.git('branch','--show-current'),'main');
 }finally{f.close();}
});
test('abort before model selection does not change Git state',async()=>{
 const f=fixture(),abort=new AbortController();abort.abort();
 try{
  await assert.rejects(implementIssueLocally(f.base,f.project,issue,
    async()=>{throw Error('should not call')},abort.signal),/cancelled/);
  assert.equal(f.git('branch','--show-current'),'main');
 }finally{f.close();}
});
