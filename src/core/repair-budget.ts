import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {keyForProject,inspectProjectLock} from './project-lock.ts';

const MAX_ATTEMPTS=2;
interface RepairBudget {schemaVersion:1;runId:string;attempts:number}
const RUN=/^[0-9a-f-]{36}$/;
function filename(base:string,project:string):string{
 const dir=path.join(base,'repair-budgets');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 return path.join(dir,keyForProject(project)+'.json');
}
export function repairAttempts(base:string,project:string,runId:string):number{
 if(!RUN.test(runId))throw Error('Invalid repair run');
 const file=filename(base,project);
 try{
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>512)
    throw Error('Unsafe repair budget');
  const raw:unknown=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    throw Error('Corrupt repair budget');
  const data=raw as RepairBudget;
  if(data.schemaVersion!==1||!RUN.test(data.runId)||
    !Number.isSafeInteger(data.attempts)||data.attempts<0||
    data.attempts>MAX_ATTEMPTS)
    throw Error('Invalid repair budget');
  return data.runId===runId?data.attempts:0;
 }catch(e){
  if((e as NodeJS.ErrnoException).code==='ENOENT')return 0;
  throw Error('Repair budget invalid: manual recovery required');
 }
}
/** Reserve attempt BEFORE asking the model, so failures and crashes cannot
 * accidentally grant unlimited retries. Only a held project lock can spend.
 */
export function reserveRepairAttempt(base:string,project:string,token:string,runId:string):number{
 if(inspectProjectLock(base,project)?.token!==token)
  throw Error('Repair budget requires owned lock');
 const n=repairAttempts(base,project,runId);
 if(n>=MAX_ATTEMPTS)throw Error('Repair attempt limit reached');
 const file=filename(base,project),tmp=file+'.'+randomUUID()+'.tmp';
 const record:RepairBudget={schemaVersion:1,runId,attempts:n+1};
 try{
  fs.writeFileSync(tmp,JSON.stringify(record),{flag:'wx',mode:0o600});
  fs.renameSync(tmp,file);
 }finally{try{fs.unlinkSync(tmp)}catch{/* renamed */}}
 return n+1;
}
export const MAX_LOCAL_REPAIR_ATTEMPTS=MAX_ATTEMPTS;
