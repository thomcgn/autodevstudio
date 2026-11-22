import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createVerifiedIssueLearning} from '../src/core/learning-live.ts';
import {loadHistoricalBook} from '../src/core/learning-store.ts';
const SHA='c'.repeat(40);
const evidence={repository:'example/studio',issueNumber:5,commitSha:SHA,
 draftUrl:'https://github.com/example/studio/pull/17',
 reviewPassed:true,qualityPassed:true};
test('verified completed issue creates a local teaching report without executing project scripts',async t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-live-book-'));
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const args=[];
 const runner=async values=>{
  args.push([...values]);
  if(values.includes('--name-only'))return 'src/EventService.java\n';
  return 'diff --git a/src/EventService.java b/src/EventService.java\n@@ -1,0 +1,1 @@\n+List<String> names = List.of("Ada");\n';
 };
 const result=await createVerifiedIssueLearning(base,'/private/not-accessed',evidence,runner);
 assert.equal(result.recorded,true);
 assert.equal(result.topicCount,2);
 const saved=loadHistoricalBook(base,'example/studio');
 assert.match(saved.reportsMarkdown,/Draft-PR: https:\/\/github.com\/example\/studio\/pull\/17/);
 assert.match(saved.reportsMarkdown,/Reviewer-Checkpoint: PASS/);
 assert.match(saved.reportsMarkdown,/Tatsächlich berührte Quell-Dateien: src\/EventService\.java/);
 assert.match(saved.reportsMarkdown,/In diesem Commit erkannte Konzepte: .*Java: Generics/);
 assert.match(saved.reportsMarkdown,/Grund der Anforderung: siehe verlinktes GitHub-Issue/);
 assert.match(saved.bookMarkdown,/Java: Generics/);
 assert.equal(args.every(a=>a[0]==='show'),true);
 const again=await createVerifiedIssueLearning(base,'/private/not-accessed',evidence,runner);
 assert.equal(again.recorded,true);
});
test('review or quality absent never produces a saved report',async t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-live-rejected-'));
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const result=await createVerifiedIssueLearning(base,'/ignored',{...evidence,qualityPassed:false},
  async()=>{throw Error('must not run');});
 assert.equal(result.recorded,false);
 assert.equal(loadHistoricalBook(base,'example/studio'),null);
});
test('unsupported or unsafe changed files are ignored instead of executed',async t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-live-unsafe-'));
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const result=await createVerifiedIssueLearning(base,'/ignored',evidence,
  async()=>'.github/workflows/inject.yml\n../secret\n');
 assert.equal(result.recorded,false);
 assert.equal(result.reason,'unsupported-repository');
});

test('forged Draft PR URLs never become verified learning evidence',async()=>{
 for(const bad of [
  'https://github.com/example/studio/pull/17?token=abc',
  'https://github.com/example/studio/pull/17/extra',
  'https://github.com/example/studio/pull/17#other',
  'https://github.com/other/studio/pull/17',
 ]) {
  const result=await createVerifiedIssueLearning('/not/accessed','/not/accessed',
    {...evidence,draftUrl:bad},async()=>{throw Error('Git must not run');});
  assert.equal(result.recorded,false);
 }
});

test('untrusted issue titles remain plain, bounded text in teaching reports',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-live-sanitize-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const runner=async args=>args.includes('--name-only')?'src/EventService.java\n':
  'diff --git a/src/EventService.java b/src/EventService.java\n@@\n+List<String> names;\n';
 await createVerifiedIssueLearning(root,'/unused',
   {...evidence,issueTitle:'Feature <script>alert(1)</script>\n## Fake chapter'},runner);
 const text=loadHistoricalBook(root,'example/studio').reportsMarkdown;
 assert.doesNotMatch(text,/<script>/);
 assert.doesNotMatch(text,/^## Fake chapter$/m);
 assert.match(text,/Dokumentierter Auftrag:/);
});
