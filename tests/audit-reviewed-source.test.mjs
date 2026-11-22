import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {auditReviewedSource} from '../src/core/audit-reviewed-source.ts';

function fixture(before,after){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-source-audit-'));
 const file=path.join(root,'src','example.ts');
 fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,before);
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
 git('init','-b','main');
 git('config','user.name','Tests');
 git('config','user.email','tests@example.org');
 git('add','.');
 git('commit','-m','baseline');
 fs.writeFileSync(file,after);
 return {root,file,git,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('new explicit any is a blocking regression against clean baseline',async()=>{
 const f=fixture('export const safe: number = 1;\n',
   'export const safe: any = 1;\n');
 try{
  const result=await auditReviewedSource(f.root);
  assert.equal(result.passed,false);
  assert.equal(result.changedFile,'src/example.ts');
  assert.ok(result.findings.some(x=>x.rule==='explicit-any'));
 }finally{f.close();}
});
test('previous legacy debt is not newly introduced and does not prevent unrelated fix',async()=>{
 const before='export const existing: any = 1;\nexport const safe = 0;\n';
 const after='export const existing: any = 1;\nexport const safe = 1;\n';
 const f=fixture(before,after);
 try{
  const result=await auditReviewedSource(f.root);
  assert.equal(result.passed,true);
  assert.deepEqual(result.findings,[]);
 }finally{f.close();}
});
test('new suppression is blocked while existing debt remains baseline',async()=>{
 const before='export const value = 1;\n';
 const after='// @ts-ignore\nexport const value = 2;\n';
 const f=fixture(before,after);
 try{
  const result=await auditReviewedSource(f.root);
  assert.equal(result.passed,false);
  assert.ok(result.findings.some(x=>x.rule==='unsafe-suppression'));
 }finally{f.close();}
});
test('untracked or multiple modified files refuse to claim the audit passed',async()=>{
 const f=fixture('export const value = 1;\n','export const value = 2;\n');
 try{
  fs.writeFileSync(path.join(f.root,'extra.txt'),'unreviewed');
  await assert.rejects(auditReviewedSource(f.root),/exactly one/);
 }finally{f.close();}
});
