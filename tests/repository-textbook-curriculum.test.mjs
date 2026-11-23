import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTextbookCurriculum,renderTextbookCurriculum} from '../src/core/repository-textbook-curriculum.ts';
const sha='a'.repeat(40);
test('extracts Java Streams, Generics, transactions with pinned source line references',()=>{
 const curriculum=buildTextbookCurriculum([{path:'src/Orders.java',content:[
  'public class Orders {',
  '  List<String> names;',
  '  @Transactional',
  '  void order() { names.stream().sorted().toList(); }',
  '}',
 ].join('\n')}]);
 const ids=curriculum.concepts.map(item=>item.id);
 for(const key of ['java-classes','java-generics','java-streams','spring-transactions'])assert.ok(ids.includes(key),key);
 const stream=curriculum.concepts.find(item=>item.id==='java-streams');
 assert.deepEqual(stream.prerequisites,['java-classes','java-generics']);
 assert.equal(stream.evidence[0].line,4);
 const md=renderTextbookCurriculum(curriculum,'example/project',sha);
 assert.match(md,/src\/Orders.java#L4/);
 assert.match(md,/docs.oracle.com\/en\/java\/javase\/21/);
 assert.match(md,/Zuerst lernen/);
});
test('recognizes TypeScript and React separately, avoiding Java false positives',()=>{
 const result=buildTextbookCurriculum([{path:'src/Page.tsx',
  content:'interface Props {name:string}\nconst [value,setValue] = useState<string>("hi");\n// .stream()'}]);
 assert.deepEqual(result.detectedLanguages,['TypeScript']);
 assert.ok(result.concepts.some(c=>c.id==='react-state'));
 assert.ok(result.concepts.some(c=>c.id==='typescript-types'));
 assert.ok(!result.concepts.some(c=>c.id==='java-streams'));
});
test('reports unknown and empty source without inventing a lesson',()=>{
 const result=buildTextbookCurriculum([{path:'README.md',content:'Documentation only'}]);
 assert.equal(result.concepts.length,0);
 assert.match(renderTextbookCurriculum(result,'example/project',sha),/Keine bekannten/);
});
test('rejects unsafe source paths and mismatched revision references',()=>{
 assert.throws(()=>buildTextbookCurriculum([{path:'../.env',content:'secret'}]),/Invalid/);
 assert.throws(()=>buildTextbookCurriculum([{path:'a.ts',content:'ok'},{path:'a.ts',content:'ok'}]),/Invalid/);
 assert.throws(()=>renderTextbookCurriculum(buildTextbookCurriculum([]),'example/project','main'),/Invalid/);
});
test('source snippet is markdown-escaped and cannot inject links or headings',()=>{
 const curriculum=buildTextbookCurriculum([{path:'src/Unsafe.java',
  content:'public class Demo { String text = "[bad](https://evil.example)"; }'}]);
 const md=renderTextbookCurriculum(curriculum,'example/project',sha);
 assert.doesNotMatch(md,/\[bad\]\(https:\/\/evil.example\)/);
 assert.match(md,/src\/Unsafe.java#L1/);
});
