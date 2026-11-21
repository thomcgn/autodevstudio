import fs from 'node:fs';
import path from 'node:path';

function fileName(userData:string,projectId:string):string{
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(projectId))throw Error('Invalid project ID');
  return path.join(userData,'local-review-fallback',projectId+'.json');
}
/** Explicit opt-in applies only to a future tool-free local reviewer.
 * It is not consent to cloud model upload, execution or Git modifications.
 */
export function readLocalReviewFallback(userData:string,projectId:string):boolean{
  const file=fileName(userData,projectId);
  try{
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>512)
      throw Error('Invalid fallback configuration');
    const parsed:unknown=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
      Object.keys(parsed).length!==1||
      typeof (parsed as Record<string,unknown>).enabled!=='boolean')
      throw Error('Invalid fallback configuration');
    return (parsed as {enabled:boolean}).enabled;
  }catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOENT')return false;
    throw Error('Local reviewer preference corrupt: manual recovery required');
  }
}
export function writeLocalReviewFallback(userData:string,projectId:string,enabled:unknown):boolean{
  if(typeof enabled!=='boolean')throw Error('Boolean opt-in required');
  const file=fileName(userData,projectId);
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const temp=file+'.tmp';
  fs.writeFileSync(temp,JSON.stringify({enabled}),{flag:'w',mode:0o600});
  fs.renameSync(temp,file);
  return enabled;
}
