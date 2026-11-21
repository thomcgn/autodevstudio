import fs from 'node:fs';
import path from 'node:path';
import type { KiloFreeModel } from './kilo-free-models.ts';

export interface KiloRoleModels { planner:string; builder:string; reviewer:string }
const ROLES=['planner','builder','reviewer'] as const;
const ID=/^[a-zA-Z0-9][a-zA-Z0-9._/:-]{0,159}$/;
export function validateRoleModels(input:unknown,freeModels:readonly KiloFreeModel[]):KiloRoleModels {
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid model selection');
  const data=input as Record<string,unknown>;
  if(Object.keys(data).length!==ROLES.length||Object.keys(data).some(k=>!ROLES.includes(k as typeof ROLES[number])))
    throw Error('Invalid model selection');
  const allowed=new Set(freeModels.map(model=>model.id));
  for(const role of ROLES) {
    if(typeof data[role]!=='string'||!ID.test(data[role])||!allowed.has(data[role]))
      throw Error('Selection is no longer verified free');
  }
  return {planner:data.planner as string,builder:data.builder as string,reviewer:data.reviewer as string};
}
function selectionPath(userData:string,projectId:string):string {
  if(!/^[0-9a-zA-Z_-]{1,128}$/.test(projectId))throw Error('Invalid project ID');
  return path.join(userData,'kilo-roles',projectId+'.json');
}
/** Purely administrative role mapping, no invocation. Persist under userData,
 * never inside a target Git repository. A saved mapping does not authorize
 * execution and must be revalidated against a current free catalog before use.
 */
export function saveKiloRoles(userData:string,projectId:string,values:KiloRoleModels,models:readonly KiloFreeModel[]):KiloRoleModels {
  const validated=validateRoleModels(values,models);
  const file=selectionPath(userData,projectId);
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const temp=file+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(validated),{mode:0o600});
  fs.renameSync(temp,file);
  return validated;
}
export function loadKiloRoles(userData:string,projectId:string):KiloRoleModels|null {
  const file=selectionPath(userData,projectId);
  try {
    const stat=fs.statSync(file);
    if(!stat.isFile()||stat.size>2048)return null;
    const value:unknown=JSON.parse(fs.readFileSync(file,'utf8'));
    // Parsing stored settings does NOT prove a model remains free.
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    const data=value as Record<string,unknown>;
    if(Object.keys(data).length!==3||!ROLES.every(r=>typeof data[r]==='string'&&ID.test(data[r])))return null;
    return {planner:data.planner as string,builder:data.builder as string,reviewer:data.reviewer as string};
  }catch{return null;}
}
