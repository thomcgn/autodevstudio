import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeSourceWithOllama,analyzeHistoricalCommitWithOllama,requestValidatedLesson,localOllamaModel,requireOllama} from '../src/core/deep-learning-analysis.ts';
const COMMIT='a'.repeat(40),TREE='b'.repeat(40),BLOB='c'.repeat(40);
const chapter=JSON.stringify({
 title:'Eine geprüfte Buchung zuverlässig ausführen',
 problem:'Ein verkaufter Artikel darf nicht unbemerkt zweimal abgerechnet werden.',
 implementation:'Die Methode überprüft den vorhandenen Schlüssel und den Datenbankzustand vor der Buchung.',
 reasoning:'Ein Netzwerkausfall lässt die Antwort verschwinden, nicht zwingend die Buchung selbst.',
 alternatives:'Einfach erneut buchen wäre unzuverlässig; ein stabiler Idempotenzschlüssel schützt den Vorgang.',
 tradeoffs:'Für jeden verwendeten Schlüssel braucht es eine überprüfbare Speicherung und Aufbewahrung.',
 walkthrough:'Zuerst den HTTP-Header ablesen, anschließend den bisherigen Schlüssel vergleichen und Ergebnis zurückgeben.',
 codeExample:'const existing = repository.findByKey(key);',
 exercise:'Erstelle einen Test für einen wiederholten Kauf mit gleichem Schlüssel.',
 solution:'Sende dieselbe Buchung zweimal und prüfe, dass nur ein neuer Verkauf entstanden ist.',
 uncertainty:'Im Code ist ein Operationseintrag zu sehen. Die ursprünglichen Entwicklerabsichten bleiben Interpretation.',
});
const file='src/OrderService.java';
const blob=(content)=>({sha:BLOB,encoding:'base64',size:Buffer.byteLength(content),content:Buffer.from(content).toString('base64')});
const read=async(endpoint)=>{
 if(endpoint.endsWith('git/commits/'+COMMIT))return {tree:{sha:TREE}};
 if(endpoint.endsWith('git/trees/'+TREE+'?recursive=1'))return {
  sha:TREE,truncated:false,tree:[{path:'src',type:'tree',sha:TREE},
   {path:file,type:'blob',sha:BLOB,size:38}]};
 if(endpoint.endsWith('git/blobs/'+BLOB))return blob('class OrderService { String key; }');
 throw Error('Unexpected GitHub endpoint '+endpoint);
};
const run=(input='example/project',deps={})=>{
 const events=[];
 const controller=new AbortController();
 return {events,controller,promise:analyzeSourceWithOllama(
  input,COMMIT,'run-12345678',Date.now(),event=>events.push(event),controller.signal,
  {read,model:async()=>chapter,preflight:async()=>{},...deps})};
};
test('complete source analysis produces file-grounded chapters, solutions and progress',async()=>{
 const result=run();
 const book=await result.promise;
 assert.equal(book.repository,'example/project');
 assert.equal(book.filesAnalyzed,1);
 assert.equal(book.complete,true);
 assert.match(book.bookMarkdown,/Warum kann diese Lösung sinnvoll sein/);
 assert.match(book.bookMarkdown,/OrderService.java/);
 assert.match(book.solutionsMarkdown,/Sende dieselbe Buchung zweimal/);
 assert.ok(result.events.some(e=>e.phase==='discovery'));
 assert.ok(result.events.some(e=>e.phase==='model'));
 assert.ok(result.events.some(e=>e.phase==='architecture'));
 assert.ok(result.events.some(e=>e.phase==='writing'&&e.completed===1&&e.total===2));
 assert.ok(result.events.some(e=>e.phase==='writing'&&e.completed===2&&e.total===2));
 assert.match(book.bookMarkdown,/Systemübersicht|Kapitel 1/);
 assert.equal(result.events.at(-1).phase,'finished');
 assert.equal(result.events.at(-1).etaSeconds,0);
});
test('arbitrary source paths and incomplete trees fail closed',async()=>{
 for(const tree of [
  {sha:TREE,truncated:true,tree:[]},
  {sha:TREE,truncated:false,tree:[{path:'src/../.env',type:'blob',sha:BLOB,size:10}]},
 ]){
  const r=run('example/project',{read:async endpoint=>
    endpoint.endsWith('git/commits/'+COMMIT)?{tree:{sha:TREE}}:tree});
  await assert.rejects(r.promise,/incomplete|No suitable/);
 }
});
test('preflight failure never executes model and never finishes book',async()=>{
 let called=0;
 const r=run('example/project',{
  preflight:async()=>{throw Error('Ollama not installed');},
  model:async()=>{called++;return chapter;}
 });
 await assert.rejects(r.promise,/Ollama not installed/);
 assert.equal(called,0);
 assert.equal(r.events.some(e=>e.phase==='finished'),false);
});
test('invalid model schema fails instead of inventing an approved chapter',async()=>{
 const r=run('example/project',{model:async()=>JSON.stringify({title:'Only one field'})});
 await assert.rejects(r.promise,/incomplete/);
 assert.equal(r.events.some(e=>e.phase==='finished'),false);
});
test('request only uses local Ollama URL, without tools or Kilo token API',async()=>{
 const calls=[];
 const fetcher=async(url,init)=>{
  calls.push({url,init});
  return new Response([
   JSON.stringify({done:false,message:{content:chapter.slice(0,40)}}),
   JSON.stringify({done:false,message:{content:chapter.slice(40)}}),
   JSON.stringify({done:true,message:{content:''}}),'',
  ].join('\n'),{headers:{'Content-Type':'application/x-ndjson'}});
 };
 const answer=await localOllamaModel('qwen2.5-coder:3b',fetcher)(
  'system','user',new AbortController().signal);
 assert.equal(answer,chapter);
 assert.equal(calls[0].url,'http://127.0.0.1:11434/api/chat');
 const payload=JSON.parse(calls[0].init.body);
 assert.equal(payload.stream,true);
 assert.equal(payload.model,'qwen2.5-coder:3b');
 assert.equal(JSON.stringify(payload).includes('tools'),false);
});
test('locally installed model must exist, and response errors fail closed',async()=>{
 const ok=async()=>new Response(JSON.stringify({models:[{name:'qwen2.5-coder:3b'}]}));
 await requireOllama(ok);
 const missing=async()=>new Response(JSON.stringify({models:[]}));
 await assert.rejects(requireOllama(missing),/fehlt/);
});
test('sensitive files are not sent to Ollama',async()=>{
 let prompt='';
 const runWith=run('example/project',{read:async endpoint=>{
  if(endpoint.endsWith('git/commits/'+COMMIT))return {tree:{sha:TREE}};
  if(endpoint.endsWith('git/trees/'+TREE+'?recursive=1'))return {
   sha:TREE,truncated:false,tree:[
    {path:'.env',sha:BLOB,size:20,type:'blob'},
    {path:file,sha:BLOB,size:38,type:'blob'},
   ]};
  return blob('class OrderService { String key; }');
 },model:async(_system,text)=>{prompt=text;return chapter;}});
 const result=await runWith.promise;
 assert.equal(result.complete,false);
 assert.equal(result.filesSkipped,1);
 assert.doesNotMatch(prompt,/\.env/);
});

test('large source file is analyzed in multiple distinct Ollama contexts without truncating its ending',async()=>{
 const long='function start() {}\n'+ 'export const result = 1;\n'.repeat(1200)+
  'function importantAtEnd() { return 42; }\n';
 const prompts=[];
 const r=run('example/project',{read:async endpoint=>{
  if(endpoint.endsWith('git/commits/'+COMMIT))return {tree:{sha:TREE}};
  if(endpoint.endsWith('git/trees/'+TREE+'?recursive=1'))return {
   sha:TREE,truncated:false,tree:[{path:'src/Long.ts',type:'blob',sha:BLOB,size:Buffer.byteLength(long)}]};
  return blob(long);
 },model:async(_,prompt)=>{prompts.push(prompt);return chapter;}});
 const book=await r.promise;
 assert.equal(book.filesAnalyzed,1);
 assert.equal(book.complete,true);
 assert.ok(prompts.length>2);
 assert.ok(prompts.some(prompt=>prompt.includes('importantAtEnd()')));
 assert.match(book.bookMarkdown,/Abschnitt 2/);
});

test('streamed local Ollama emits activity pulses without leaking raw content',async()=>{
 let pulses=0;
 const stream=Array.from({length:40},(_,i)=>JSON.stringify({
  done:false,message:{content:i===0?chapter:''},
 })).concat(JSON.stringify({done:true,message:{content:''}})).join('\n')+'\n';
 const model=localOllamaModel('qwen2.5-coder:3b',
  async()=>new Response(stream));
 const result=await model('system','prompt',new AbortController().signal,()=>{pulses++;});
 assert.equal(result,chapter);
 assert.ok(pulses>=2);
});
test('unterminated Ollama streams are never silently accepted as complete',async()=>{
 const bad=async()=>new Response(JSON.stringify({done:false,message:{content:chapter}})+'\n');
 await assert.rejects(localOllamaModel('qwen2.5-coder:3b',bad)(
  'system','prompt',new AbortController().signal),/unfinished/);
});

test('source-analysis continuation covers file 601 rather than dropping it',async()=>{
 const entries=Array.from({length:601},(_,i)=>({
  path:'src/File'+i+'.ts',type:'blob',sha:BLOB,size:34,
 }));
 const source=async endpoint=>{
  if(endpoint.endsWith('git/commits/'+COMMIT))return {tree:{sha:TREE}};
  if(endpoint.endsWith('git/trees/'+TREE+'?recursive=1'))
   return {sha:TREE,truncated:false,tree:entries};
  if(endpoint.endsWith('git/blobs/'+BLOB))
   return blob('class OrderService { String key; }');
  throw Error('Unexpected '+endpoint);
 };
 const first=await run('example/project',{read:source}).promise;
 assert.equal(first.filesAnalyzed,600);
 assert.equal(first.filesTotal,601);
 assert.equal(first.nextOffset,600);
 assert.equal(first.complete,false);
 const second=await run('example/project',{read:source,offset:600}).promise;
 assert.equal(second.filesAnalyzed,1);
 assert.equal(second.filesTotal,601);
 assert.equal(second.nextOffset,null);
 assert.equal(second.complete,true);
 await assert.rejects(run('example/project',{read:source,offset:601}).promise,/continuation cursor/);
});

test('every eligible Git patch receives evidence-grounded local model lessons',async()=>{
 const sha='d'.repeat(40);
 const prompts=[];
 const files=[
  {filename:'src/A.ts',patch:'@@ -1 +1 @@\n-old\n+const value = 10;'},
  {filename:'src/B.ts',patch:'@@ -1 +1 @@\n-old\n+function test() { return true; }'},
 ];
 const result=await analyzeHistoricalCommitWithOllama('example/project',sha,30,
  new AbortController().signal,{
   read:async endpoint=>{
    assert.equal(endpoint,'repos/example/project/commits/'+sha);
    return {sha,files};
   },
   model:async(_system,prompt)=>{prompts.push(prompt);return chapter;},
  });
 assert.equal(result.complete,true);
 assert.equal(result.chapters,2);
 assert.equal(prompts.length,2);
 assert.ok(prompts.some(prompt=>prompt.includes('src/A.ts')));
 assert.ok(prompts.some(prompt=>prompt.includes('src/B.ts')));
 assert.match(result.bookMarkdown,/Kapitel 30/);
 assert.match(result.bookMarkdown,/Kapitel 31/);
 assert.match(result.bookMarkdown,new RegExp('commit/'+sha));
 assert.match(result.solutionsMarkdown,/Sende dieselbe Buchung zweimal/);
});
test('incomplete or dangerous historical Git patches are never silently accepted',async()=>{
 const sha='d'.repeat(40);
 let calls=0;
 const result=await analyzeHistoricalCommitWithOllama('example/project',sha,1,
  new AbortController().signal,{
   read:async()=>({sha,files:[
    {filename:'src/valid.ts',patch:'@@\n+const id = 1;'},
    {filename:'src/../../.env',patch:'secret=abc'},
    {filename:'src/graph.png'},
   ]}),
   model:async()=>{calls++;return chapter;},
  });
 assert.equal(result.complete,false);
 assert.equal(calls,1);
 assert.match(result.reportsMarkdown,/Unvollständige Quellenlage/);
 await assert.rejects(analyzeHistoricalCommitWithOllama('example/project',sha,1,
  new AbortController().signal,{
   read:async()=>({sha,files:Array.from({length:300},()=>({filename:'A.ts',patch:'+'}))}),
  }),/incomplete/);
});
test('long historical patch is split into model windows and includes final diff',async()=>{
 const sha='d'.repeat(40);
 const trailing='const historicalTail = 777;';
 const patch='@@\n'+Array.from({length:500},(_,i)=>'+const line'+i+' = '+i+';').join('\n')+
  '\n+'+trailing;
 const prompts=[];
 const result=await analyzeHistoricalCommitWithOllama('example/project',sha,1,
  new AbortController().signal,{
   read:async()=>({sha,files:[{filename:'src/long.ts',patch}]}),
   model:async(_,prompt)=>{prompts.push(prompt);return chapter;},
  });
 assert.equal(result.complete,true);
 assert.ok(prompts.length>1);
 assert.ok(prompts.some(prompt=>prompt.includes(trailing)));
 assert.equal(result.chapters,prompts.length);
});
test('history analysis rejects unverified SHA and honors cancellation before requests',async()=>{
 let calls=0;
 await assert.rejects(analyzeHistoricalCommitWithOllama('example/project','invalid',1,
  new AbortController().signal,{read:async()=>{calls++;return {};}}),/identity/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(analyzeHistoricalCommitWithOllama('example/project','d'.repeat(40),1,
  controller.signal,{read:async()=>{calls++;return {};}}),/cancelled/);
 assert.equal(calls,0);
});

test('recovers invalid first Ollama JSON via one evidence-grounded schema retry',async()=>{
 let calls=0;
 const result=await requestValidatedLesson(async(_system,prompt)=>{
  calls++;
  if(calls===1)return '{broken';
  assert.match(prompt,/ANTWORTFORMAT VERBINDLICH/);
  return chapter;
 },'trusted system','Real code context',new AbortController().signal);
 assert.equal(calls,2);
 assert.match(result.title,/Buchung/);
});
test('two malformed Ollama JSON completions fail closed and never fabricate a chapter',async()=>{
 let calls=0;
 await assert.rejects(requestValidatedLesson(async()=>{
  calls++;
  return '{}';
 },'system','code',new AbortController().signal),/erneuter Formatprüfung ungültig/);
 assert.equal(calls,2);
});

test('Kilo cloud analyzes entire large UTF-8 sources without exceeding gateway prompt byte budget',async()=>{
 const entries=Array.from({length:24},(_,i)=>({path:'src/module'+i+'.ts',type:'blob',
  sha:BLOB,size:Buffer.byteLength('const data = "'+'ä'.repeat(2200)+'";')}));
 const rawContent='const data = "'+'ä'.repeat(2200)+'";';
 const requests=[];let calls=0;
 const read=async endpoint=>{
  if(endpoint.endsWith('git/commits/'+COMMIT))return {tree:{sha:TREE}};
  if(endpoint.endsWith('git/trees/'+TREE+'?recursive=1'))
   return {truncated:false,sha:TREE,tree:entries};
  if(endpoint.endsWith('git/blobs/'+BLOB))
   return blob(rawContent);
  throw Error('unexpected read '+endpoint);
 };
 const history=Array.from({length:40},(_,i)=>({sha:(i+1).toString(16).padStart(40,'0'),
  title:'Changed APIs '+ 'ä'.repeat(200),changedPaths:['src/module0.ts']}));
 const model=async(system,prompt)=>{
  calls++;
  const bytes=Buffer.byteLength(system+'\n'+prompt,'utf8');
  requests.push({bytes,prompt});
  assert.ok(bytes<=28_000,'Gateway prompt too large: '+bytes+' bytes');
  return chapter;
 };
 const run=analyzeSourceWithOllama('example/project',COMMIT,'run-12345678',Date.now(),
  ()=>{},new AbortController().signal,{
   read,model,preflight:async()=>{},modelName:'kilo-auto/free',history,
  });
 const result=await run;
 assert.equal(result.filesAnalyzed,entries.length);
 assert.equal(result.filesSkipped,0);
 assert.equal(result.complete,true);
 assert.ok(calls>24);
 assert.ok(requests.some(x=>x.prompt.includes('Systemarchitektur')||
   x.prompt.includes('Gesamtarchitektur')));
 assert.ok(requests.some(x=>x.prompt.includes('Abschnitt 3')));
 assert.ok(result.bookMarkdown.includes('src/module23.ts'));
});
