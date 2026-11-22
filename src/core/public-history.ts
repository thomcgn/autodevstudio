import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile);
const SLUG=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA=/^[0-9a-f]{40}$/i;
const MAX_COMMITS=20;
const MAX_SIZE_KB=100_000;
export interface HistoricalCommit {
  sha:string;
  title:string;
  committedAt:string|null;
  changedPaths:readonly string[];
  pathsComplete:boolean;
  evidenceUrl:string;
}
export interface PublicHistoryIndex {
  repository:string;
  defaultBranch:string;
  fixedHead:string;
  licenseSpdx:string|null;
  commits:readonly HistoricalCommit[];
  readOnly:true;
  requiresInterpretation:true;
  page:number;
  hasMore:boolean;
}
export type GitHubHistoryRead=(endpoint:string)=>Promise<unknown>;
function record(value:unknown):Record<string,unknown>|null {
  return value!==null&&typeof value==='object'&&!Array.isArray(value)
    ?value as Record<string,unknown>:null;
}
function fail(message:string):never {throw Error('Public history: '+message);}
export function parsePublicRepository(value:string):string {
  if(typeof value!=='string'||value.length>250)fail('invalid repository address');
  let slug=value.trim();
  if(slug.startsWith('https://')){
    let url:URL;
    try{url=new URL(slug);}catch{return fail('invalid URL');}
    if(url.hostname!=='github.com'||url.username||url.password||url.search||url.hash||
      url.port||!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname))
      fail('only canonical public GitHub repository URLs are allowed');
    slug=url.pathname.replace(/^\/+|\/+$/g,'');
  }
  if(!SLUG.test(slug)||slug.includes('..'))fail('invalid owner/repository');
  return slug;
}
/** REST-backed reader. No shell, no clone, no Git hooks, no POST/PUT/PATCH. */
export const readGitHubPublicJson:GitHubHistoryRead=async endpoint=>{
  if(!/^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:branches|commits)(?:\/|\?)|^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(endpoint))
    fail('forbidden API endpoint');
  try{
    const response=await execute('gh',['api','--method','GET',endpoint],{
      encoding:'utf8',timeout:20_000,maxBuffer:4_000_000,shell:false,
      env:{...process.env,GH_PROMPT_DISABLED:'1',GIT_TERMINAL_PROMPT:'0'},
    });
    return JSON.parse(response.stdout) as unknown;
  }catch{return fail('GitHub API not readable (network, permissions or rate limit)');}
};
function requiredRecord(value:unknown,message:string):Record<string,unknown>{
  const result=record(value);if(!result)fail(message);return result;
}
function commitTitle(value:unknown):string {
  if(typeof value!=='string')fail('commit message missing');
  const first=value.split(/\r?\n/,1)[0]?.trim()??'';
  if(!first)return '(Commit ohne lesbaren Titel)';
  return first.slice(0,180).replace(/[\u0000-\u001f]/g,' ');
}
function getPaths(value:unknown):{paths:readonly string[];complete:boolean}{
  const commit=requiredRecord(value,'commit detail missing');
  if(!Array.isArray(commit.files))return {paths:[],complete:false};
  const paths:string[]=[];
  for(const item of commit.files){
    const file=record(item);
    if(file&&typeof file.filename==='string'&&file.filename.length<250&&
      !file.filename.startsWith('/')&&!file.filename.includes('..')&&
      !file.filename.includes('\\'))paths.push(file.filename);
  }
  return {paths:[...new Set(paths)].slice(0,60),complete:commit.files.length<100&&paths.length<=60};
}
/** Source discovery only. Never infer motives, quality PASS or a lesson from a commit message. */
export async function indexPublicRepositoryHistory(
  input:string,read:GitHubHistoryRead=readGitHubPublicJson,limit=12,
  page=1,pinnedHead?:string,
):Promise<PublicHistoryIndex>{
  const slug=parsePublicRepository(input);
  if(!Number.isSafeInteger(limit)||limit<1||limit>MAX_COMMITS)fail('invalid commit limit');
  if(!Number.isSafeInteger(page)||page<1||page>100)fail('invalid commit page');
  if(pinnedHead!==undefined&&!SHA.test(pinnedHead))fail('invalid pinned commit SHA');
  const metadata=requiredRecord(await read('repos/'+slug),'repository metadata missing');
  if(metadata.private!==false||typeof metadata.full_name!=='string'||
     metadata.full_name.toLowerCase()!==slug.toLowerCase())
    fail('repository is not a verified public repository');
  if(typeof metadata.size!=='number'||metadata.size<0||metadata.size>MAX_SIZE_KB)
    fail('repository size unavailable or exceeds safe limit');
  if(typeof metadata.default_branch!=='string'||
    !/^[A-Za-z0-9._/-]{1,128}$/.test(metadata.default_branch)||
    metadata.default_branch.includes('..'))fail('default branch cannot be verified');
  const branch=metadata.default_branch;
  const branchInfo=requiredRecord(await read('repos/'+slug+'/branches/'+encodeURIComponent(branch)),
    'default branch metadata missing');
  const liveHead=record(branchInfo.commit)?.sha;
  if(typeof liveHead!=='string'||!SHA.test(liveHead))fail('invalid branch HEAD');
  const head=pinnedHead??liveHead;
  const history=await read('repos/'+slug+'/commits?sha='+head+'&per_page='+limit+(page===1?'':'&page='+page));
  if(!Array.isArray(history)||history.length>limit)fail('invalid commits response');
  const commits:HistoricalCommit[]=[];
  const seen=new Set<string>();
  for(const value of history){
    const item=requiredRecord(value,'invalid commit response');
    const sha=item.sha;
    if(typeof sha!=='string'||!SHA.test(sha)||seen.has(sha))
      fail('invalid or duplicate commit SHA');
    seen.add(sha);
    const info=requiredRecord(item.commit,'commit metadata missing');
    const author=record(info.author);
    const date=author?.date;
    const committedAt=typeof date==='string'&&!Number.isNaN(Date.parse(date))
      ?new Date(date).toISOString():null;
    const details=await read('repos/'+slug+'/commits/'+sha);
    const paths=getPaths(details);
    commits.push({sha,title:commitTitle(info.message),committedAt,
      changedPaths:paths.paths,pathsComplete:paths.complete,
      evidenceUrl:'https://github.com/'+slug+'/commit/'+sha});
  }
  const license=record(metadata.license)?.spdx_id;
  const licenseSpdx=typeof license==='string'&&license!=='NOASSERTION'&&
    /^[A-Za-z0-9-.+]{1,60}$/.test(license)?license:null;
  return {repository:slug,defaultBranch:branch,fixedHead:head,licenseSpdx,
    commits,readOnly:true,requiresInterpretation:true,page,hasMore:commits.length===limit};
}