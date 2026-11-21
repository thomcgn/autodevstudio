import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalOllamaReviewerChannel} from '../src/core/local-ollama-reviewer.ts';
const req={protocol:'autodev-review-gateway-v1',kind:'review',
  requestId:'a'.repeat(32),issueNumber:13,fingerprint:'b'.repeat(64),
  prompt:'Review these changes without tools'};
const wrap=(message,done=true)=>new Response(JSON.stringify({model:'qwen2.5-coder:3b',done,message}),{status:200});
const ok={role:'assistant',content:'AUTODEV_JSON_BEGIN\n{"verdict":"FAIL","blockers":1,"feedback":"Missing tests"}\nAUTODEV_JSON_END'};
const cfg={model:'qwen2.5-coder:3b',timeoutMs:150000,maxCompletionTokens:512};
test('sends fixed loopback-only tool-free request and exact bound response',async()=>{
  let count=0;
  const channel=createLocalOllamaReviewerChannel(cfg,async(url,init)=>{
    count++;
    assert.equal(url,'http://127.0.0.1:11434/api/chat');
    assert.equal(init.redirect,'error');
    const body=JSON.parse(init.body);
    assert.equal(body.model,'qwen2.5-coder:3b');
    assert.equal(body.stream,false);assert.equal(body.think,false);
    assert.equal(body.keep_alive,0);
    assert.equal(body.options.num_predict,512);
    assert.deepEqual(body.messages.map(x=>x.role),['system','user']);
    assert.equal(body.messages[1].content,req.prompt);
    assert.equal(Object.hasOwn(body,'tools'),false);
    return wrap(ok);
  });
  const result=await channel(req);
  assert.equal(count,1);
  assert.equal(result.fingerprint,req.fingerprint);
  assert.equal(result.requestId,req.requestId);
  assert.equal(result.output,ok.content);
});
test('tool calls, unfinished output and oversized bodies fail closed',async()=>{
  for(const [message,done] of [
    [{...ok,tool_calls:[]},true],
    [ok,false],
    [{role:'assistant',content:''},true],
    [{role:'assistant',content:'x'.repeat(64000)},true],
  ]){
    const channel=createLocalOllamaReviewerChannel(cfg,async()=>wrap(message,done));
    await assert.rejects(channel(req),/Ollama/);
  }
});
test('rejects malformed model and untrusted extra request fields before fetch',async()=>{
  assert.throws(()=>createLocalOllamaReviewerChannel({...cfg,model:'http://attacker'},async()=>wrap(ok)),/configuration/);
  assert.throws(()=>createLocalOllamaReviewerChannel({...cfg,model:'../../secret'},async()=>wrap(ok)),/configuration/);
  let n=0;
  const channel=createLocalOllamaReviewerChannel(cfg,async()=>{n++;return wrap(ok);});
  for(const patch of [{url:'http://attacker'},{requestId:'bad'},{prompt:'x'.repeat(32769)}])
    await assert.rejects(channel({...req,...patch}),/envelope/);
  assert.equal(n,0);
});
test('abort avoids network, HTTP error message excludes response contents',async()=>{
  let count=0;
  const channel=createLocalOllamaReviewerChannel(cfg,async()=>{count++;return wrap(ok);});
  const aborted=new AbortController();aborted.abort();
  await assert.rejects(channel(req,aborted.signal),/cancelled/);
  assert.equal(count,0);
  const bad=createLocalOllamaReviewerChannel(cfg,async()=>new Response('secret',{status:503}));
  await assert.rejects(bad(req),e=>e.message.includes('HTTP 503')&&!e.message.includes('secret'));
});

test('different local model identity cannot impersonate configured reviewer',async()=>{
  const channel=createLocalOllamaReviewerChannel(cfg,async()=>
    new Response(JSON.stringify({model:'other-model:latest',done:true,message:ok}),{status:200}));
  await assert.rejects(channel(req),/unfinished/);
});
