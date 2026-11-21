import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  readLocalReviewCalibration,recordLocalReviewCalibration,
} from '../src/core/local-review-calibration-record.ts';
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-local-calibration-'));
 return {root,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('synthetic reviewer PASS stored only for one project and seven days',()=>{
 const f=fixture(),now=1900000000000;
 try{
  assert.equal(readLocalReviewCalibration(f.root,'project',now),false);
  recordLocalReviewCalibration(f.root,'project',true,now);
  assert.equal(readLocalReviewCalibration(f.root,'project',now),true);
  assert.equal(readLocalReviewCalibration(f.root,'other-project',now),false);
  assert.equal(readLocalReviewCalibration(f.root,'project',now+6*86400000),true);
  assert.equal(readLocalReviewCalibration(f.root,'project',now+8*86400000),false);
  assert.equal(readLocalReviewCalibration(f.root,'project',now-1),false);
  recordLocalReviewCalibration(f.root,'project',false,now+1);
  assert.equal(readLocalReviewCalibration(f.root,'project',now+2),false);
 }finally{f.close();}
});
test('stale, forged and malformed results never count as calibration',()=>{
 const f=fixture();
 try{
  const dir=path.join(f.root,'local-review-calibration');fs.mkdirSync(dir);
  const file=path.join(dir,'project.json');
  const valid={suiteVersion:1,model:'qwen2.5-coder:3b',passed:true,checkedAt:12345};
  for(const value of [
   {...valid,model:'other-model'},
   {...valid,suiteVersion:2},
   {...valid,extra:'spoof'},
   {...valid,checkedAt:'today'},
  ]){
   fs.writeFileSync(file,JSON.stringify(value));
   assert.throws(()=>readLocalReviewCalibration(f.root,'project'),/manual review/);
  }
  fs.writeFileSync(file,'{oops');
  assert.throws(()=>readLocalReviewCalibration(f.root,'project'),/manual review/);
  assert.throws(()=>recordLocalReviewCalibration(f.root,'../project',true),/Invalid project ID/);
  assert.throws(()=>recordLocalReviewCalibration(f.root,'project',1),/Invalid calibration result/);
 }finally{f.close();}
});
test('no raw model response, tokens, path or project code stored in certificate',()=>{
 const f=fixture();
 try{
  recordLocalReviewCalibration(f.root,'project',true,1900000000000);
  const record=fs.readFileSync(path.join(f.root,'local-review-calibration','project.json'),'utf8');
  assert.deepEqual(Object.keys(JSON.parse(record)).sort(),
    ['checkedAt','model','passed','suiteVersion']);
  assert.doesNotMatch(record,/SECRET_TOKEN|prompt|diff|credentials|\/home\//);
 }finally{f.close();}
});
