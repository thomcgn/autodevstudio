import test from 'node:test';
import assert from 'node:assert/strict';
import { createNoToolsReviewerPolicy, assertNoToolsReviewerPolicy } from '../src/core/kilo-reviewer-policy.ts';
test('generates model-only Kilo config with tools denied at both levels',()=>{
  const result=createNoToolsReviewerPolicy('kilocode/model:free');
  assert.equal(result.agent,'autodev-reviewer');
  assert.doesNotThrow(()=>assertNoToolsReviewerPolicy(result.configContent));
  const config=JSON.parse(result.configContent);
  assert.equal(config.permission['*'],'deny');
  assert.equal(config.agent['autodev-reviewer'].permission['*'],'deny');
  assert.equal(config.agent['autodev-reviewer'].permission.bash,'deny');
  assert.equal(config.agent['autodev-reviewer'].permission.edit,'deny');
  assert.equal(config.agent['autodev-reviewer'].permission.task,'deny');
  assert.equal(config.agent['autodev-reviewer'].permission.external_directory,'deny');
  assert.equal(config.lsp,false);
  assert.equal(config.formatter,false);
});
test('rejects suspicious model names and modified tool permissions',()=>{
  for(const bad of ['','my model','foo\nbar','../../x','provider/$USER','provider/evil;rm']){
    assert.throws(()=>createNoToolsReviewerPolicy(bad),/Invalid reviewer model/);
  }
  const policy=JSON.parse(createNoToolsReviewerPolicy('p/m').configContent);
  policy.agent['autodev-reviewer'].permission.read='allow';
  assert.throws(()=>assertNoToolsReviewerPolicy(JSON.stringify(policy)),/does not deny/);
  policy.agent['autodev-reviewer'].permission.read='deny';
  policy.permission.bash='ask';
  assert.throws(()=>assertNoToolsReviewerPolicy(JSON.stringify(policy)),/does not deny/);
});
test('a policy fragment is not executable and contains no credentials',()=>{
  const result=createNoToolsReviewerPolicy('provider/reviewer-model');
  assert.ok(!result.configContent.includes('apiKey'));
  assert.ok(!result.configContent.includes('secret'));
  assert.ok(!result.configContent.includes('exec'));
  assert.equal(typeof result.configContent,'string');
});
