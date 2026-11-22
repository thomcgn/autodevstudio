import test from 'node:test';
import assert from 'node:assert/strict';
import {auditCodeSource} from '../src/core/clean-code-audit.ts';

test('clean code has no superficial violations; no false certainty about SOLID',()=>{
 const r=auditCodeSource('src/greet.ts',
   'export function greet(name: string): string {\n  return `Hello ${name}`;\n}\n');
 assert.equal(r.passed,true);
 assert.deepEqual(r.checked,['clean-code','solid','dry']);
 assert.deepEqual(r.findings,[]);
});
test('ban explicit any, suppression and oversized lines with concrete line references',()=>{
 const r=auditCodeSource('src/unsafe.ts',[
  '// @ts-ignore',
  'export const broken: any = 1;',
  'export const excessivelyLong = "'+'a'.repeat(170)+'";',
 ].join('\n'));
 assert.equal(r.passed,false);
 assert.ok(r.findings.some(x=>x.rule==='unsafe-suppression'&&x.line===1));
 assert.ok(r.findings.some(x=>x.rule==='explicit-any'&&x.line===2));
 assert.ok(r.findings.some(x=>x.rule==='long-line'&&x.line===3));
});
test('single responsibility proxy flags a genuinely oversized method',()=>{
 const body=Array.from({length:90},(_,i)=>'    const value'+i+' = '+i+';').join('\n');
 const r=auditCodeSource('src/large.ts',
  'export function large() {\n'+body+'\n}\n');
 assert.ok(r.findings.some(f=>f.rule==='oversized-function'&&f.principle==='solid'));
});
test('repeated six-line substantive blocks are reported as DRY review candidates',()=>{
 const group=Array.from({length:6},(_,i)=>'const repeatedValue'+i+' = input'+i+';');
 const source=[...group,'const separator = 1;',...group].join('\n');
 const r=auditCodeSource('src/repeated.ts',source);
 assert.ok(r.findings.some(f=>f.rule==='repeated-six-line-block'&&f.principle==='dry'));
});
test('syntax errors are not silently treated as maintainable code',()=>{
 const r=auditCodeSource('src/broken.ts','export function foo( {\n');
 assert.ok(r.findings.some(f=>f.rule==='syntax'));
});
test('oversize and unsupported source fail closed',()=>{
 assert.throws(()=>auditCodeSource('secrets.env','hello'),/Unsupported/);
 assert.throws(()=>auditCodeSource('src/huge.ts','x'.repeat(140000)),/too large/);
});
