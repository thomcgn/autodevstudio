import fs from 'node:fs';
import path from 'node:path';

const MODEL='qwen2.5-coder:3b';
const SUITE_VERSION=1;
const MAX_AGE_MS=7*24*60*60*1000;
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const MAX_BYTES=512;

export interface LocalReviewCalibrationRecord {
  suiteVersion:1;
  model:'qwen2.5-coder:3b';
  passed:boolean;
  checkedAt:number;
}
function fileName(userData:string,projectId:string):string{
  if(!ID.test(projectId))throw Error('Invalid project ID');
  return path.join(userData,'local-review-calibration',projectId+'.json');
}
/** Fail closed if the record is expired, corrupted, for a different fixture
 * version, or has a mismatched local model. Never trusts renderer values.
 * A two-fixture calibration is only a narrow capability check, NOT a
 * reliability guarantee or authorization to submit private repo evidence.
 */
export function readLocalReviewCalibration(
  userData:string,projectId:string,now=Date.now(),
):boolean {
  const file=fileName(userData,projectId);
  try {
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES)
      throw Error('Invalid calibration record');
    const value:unknown=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value))
      throw Error('Invalid calibration record');
    const v=value as Record<string,unknown>;
    if(Object.keys(v).length!==4||v.suiteVersion!==SUITE_VERSION||
      v.model!==MODEL||typeof v.passed!=='boolean'||
      !Number.isSafeInteger(v.checkedAt))
      throw Error('Invalid calibration record');
    return v.passed===true&&
      typeof now==='number'&&Number.isSafeInteger(now)&&
      (v.checkedAt as number)<=now&&
      now-(v.checkedAt as number)<=MAX_AGE_MS;
  }catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOENT')return false;
    throw Error('Local calibration record invalid: manual review required');
  }
}
/** Only Main may call this after an actual fixed synthetic calibration.
 * At calibration start, write passed=false BEFORE running any new requests,
 * preventing a failed re-test from reusing an older success.
 */
export function recordLocalReviewCalibration(
  userData:string,projectId:string,passed:boolean,now=Date.now(),
):void {
  if(typeof passed!=='boolean'||!Number.isSafeInteger(now)||now<0)
    throw Error('Invalid calibration result');
  const file=fileName(userData,projectId);
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const temp=file+'.tmp';
  const record:LocalReviewCalibrationRecord={
    suiteVersion:SUITE_VERSION,model:MODEL,passed,checkedAt:now,
  };
  try{
    fs.writeFileSync(temp,JSON.stringify(record),{flag:'w',mode:0o600});
    fs.renameSync(temp,file);
  }finally{
    try{fs.unlinkSync(temp);}catch{ /* renamed */ }
  }
}
