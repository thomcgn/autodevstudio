import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateHistoricalBook} from '../src/core/historical-lessons.ts';
import {saveHistoricalBook,loadHistoricalBook} from '../src/core/learning-store.ts';
import {markdownToPrintHtml} from '../src/core/learning-pdf-html.ts';

const A='a'.repeat(40),B='b'.repeat(40);
const index={
 repository:'example/studio',defaultBranch:'main',fixedHead:A,licenseSpdx:'MIT',
 readOnly:true,requiresInterpretation:true,
 commits:[
  {sha:A,title:'use typed collections',committedAt:null,
   changedPaths:['src/EventService.java'],pathsComplete:true,evidenceUrl:'https://github.com/example/studio/commit/'+A},
  {sha:B,title:'React UI',committedAt:null,
   changedPaths:['src/App.tsx'],pathsComplete:true,evidenceUrl:'https://github.com/example/studio/commit/'+B},
 ],
};
const read=async endpoint=>{
 if(endpoint.endsWith(A))return {files:[{filename:'src/EventService.java',patch:'@@ -1 +1 @@\n+List<String> names = List.of("Ada");'}]};
 if(endpoint.endsWith(B))return {files:[{filename:'src/App.tsx',patch:'@@ -1 +1 @@\n+const [n, setN] = useState(0);'}]};
 throw Error('Unexpected source');
};
test('diff evidence creates thematic explanations and separate exercise solutions',async()=>{
 const book=await generateHistoricalBook(index,read);
 assert.equal(book.lessons.length,2);
 assert.match(book.bookMarkdown,/### Einfach erklärt/);
 assert.match(book.bookMarkdown,/### Technische Vertiefung/);
 assert.match(book.bookMarkdown,/Java: Generics/);
 assert.match(book.bookMarkdown,/React: useState/);
 assert.match(book.bookMarkdown,/docs\.oracle\.com/);
 assert.match(book.bookMarkdown,/github.com\/example\/studio\/commit/);
 assert.doesNotMatch(book.bookMarkdown,/List<String> tiere =/);
 assert.match(book.solutionsMarkdown,/List<String> tiere =/);
 assert.match(book.reportsMarkdown,/nicht\*\* die Absicht/);
});
test('missing diff evidence never creates invented chapters',async()=>{
 const book=await generateHistoricalBook(index,async()=>({files:[{filename:'README.md',patch:'@@\n+hello'}]}));
 assert.equal(book.lessons.length,0);
 assert.match(book.bookMarkdown,/kein Kapitel erfunden/);
});
test('repeated imports are idempotent snapshots and never modify source repositories',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-learning-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const book=await generateHistoricalBook(index,read);
 const first=saveHistoricalBook(root,book);
 const again=saveHistoricalBook(root,book);
 assert.equal(first.directory,again.directory);
 assert.equal(loadHistoricalBook(root,index.repository)?.bookMarkdown,book.bookMarkdown);
 assert.equal(fs.readFileSync(path.join(first.directory,'solutions.md'),'utf8'),book.solutionsMarkdown);
 assert.equal(fs.existsSync(path.join(root,'learning-library','example__studio',A,'reports.md')),true);
 assert.throws(()=>saveHistoricalBook(root,{...book,bookMarkdown:'modified'}),/refusing overwrite/);
});
test('HTML export is printable, escapes source text and keeps HTTPS links',()=>{
 const html=markdownToPrintHtml('# Titel\n\n## Thema\n\nText <script>x</script>\n\n~~~typescript\nconst x = "<b>";\n~~~\n\n- [Doc](https://example.org/help)');
 assert.match(html,/<h1>Titel<\/h1>/);
 assert.match(html,/&lt;script&gt;/);
 assert.doesNotMatch(html,/<script>/);
 assert.match(html,/<pre><code>const x = &quot;&lt;b&gt;&quot;;/);
 assert.match(html,/href="https:\/\/example.org\/help"/);
 assert.match(html,/@page\{size:A4/);
 assert.throws(()=>markdownToPrintHtml('~~~typescript\nconst x = 1;'),/Unclosed/);
});
test('public repository patches are bounded and never executed',async()=>{
 const evil=async()=>({files:[{filename:'src/A.ts',patch:'@@\n+<script>steal()</script>'}]});
 const book=await generateHistoricalBook(index,evil);
 assert.equal(book.lessons.length,0);
});
