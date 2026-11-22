import test from 'node:test';
import assert from 'node:assert/strict';
import {explainIssueHold} from '../src/renderer/issue-hold-explanation.ts';

test('blocked GitHub status has a prominent explanation without invented cause',()=>{
 const item=explainIssueHold(['status:blocked','priority:p1'],'Issue status is blocked');
 assert.equal(item?.severity,'blocked');
 assert.match(item?.why??'',/keinen konkreten technischen Fehlergrund/);
 assert.match(item?.next??'',/status:ready/);
});
test('needs triage and manual exclusions explain safe next action',()=>{
 assert.equal(explainIssueHold(['status:triage'],'')?.severity,'waiting');
 assert.equal(explainIssueHold(['status:ready','manual-only'],'')?.severity,'blocked');
 assert.equal(explainIssueHold(['status:ready','priority:p1'],undefined),null);
});
test('ambiguous labels never imply readiness',()=>{
 const x=explainIssueHold(['status:ready','status:review','priority:p1'],
   'Exactly one recognized workflow status is required');
 assert.equal(x?.severity,'waiting');
});

test('documented dependencies from GitHub issue body are shown as evidence',()=>{
 const body='## Ziel\nEine Funktion\n\n## Abhängigkeit\nEchte Adapter und Live-Events; erst nach Sicherheitsprüfung.\n\n## Tests\nKeine';
 const reason=explainIssueHold(['status:blocked','priority:p1'],'',body);
 assert.match(reason?.why??'',/Echte Adapter und Live-Events/);
 assert.doesNotMatch(reason?.why??'',/## Tests/);
});
