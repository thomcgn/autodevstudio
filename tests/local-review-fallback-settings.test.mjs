import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readLocalReviewFallback,writeLocalReviewFallback} from '../src/core/local-review-fallback-settings.ts';

test('local fallback remains disabled until explicit per-project opt in',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-local-fallback-'));
 try{
   assert.equal(readLocalReviewFallback(root,'project-one'),false);
   assert.equal(writeLocalReviewFallback(root,'project-one',true),true);
   assert.equal(readLocalReviewFallback(root,'project-one'),true);
   assert.equal(readLocalReviewFallback(root,'project-two'),false);
   assert.equal(writeLocalReviewFallback(root,'project-one',false),false);
   assert.equal(readLocalReviewFallback(root,'project-one'),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('reject malformed input, path traversals and corrupt saved config',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-local-fallback-'));
 try{
   assert.throws(()=>writeLocalReviewFallback(root,'project',1),/Boolean/);
   assert.throws(()=>writeLocalReviewFallback(root,'../project',true),/Invalid project/);
   writeLocalReviewFallback(root,'project',true);
   fs.writeFileSync(path.join(root,'local-review-fallback','project.json'),'{oops');
   assert.throws(()=>readLocalReviewFallback(root,'project'),/manual recovery/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
