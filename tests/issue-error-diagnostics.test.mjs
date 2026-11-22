import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyIssueFailure,formatIssueFailure} from '../src/renderer/issue-error-diagnostics.ts';

test('classifies safety blockers without exposing secret-bearing raw messages',()=>{
 const cases=[
  ['Branch protection required: GitHub 403','branch-protection'],
  ['Checkpoint revision conflict','checkpoint'],
  ['Kilo quota 429','quota'],
  ['Reviewer transport unavailable','provider'],
  ['Quality test failed','quality'],
  ['Git origin is invalid repository','repository'],
  ['Another Studio run is active','conflict'],
  ['Automation cancelled','cancelled'],
  ['push failed after commit','publish'],
 ];
 for(const [message,code] of cases)
  assert.equal(classifyIssueFailure(new Error(message)).code,code);
});
test('provider path, token and arbitrary error details are not rendered',()=>{
 const raw='network error token=secret123 at /home/user/private/project';
 const rendered=formatIssueFailure(new Error(raw));
 assert.equal(rendered.includes('secret123'),false);
 assert.equal(rendered.includes('/home/user/'),false);
 assert.match(rendered,/publish/);
});
test('unknown errors fail closed and produce helpful fallback',()=>{
 const result=classifyIssueFailure({secret:'do-not-display'});
 assert.equal(result.code,'unknown');
 assert.equal(result.retry,'inspect-first');
});
