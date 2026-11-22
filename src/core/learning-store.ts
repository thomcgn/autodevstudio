import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {HistoricalLesson} from './historical-lessons.ts';
import type {DevelopmentDecision} from './development-case-studies.ts';
import type {HistoricalBook} from './historical-lessons.ts';

export interface SavedLearningBook {
  repository:string;head:string;directory:string;lessons:number;
  bookMarkdown:string;solutionsMarkdown:string;reportsMarkdown:string;
  lessonEntries:HistoricalLesson[];license:string|null;
  caseStudies:DevelopmentDecision[];
  deepCursor?:{nextOffset:number;filesTotal:number;filesAnalyzed:number;
    filesSkipped:number;model:string};
  deepSummary?:{model:string;filesAnalyzed:number;filesSkipped:number;complete:boolean;filesTotal:number};
  historyCursor?:{nextIndex:number;total:number;chapters:number;incomplete:number;model:string};
  pagination?:{page:number;hasMore:boolean;pageSize?:number};
}
const SHA=/^[0-9a-f]{40}$/i;
const SLUG=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX=32_000_000;
function valid(book:HistoricalBook):void {
 if(!SLUG.test(book.repository)||!SHA.test(book.head))throw Error('Invalid learning book identity');
 for(const markdown of [book.bookMarkdown,book.solutionsMarkdown,book.reportsMarkdown]){
  if(typeof markdown!=='string'||markdown.length>MAX)throw Error('Learning book exceeds local limit');
 }
 if(!Array.isArray(book.lessons)||book.lessons.length>30)throw Error('Invalid lesson list');
}
function rootFor(base:string,repo:string):string{
 return path.join(base,'learning-library',repo.replace('/','__'));
}
function storeFiles(directory:string,book:HistoricalBook):void {
 fs.writeFileSync(path.join(directory,'book.md'),book.bookMarkdown,{mode:0o600,flag:'wx'});
 fs.writeFileSync(path.join(directory,'solutions.md'),book.solutionsMarkdown,{mode:0o600,flag:'wx'});
 fs.writeFileSync(path.join(directory,'reports.md'),book.reportsMarkdown,{mode:0o600,flag:'wx'});
 fs.writeFileSync(path.join(directory,'sources.json'),JSON.stringify({
  repository:book.repository,head:book.head,license:book.license,
  lessons:book.lessons,caseStudies:book.caseStudies??[],pagination:book.pagination??null,
  deepCursor:book.deepCursor??null,deepSummary:book.deepSummary??null,historyCursor:book.historyCursor??null,
 },null,2),{mode:0o600,flag:'wx'});
}
/** Local application data only. Never writes into source repositories.
 * Immutable SHA snapshots prevent a partial or repeated import from corrupting a prior book.
 */
export function saveHistoricalBook(
 base:string,book:HistoricalBook,variant='history',
):SavedLearningBook{
 valid(book);
 if(!/^(?:history|deep|deep-kilo|issue-[1-9][0-9]*)$/.test(variant))throw Error('Invalid learning snapshot kind');
 const root=rootFor(base,book.repository);
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 const digest=createHash('sha256').update(book.bookMarkdown).update(book.solutionsMarkdown)
  .update(book.reportsMarkdown).update(JSON.stringify(book.pagination??null))
  .update(JSON.stringify(book.deepCursor??null)).update(JSON.stringify(book.deepSummary??null))
  .update(JSON.stringify(book.historyCursor??null)).digest('hex').slice(0,12);
 const snapshot=book.head+'--'+variant+'-'+digest;
 const target=path.join(root,snapshot);
 if(fs.existsSync(target)){
  if(!fs.statSync(target).isDirectory())throw Error('Invalid existing learning snapshot');
  const existing=fs.readFileSync(path.join(target,'book.md'),'utf8');
  if(existing!==book.bookMarkdown)throw Error('SHA snapshot changed: refusing overwrite');
 }else{
  const staging=fs.mkdtempSync(path.join(root,'.import-'));
  try{
   storeFiles(staging,book);
   fs.renameSync(staging,target);
  }finally{
   if(fs.existsSync(staging))fs.rmSync(staging,{recursive:true,force:true});
  }
 }
 const latest=path.join(root,variant==='deep'?'latest-deep.json':variant==='deep-kilo'?'latest-deep-kilo.json':'latest.json');
 const temporary=path.join(root,'.latest-'+variant+'-'+process.pid+'.json');
 fs.writeFileSync(temporary,JSON.stringify({head:book.head,repository:book.repository,snapshot}),{
  mode:0o600,flag:'w'});
 fs.renameSync(temporary,latest);
 return {...book,directory:target,lessons:book.lessons.length,
  lessonEntries:book.lessons,license:book.license,pagination:book.pagination,deepCursor:book.deepCursor,deepSummary:book.deepSummary,historyCursor:book.historyCursor,
  caseStudies:book.caseStudies??[]};
}
export function loadHistoricalBook(
 base:string,input:string,variant:'history'|'deep'|'deep-kilo'='history',
):SavedLearningBook|null{
 if(!SLUG.test(input))throw Error('Invalid learning repository');
 const root=rootFor(base,input);
 const file=path.join(root,variant==='deep'?'latest-deep.json':
  variant==='deep-kilo'?'latest-deep-kilo.json':'latest.json');
 if(!fs.existsSync(file))return null;
 const value:unknown=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid learning index');
 const info=value as {head?:unknown;repository?:unknown;snapshot?:unknown};
 if(info.repository!==input||typeof info.head!=='string'||!SHA.test(info.head))
  throw Error('Invalid stored learning index');
 const snapshot=info.snapshot??info.head;
 if(typeof snapshot!=='string'||!(SHA.test(snapshot)||
    /^[0-9a-f]{40}--(?:history|deep|deep-kilo|issue-[1-9][0-9]*)(?:-[0-9a-f]{12})?$/i.test(snapshot)))
  throw Error('Invalid stored learning snapshot');
 const directory=path.join(root,snapshot);
 for(const filename of ['book.md','solutions.md','reports.md']){
  const filePath=path.join(directory,filename);
  if(!fs.statSync(filePath).isFile()||fs.statSync(filePath).size>MAX)
   throw Error('Invalid stored learning file');
 }
 const sources:unknown=JSON.parse(fs.readFileSync(path.join(directory,'sources.json'),'utf8'));
 const metadata=typeof sources==='object'&&sources!==null&&!Array.isArray(sources)
  ?sources as {lessons?:unknown;license?:unknown;pagination?:unknown;caseStudies?:unknown;deepCursor?:unknown;deepSummary?:unknown;historyCursor?:unknown}:null;
 const list=metadata?.lessons;
 const lessonEntries:HistoricalLesson[]=Array.isArray(list)?list.filter((x:unknown):
    x is HistoricalLesson=>typeof x==='object'&&x!==null&&!Array.isArray(x)&&
      typeof (x as {key?:unknown}).key==='string'&&
      typeof (x as {plain?:unknown}).plain==='string'&&
      Array.isArray((x as {commits?:unknown}).commits)):[];
 const license=typeof metadata?.license==='string'?metadata.license:null;
 const caseStudies:DevelopmentDecision[]=Array.isArray(metadata?.caseStudies)
  ?metadata.caseStudies.filter((x:unknown):x is DevelopmentDecision=>{
    if(x===null||typeof x!=='object'||Array.isArray(x))return false;
    const item=x as Record<string,unknown>;
    return typeof item.repository==='string'&&typeof item.sha==='string'&&
      typeof item.title==='string'&&Array.isArray(item.paths);
  }):[];
 const rawCursor=metadata?.deepCursor;
 const cursor=rawCursor!==null&&typeof rawCursor==='object'&&!Array.isArray(rawCursor)
  ?rawCursor as Record<string,unknown>:null;
 const deepCursor=cursor&&
   Number.isSafeInteger(cursor.nextOffset)&&Number(cursor.nextOffset)>0&&
   Number.isSafeInteger(cursor.filesTotal)&&Number(cursor.filesTotal)>=Number(cursor.nextOffset)&&
   Number.isSafeInteger(cursor.filesAnalyzed)&&Number(cursor.filesAnalyzed)>=0&&
   Number.isSafeInteger(cursor.filesSkipped)&&Number(cursor.filesSkipped)>=0&&
   typeof cursor.model==='string'&&cursor.model.length<100
   ?{nextOffset:Number(cursor.nextOffset),filesTotal:Number(cursor.filesTotal),
     filesAnalyzed:Number(cursor.filesAnalyzed),filesSkipped:Number(cursor.filesSkipped),
     model:cursor.model}:undefined;
 const rawSummary=metadata?.deepSummary;
 const summary=rawSummary!==null&&typeof rawSummary==='object'&&!Array.isArray(rawSummary)
  ?rawSummary as Record<string,unknown>:null;
 const deepSummary=summary&&typeof summary.model==='string'&&summary.model.length<100&&
   Number.isSafeInteger(summary.filesAnalyzed)&&Number(summary.filesAnalyzed)>=0&&
   Number.isSafeInteger(summary.filesSkipped)&&Number(summary.filesSkipped)>=0&&
   Number.isSafeInteger(summary.filesTotal)&&Number(summary.filesTotal)>=Number(summary.filesAnalyzed)&&
   typeof summary.complete==='boolean'
   ?{model:summary.model,filesAnalyzed:Number(summary.filesAnalyzed),
     filesSkipped:Number(summary.filesSkipped),filesTotal:Number(summary.filesTotal),
     complete:summary.complete}:undefined;
 const rawHistory=metadata?.historyCursor;
 const h=rawHistory!==null&&typeof rawHistory==='object'&&!Array.isArray(rawHistory)
  ?rawHistory as Record<string,unknown>:null;
 const historyCursor=h&&[h.nextIndex,h.total,h.chapters,h.incomplete].every(
   value=>Number.isSafeInteger(value)&&Number(value)>=0)&&
   Number(h.total)>=Number(h.nextIndex)&&typeof h.model==='string'&&h.model.length<100
   ?{nextIndex:Number(h.nextIndex),total:Number(h.total),chapters:Number(h.chapters),
     incomplete:Number(h.incomplete),model:h.model}:undefined;
 const p=metadata?.pagination;
 const pagination=p!==null&&typeof p==='object'&&!Array.isArray(p)&&
   Number.isSafeInteger((p as {page?:unknown}).page)&&
   (p as {page:number}).page>=1&&
   typeof (p as {hasMore?:unknown}).hasMore==='boolean'&&
   ((p as {pageSize?:unknown}).pageSize===undefined||
     (Number.isSafeInteger((p as {pageSize?:unknown}).pageSize)&&
      Number((p as {pageSize?:unknown}).pageSize)>=1&&
      Number((p as {pageSize?:unknown}).pageSize)<=100))
   ?p as {page:number;hasMore:boolean;pageSize?:number}:undefined;
 return {repository:input,head:info.head,directory,
  lessons:Array.isArray(list)?list.length:0,lessonEntries,license,pagination,caseStudies,deepCursor,deepSummary,historyCursor,
  bookMarkdown:fs.readFileSync(path.join(directory,'book.md'),'utf8'),
  solutionsMarkdown:fs.readFileSync(path.join(directory,'solutions.md'),'utf8'),
  reportsMarkdown:fs.readFileSync(path.join(directory,'reports.md'),'utf8')};
}
