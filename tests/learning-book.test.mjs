import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLearningBook,upsertLearningEntry} from '../src/core/learning-book.ts';

const SHA='0123456789abcdef0123456789abcdef01234567';
const example=(key='java-generics')=>({
  key,topic:'java-type-system',topicTitle:'Java: Typsicherheit',
  title:'Generics mit List<String> verstehen',repo:'example/java-app',issueNumber:5,commitSha:SHA,
  changedPaths:['src/main/java/example/EventService.java'],
  plainExplanation:'Eine Liste wie ein sortierter Kasten: nur Texte dürfen hinein.',
  technicalExplanation:'List<String> ist ein parametrisierter Typ. Der Compiler prüft Einfügungen.',
  whatChanged:'Eine untypisierte Collection wurde durch List<String> ersetzt.',
  why:'Damit ungültige Einträge bereits bei der Kompilierung auffallen.',
  rationaleEvidence:'reconstructed',
  manualSteps:['Java-Datei öffnen','List<String> deklarieren und mit javac prüfen'],
  snippets:[{language:'java',code:'List<String> names = new ArrayList<>();',
    explanation:'Der Typparameter String schränkt zulässige Elemente ein.'}],
  exercises:[{question:'Erstelle eine Liste mit zwei Vornamen.',
    solution:'List<String> names = List.of("Ada", "Tom");',
    explanation:'List.of gibt hier eine unveränderliche Liste mit zwei Strings zurück.'}],
  references:[{title:'Java List<E> API',url:'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/List.html',verified:true}],
  qualityVerified:true,
});

test('groups lessons by topics independent of original commit order',()=>{
 const a=example();
 const b={...example('java-streams'),title:'Streams verstehen',issueNumber:6,
  topic:'java-collections',topicTitle:'Java: Collections'};
 const left=buildLearningBook([a,b]);
 const right=buildLearningBook([b,a]);
 assert.deepEqual(left,right);
 assert.deepEqual(left.topics,['java-collections','java-type-system']);
 assert.equal(left.lessonCount,2);
});
test('solutions are in a separate Markdown file and explanation remains in main book',()=>{
 const result=buildLearningBook([example()]);
 assert.match(result.textbookMarkdown,/#### Einfach erklärt/);
 assert.match(result.textbookMarkdown,/#### Technische Vertiefung/);
 assert.match(result.textbookMarkdown,/#### So setzt du es selbst um/);
 assert.match(result.textbookMarkdown,/Erstelle eine Liste mit zwei Vornamen/);
 assert.doesNotMatch(result.textbookMarkdown,/List\.of\("Ada", "Tom"\)/);
 assert.match(result.solutionsMarkdown,/List\.of\("Ada", "Tom"\)/);
 assert.match(result.reportsMarkdown,/didaktische Rekonstruktion/);
 assert.match(result.reportsMarkdown,/0123456789ab/);
});
test('same lesson key may be updated but cannot overwrite unrelated evidence',()=>{
 const first=example();
 const revised={...first,plainExplanation:'Überarbeitetes Kapitel'};
 const updated=upsertLearningEntry([first],revised);
 assert.equal(updated.length,1);
 assert.match(buildLearningBook(updated).textbookMarkdown,/Überarbeitetes Kapitel/);
 assert.throws(()=>upsertLearningEntry([first],{...first,repo:'other/owner'}),/collision/);
 assert.throws(()=>buildLearningBook([first,first]),/Duplicate/);
});
test('no unverified code or missing commit evidence may be published as verified',()=>{
 assert.throws(()=>buildLearningBook([{...example(),qualityVerified:false}]),/Unverified/);
 assert.throws(()=>buildLearningBook([{...example(),commitSha:'unknown'}]),/Unverified/);
 assert.throws(()=>buildLearningBook([{...example(),changedPaths:['../secret']}]),/Invalid evidence/);
});
test('unverified external documentation is visibly marked, never silently asserted',()=>{
 const candidate={...example(),references:[{title:'Beispiel',url:'https://example.org/guide',verified:false}]};
 const output=buildLearningBook([candidate]).textbookMarkdown;
 assert.match(output,/Link noch nicht geprüft/);
 assert.throws(()=>buildLearningBook([{...example(),
  references:[{title:'unsicher',url:'javascript:alert(1)',verified:true}]}]),/Invalid reference URL/);
});
test('malicious Markdown headings and code fences cannot insert a new chapter',()=>{
 const candidate={...example(),title:'<script>steal()</script>',
  snippets:[{language:'ts',code:'const x = `hello`;\n```\n# injected',explanation:'Beispiel'}]};
 const result=buildLearningBook([candidate]);
 assert.doesNotMatch(result.textbookMarkdown,/<script>/);
 assert.match(result.textbookMarkdown,/&lt;script&gt;/);
 assert.match(result.textbookMarkdown,/````ts/);
 assert.equal(result.textbookMarkdown.match(/^## /gm)?.length,2);
});
test('different topic titles for the same slug are rejected instead of silently merged',()=>{
 const b={...example('java-more'),topicTitle:'Anderer Titel',issueNumber:6};
 assert.throws(()=>buildLearningBook([example(),b]),/Conflicting topic/);
});