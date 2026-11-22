import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile);
const SLUG=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export interface OwnedGitHubRepository {
  fullName:string;
  description:string|null;
  isPrivate:boolean;
  defaultBranch:string;
  updatedAt:string|null;
}
export type OwnedRepositoryRequest=(endpoint:string)=>Promise<unknown>;
const request:OwnedRepositoryRequest=async(endpoint)=>{
  if(!/^user\/repos\?affiliation=owner&per_page=100&page=[1-5]&sort=updated$/.test(endpoint))
    throw Error('Unrecognized read-only repository discovery endpoint');
  const response=await execute('gh',['api','--method','GET',endpoint],{
    encoding:'utf8',timeout:20000,maxBuffer:4_000_000,shell:false,
    env:{...process.env,GH_PROMPT_DISABLED:'1',GIT_TERMINAL_PROMPT:'0'},
  });
  return JSON.parse(response.stdout) as unknown;
};
const obj=(value:unknown):Record<string,unknown>|null=>
  value!==null&&typeof value==='object'&&!Array.isArray(value)
    ?value as Record<string,unknown>:null;
/** Bound, authenticated and read-only. The renderer never receives a GitHub token.
 * Owned repositories include private metadata, but the current historical importer
 * only supports public sources. The UI must not imply private analysis works.
 */
export async function listOwnedGitHubRepositories(
  get:OwnedRepositoryRequest=request,
):Promise<readonly OwnedGitHubRepository[]> {
  const found=new Map<string,OwnedGitHubRepository>();
  for(let page=1;page<=5;page++){
    let raw:unknown;
    try{
      raw=await get('user/repos?affiliation=owner&per_page=100&page='+page+'&sort=updated');
    }catch{throw Error('Eigene GitHub-Repositories konnten nicht geladen werden. gh-Anmeldung, Netzwerk und Berechtigungen prüfen.');}
    if(!Array.isArray(raw)||raw.length>100)
      throw Error('Ungültige oder unvollständige GitHub-Repository-Antwort');
    for(const item of raw){
      const r=obj(item);
      if(!r||typeof r.full_name!=='string'||!SLUG.test(r.full_name)||
        typeof r.private!=='boolean'||typeof r.default_branch!=='string'||
        !/^[A-Za-z0-9._/-]{1,128}$/.test(r.default_branch)||
        r.default_branch.includes('..'))
        throw Error('Ungültiger GitHub-Repository-Eintrag');
      if(r.description!==null&&r.description!==undefined&&typeof r.description!=='string')
        throw Error('Ungültige GitHub-Repository-Beschreibung');
      if(r.updated_at!==null&&r.updated_at!==undefined&&
        (typeof r.updated_at!=='string'||Number.isNaN(Date.parse(r.updated_at))))
        throw Error('Ungültiges GitHub-Repository-Datum');
      const name=r.full_name;
      const key=name.toLowerCase();
      if(found.has(key))continue;
      found.set(key,{
        fullName:name,isPrivate:r.private,defaultBranch:r.default_branch,
        description:typeof r.description==='string'?r.description.slice(0,300):null,
        updatedAt:typeof r.updated_at==='string'?r.updated_at:null,
      });
    }
    if(raw.length<100)return [...found.values()];
  }
  throw Error('Mehr als 500 Repositories: vollständige Liste nicht verifizierbar; keine Teilliste als vollständig ausgeben');
}
