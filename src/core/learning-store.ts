import fs from 'node:fs';
import path from 'node:path';
import type {HistoricalBook} from './historical-lessons.ts';

export interface SavedLearningBook {
  repository:string;head:string;directory:string;lessons:number;
  bookMarkdown:string;solutionsMarkdown:string;reportsMarkdown:string;
}
const SHA=/^[0-9a-f]{40}$/i;
const SLUG=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX=2_000_000;
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
  lessons:book.lessons.map(l=>({key:l.key,commits:l.commits,paths:l.paths,
   documentation:l.sourceUrl})),
 },null,2),{mode:0o600,flag:'wx'});
}
/** Local application data only. Never writes into source repositories.
 * Immutable SHA snapshots prevent a partial or repeated import from corrupting a prior book.
 */
export function saveHistoricalBook(
 base:string,book:HistoricalBook,variant='history',
):SavedLearningBook{
 valid(book);
 if(!/^(?:history|issue-[1-9][0-9]*)$/.test(variant))throw Error('Invalid learning snapshot kind');
 const root=rootFor(base,book.repository);
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 const snapshot=book.head+'--'+variant;
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
 const latest=path.join(root,'latest.json');
 const temporary=path.join(root,'.latest-'+process.pid+'.json');
 fs.writeFileSync(temporary,JSON.stringify({head:book.head,repository:book.repository,snapshot}),{
  mode:0o600,flag:'w'});
 fs.renameSync(temporary,latest);
 return {...book,directory:target,lessons:book.lessons.length};
}
export function loadHistoricalBook(base:string,input:string):SavedLearningBook|null{
 if(!SLUG.test(input))throw Error('Invalid learning repository');
 const root=rootFor(base,input);
 const file=path.join(root,'latest.json');
 if(!fs.existsSync(file))return null;
 const value:unknown=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid learning index');
 const info=value as {head?:unknown;repository?:unknown;snapshot?:unknown};
 if(info.repository!==input||typeof info.head!=='string'||!SHA.test(info.head))
  throw Error('Invalid stored learning index');
 const snapshot=info.snapshot??info.head;
 if(typeof snapshot!=='string'||!(SHA.test(snapshot)||
    /^[0-9a-f]{40}--(?:history|issue-[1-9][0-9]*)$/i.test(snapshot)))
  throw Error('Invalid stored learning snapshot');
 const directory=path.join(root,snapshot);
 for(const filename of ['book.md','solutions.md','reports.md']){
  const filePath=path.join(directory,filename);
  if(!fs.statSync(filePath).isFile()||fs.statSync(filePath).size>MAX)
   throw Error('Invalid stored learning file');
 }
 const sources:unknown=JSON.parse(fs.readFileSync(path.join(directory,'sources.json'),'utf8'));
 const list=typeof sources==='object'&&sources!==null&&!Array.isArray(sources)
  ?(sources as {lessons?:unknown}).lessons:null;
 return {repository:input,head:info.head,directory,
  lessons:Array.isArray(list)?list.length:0,
  bookMarkdown:fs.readFileSync(path.join(directory,'book.md'),'utf8'),
  solutionsMarkdown:fs.readFileSync(path.join(directory,'solutions.md'),'utf8'),
  reportsMarkdown:fs.readFileSync(path.join(directory,'reports.md'),'utf8')};
}
