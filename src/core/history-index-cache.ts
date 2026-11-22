import fs from 'node:fs';
import path from 'node:path';
import {indexPublicRepositoryHistory,parsePublicRepository,walkPublicRepositoryHistory}
  from './public-history.ts';
import type {PublicHistoryIndex,HistoricalCommit,GitHubHistoryRead} from './public-history.ts';

const SHA=/^[a-f0-9]{40}$/i;
const PAGE_SIZE=100;
function isRecord(value:unknown):value is Record<string,unknown>{
 return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
function validated(value:unknown,repository:string,head:string,page:number):PublicHistoryIndex{
 if(!isRecord(value)||value.repository!==repository||value.fixedHead!==head||
  value.page!==page||typeof value.hasMore!=='boolean'||!Array.isArray(value.commits)||
  value.commits.length>PAGE_SIZE||value.readOnly!==true||
  value.requiresInterpretation!==true)throw Error('Corrupt pinned Git history page');
 for(const entry of value.commits){
  if(!isRecord(entry)||typeof entry.sha!=='string'||!SHA.test(entry.sha)||
   typeof entry.title!=='string'||entry.title.length>180||
   !Array.isArray(entry.changedPaths)||entry.changedPaths.length>60||
   entry.evidenceUrl!=='https://github.com/'+repository+'/commit/'+entry.sha)
   throw Error('Corrupt historical commit provenance');
 }
 return value as unknown as PublicHistoryIndex;
}
function pageFile(directory:string,page:number):string{
 if(!Number.isSafeInteger(page)||page<1)throw Error('Invalid history page');
 return path.join(directory,'page-'+String(page).padStart(10,'0')+'.json');
}
function persistPage(directory:string,index:PublicHistoryIndex):void{
 const target=pageFile(directory,index.page);
 const content=JSON.stringify(index);
 if(Buffer.byteLength(content)>128_000)throw Error('History index page exceeded safe size');
 if(fs.existsSync(target)){
  const previous=fs.readFileSync(target,'utf8');
  if(previous!==content)throw Error('Pinned history page changed between runs');
  return;
 }
 const temp=target+'.'+process.pid+'.tmp';
 try{
  fs.writeFileSync(temp,content,{mode:0o600,flag:'wx'});
  fs.renameSync(temp,target);
 }finally{if(fs.existsSync(temp))fs.rmSync(temp);}
}
export async function readCompletePublicHistory(
 base:string,input:string,options:{
  read:GitHubHistoryRead;signal?:AbortSignal;
  onProgress?:(commits:number,page:number,finished:boolean)=>void;
 },
):Promise<{repository:string;head:string;licenseSpdx:string|null;
  commits:HistoricalCommit[]}>{
 const repository=parsePublicRepository(input);
 const first=await indexPublicRepositoryHistory(repository,options.read,PAGE_SIZE,1,
  undefined,false);
 const dir=path.join(base,'learning-history-cache',repository.replace('/','__'),
  first.fixedHead);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const commits:HistoricalCommit[]=[];
 const seen=new Set<string>();
 const collect=(index:PublicHistoryIndex):void=>{
  for(const commit of index.commits){
   if(seen.has(commit.sha))throw Error('Duplicate commit in cached history');
   seen.add(commit.sha);
   commits.push(commit);
  }
  options.onProgress?.(commits.length,index.page,!index.hasMore);
 };
 const cachedFirst=pageFile(dir,1);
 if(fs.existsSync(cachedFirst)){
  const parsed:unknown=JSON.parse(fs.readFileSync(cachedFirst,'utf8'));
  validated(parsed,repository,first.fixedHead,1);
 }else persistPage(dir,first);
 let page=1;
 while(true){
  if(options.signal?.aborted)throw Error('Git history cancelled');
  const filename=pageFile(dir,page);
  if(!fs.existsSync(filename))break;
  const stat=fs.statSync(filename);
  if(!stat.isFile()||stat.size>128_000)throw Error('Corrupt cached history file');
  const cached:unknown=JSON.parse(fs.readFileSync(filename,'utf8'));
  const index=validated(cached,repository,first.fixedHead,page);
  collect(index);
  if(!index.hasMore)return {repository,head:first.fixedHead,
    licenseSpdx:first.licenseSpdx,commits};
  page++;
 }
 await walkPublicRepositoryHistory(repository,{
  read:options.read,pageSize:PAGE_SIZE,pinnedHead:first.fixedHead,
  startPage:page,initialCount:commits.length,collect:false,
  includeChangedPaths:false,signal:options.signal,
  onPage:index=>{
   persistPage(dir,index);
   collect(index);
  },
 });
 return {repository,head:first.fixedHead,licenseSpdx:first.licenseSpdx,commits};
}
