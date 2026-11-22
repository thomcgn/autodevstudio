import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateHistoricalBook,mergeHistoricalBook} from '../src/core/historical-lessons.ts';
import {saveHistoricalBook,loadHistoricalBook} from '../src/core/learning-store.ts';
import {indexPublicRepositoryHistory} from '../src/core/public-history.ts';
const A='a'.repeat(40),B='b'.repeat(40);
const repo='example/studio';
const base={repository:repo,defaultBranch:'main',fixedHead:A,licenseSpdx:'MIT',
 readOnly:true,requiresInterpretation:true,page:1,hasMore:true};
const commit=(sha,title,p)=>({sha,title,changedPaths:[p],committedAt:null,
 pathsComplete:true,evidenceUrl:'https://github.com/example/studio/commit/'+sha});
test('same topic retains old commits, and additional topics are appended once',async()=>{
 const first=await generateHistoricalBook({...base,commits:[commit(A,'Generics','src/A.java')]},
  async()=>({files:[{filename:'src/A.java',patch:'@@\n+List<String> names = List.of("Ada");'}]}));
 const second=await generateHistoricalBook({...base,page:2,commits:[
  commit(B,'Streams','src/B.java'),commit(A,'Generics','src/A.java')]},
  async endpoint=>endpoint.endsWith(B)?
    {files:[{filename:'src/B.java',patch:'@@\n+values.stream().filter(x -> x > 0);'}]}:
    {files:[{filename:'src/A.java',patch:'@@\n+List<Integer> ids = List.of(1);'}]});
 const grown=mergeHistoricalBook(first,second);
 assert.equal(grown.lessons.length,3);
 assert.equal(grown.lessons.find(l=>l.key==='java-generics')?.commits.length,1);
 assert.match(grown.bookMarkdown,/Java: Streams/);
 assert.doesNotMatch(grown.solutionsMarkdown,/### Einfach erklärt/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-growing-'));
 try{
  const firstSaved=saveHistoricalBook(dir,first);
  const grownSaved=saveHistoricalBook(dir,grown);
  assert.notEqual(firstSaved.directory,grownSaved.directory);
  assert.equal(loadHistoricalBook(dir,repo)?.lessonEntries.length,3);
  const continued={...grown,pagination:{page:3,hasMore:true}};
  saveHistoricalBook(dir,continued);
  const resumed=loadHistoricalBook(dir,repo);
  assert.equal(resumed?.pagination?.page,3);
  assert.equal(resumed?.pagination?.hasMore,true);
  const final={...continued,pagination:{page:4,hasMore:false}};
  const last=saveHistoricalBook(dir,final);
  assert.notEqual(last.directory,grownSaved.directory);
  assert.equal(loadHistoricalBook(dir,repo)?.pagination?.hasMore,false);
  assert.equal(fs.existsSync(path.join(firstSaved.directory,'book.md')),true);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('cross-repository lesson merges are forbidden',async()=>{
 const first=await generateHistoricalBook({...base,commits:[commit(A,'One','src/A.java')]},
  async()=>({files:[]}));
 assert.throws(()=>mergeHistoricalBook(first,{...first,repository:'other/repo'}),/Cross-repository/);
});
test('pagination remains pinned to first HEAD even if default branch advanced',async()=>{
 const requests=[];
 const read=async endpoint=>{
  requests.push(endpoint);
  if(endpoint==='repos/example/studio')return {private:false,full_name:repo,size:10,
   default_branch:'main',license:null};
  if(endpoint==='repos/example/studio/branches/main')return {commit:{sha:B}};
  if(endpoint==='repos/example/studio/commits?sha='+A+'&per_page=2&page=2')
   return [{sha:A,commit:{message:'older change'}}];
  if(endpoint==='repos/example/studio/commits/'+A)return {files:[]};
  throw Error('Unexpected '+endpoint);
 };
 const result=await indexPublicRepositoryHistory(repo,read,2,2,A);
 assert.equal(result.fixedHead,A);
 assert.equal(result.page,2);
 assert.equal(result.hasMore,false);
 assert.equal(requests.some(q=>q.includes('sha='+A)),true);
 assert.equal(result.page,2);
});

test('all commits in a page contribute evidence, including commits after twelve',async()=>{
 const commits=Array.from({length:16},(_,i)=>commit(
  (i+1).toString(16).padStart(40,'0'),'Generic change '+i,'src/Generics.java'));
 const result=await generateHistoricalBook({...base,commits},
  async()=>({files:[{filename:'src/Generics.java',
    patch:'@@\n+List<String> names = List.of("Ada");'}]}));
 const generics=result.lessons.find(lesson=>lesson.key==='java-generics');
 assert.equal(generics?.commits.length,16);
});

test('partial Ollama source analysis persists an exact resume cursor across restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-deep-resume-'));
 try{
  const source={repository:repo,head:A,license:'MIT',lessons:[],
   bookMarkdown:'# Codebook\n\n## Kapitel 1: Overview\n',
   solutionsMarkdown:'# Solutions\n',reportsMarkdown:'# Reports\n',
   deepCursor:{nextOffset:600,filesTotal:601,filesAnalyzed:600,
     filesSkipped:0,model:'qwen2.5-coder:3b'},
   deepSummary:{model:'qwen2.5-coder:3b',filesAnalyzed:600,filesTotal:601,
     filesSkipped:0,complete:false}};
  saveHistoricalBook(dir,source);
  assert.deepEqual(loadHistoricalBook(dir,repo)?.deepCursor,source.deepCursor);
  assert.deepEqual(loadHistoricalBook(dir,repo)?.deepSummary,source.deepSummary);
  assert.match(loadHistoricalBook(dir,repo)?.bookMarkdown??'',/Kapitel 1/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
