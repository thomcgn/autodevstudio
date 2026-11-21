import test from 'node:test';
import assert from 'node:assert/strict';
import {probeLocalReviewModel} from '../src/core/local-review-model-probe.ts';
const answer=(content,model='qwen2.5-coder:3b')=>new Response(JSON.stringify({
  model,done:true,message:{role:'assistant',content},
}),{status:200});
const raw=(value)=>'AUTODEV_JSON_BEGIN\n'+JSON.stringify(value)+'\nAUTODEV_JSON_END';
test('local smoke uses only synthetic fixture and returns no model output',async()=>{
  let calls=0;
  const result=await probeLocalReviewModel('qwen2.5-coder:3b',async(url,options)=>{
    calls++;
    assert.equal(url,'http://127.0.0.1:11434/api/chat');
    const request=JSON.parse(options.body);
    assert.match(request.messages[1].content,/Synthetic validation example/);
    assert.match(request.messages[1].content,/diff --git a\/fixture.ts/);
    assert.equal(request.messages[1].content.includes('/home/'),false);
    assert.equal(request.messages[1].content.includes('autodev-studio'),false);
    assert.equal(request.stream,false);
    assert.equal(request.tools,undefined);
    return answer(raw({verdict:'FAIL',blockers:1,feedback:'Missing tests'}));
  });
  if(process.platform==='linux'){
    assert.deepEqual(result,{passed:true,reason:'passed'});
    assert.equal(calls,1);
  }else{
    assert.equal(result.reason,'unsupported-platform');
    assert.equal(calls,0);
  }
});
test('malformed model answer cannot masquerade as successful protocol check',async()=>{
  if(process.platform!=='linux')return;
  const result=await probeLocalReviewModel('qwen2.5-coder:3b',async()=>answer('random text'));
  assert.deepEqual(result,{passed:false,reason:'invalid-verdict'});
});
test('missing model and connection failures are sanitized',async()=>{
  if(process.platform!=='linux')return;
  const missing=await probeLocalReviewModel('qwen2.5-coder:3b',
    async()=>new Response('SECRET',{status:404}));
  assert.deepEqual(missing,{passed:false,reason:'model-unavailable'});
  const failed=await probeLocalReviewModel('qwen2.5-coder:3b',
    async()=>{throw new Error('Home secrets /home/tom');});
  assert.deepEqual(failed,{passed:false,reason:'request-failed'});
  assert.ok(!JSON.stringify(failed).includes('/home'));
});
