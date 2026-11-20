import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan, parseReview, createKiloWorkflowAdapters } from '../src/core/kilo-workflow-adapters.ts';
import { orchestrateIssue } from '../src/core/orchestrator.ts';

const wrap = data => 'provider preamble\nAUTODEV_JSON_BEGIN\n' + JSON.stringify(data) + '\nAUTODEV_JSON_END\n';

test('accepts strict structured planner and independent reviewer results', () => {
  const plan = parsePlan(wrap({ summary: 'Implement', steps: ['Code', 'Test'] }));
  assert.deepEqual(plan.steps, ['Code', 'Test']);
  assert.deepEqual(parseReview(wrap({ verdict: 'PASS', blockers: 0, summary: 'Verified' })),
    { verdict: 'PASS', blockers: 0, summary: 'Verified' });
  assert.deepEqual(parseReview(wrap({ verdict: 'FAIL', blockers: 2, feedback: 'Fix tests' })),
    { verdict: 'FAIL', blockers: 2, feedback: 'Fix tests' });
});

test('review output fails closed for inconsistent PASS or malformed response', () => {
  assert.throws(() => parseReview('PASS, looks good'), /delimited/);
  assert.throws(() => parseReview(wrap({ verdict: 'PASS', blockers: 1, summary: 'Looks okay' })), /zero blockers/);
  assert.throws(() => parseReview(wrap({ verdict: 'FAIL', blockers: 0, feedback: 'Broken' })), /blockers/);
  assert.throws(() => parseReview(wrap({ verdict: 'FAIL', blockers: 1 })), /feedback/);
  assert.throws(() => parsePlan(wrap({ summary: '', steps: [] })), /planner/);
});

test('reviewer cannot share builder or planner agent identity', () => {
  const settings = {
    cwd: '/tmp', planner: { agent: 'planner', model: 'x' },
    builder: { agent: 'builder', model: 'x' }, reviewer: { agent: 'builder', model: 'x' },
    inactivityTimeoutMs: 30000,
    onSessionId: ()=>{},
    qualityGate: async ()=>({passed:true,summary:'ok'}),
    publish: async ()=>{},
  };
  assert.throws(() => createKiloWorkflowAdapters(settings), /separately configured/);
});

test('adapter routes planner/builder/reviewer separately and feeds FAIL back to builder', async () => {
  const invocations = [];
  const sessions = [];
  let reviews = 0, publications = 0, checked = 0;
  const adapters = createKiloWorkflowAdapters({
    cwd: '/example/repo',
    planner: { agent: 'planner-a', model: 'provider/model:free' },
    builder: { agent: 'builder-b', model: 'provider/model:free' },
    reviewer: { agent: 'reviewer-c', model: 'provider/model:free' },
    inactivityTimeoutMs: 30000,
    onSessionId: (role,id)=>sessions.push([role,id]),
    qualityGate: async ()=>{checked++;return {passed:true,summary:'tests pass'};},
    publish: async ()=>{publications++;},
    invoke: async invocation=>{
      invocations.push(invocation);
      invocation.onSessionId(invocation.role + '12345');
      if (invocation.role === 'planner')
        return { output: wrap({summary:'The plan',steps:['Implement change']}), sessionId:'plan12345',elapsedMs:100 };
      if (invocation.role === 'builder')
        return { output:'Builder reports changes; no commits made',sessionId:'build12345',elapsedMs:100 };
      reviews++;
      return { output: reviews===1
        ? wrap({verdict:'FAIL',blockers:1,feedback:'Fix missing test'})
        : wrap({verdict:'PASS',blockers:0,summary:'Confirmed fixed'}),
        sessionId:'review12345',elapsedMs:100 };
    },
  });
  const result = await orchestrateIssue({number:5,title:'Implement agent',body:'A task'}, adapters);
  assert.equal(result.state.stage,'done');
  assert.equal(result.state.fixAttempts,1);
  assert.equal(checked,1);
  assert.equal(publications,1);
  assert.deepEqual(invocations.map(x=>x.role), ['planner','builder','reviewer','builder','reviewer']);
  assert.deepEqual(invocations.map(x=>x.agent), ['planner-a','builder-b','reviewer-c','builder-b','reviewer-c']);
  assert.match(invocations[3].prompt, /Fix missing test/);
  assert.equal(sessions.length,5);
  assert.ok(invocations.every(x=>x.cwd === '/example/repo'));
});

test('inconsistent reviewer PASS never reaches quality or publish', async () => {
  let qualified=0, published=0;
  const adapters=createKiloWorkflowAdapters({
    cwd:'/tmp',planner:{agent:'planner',model:'m'},builder:{agent:'builder',model:'m'},
    reviewer:{agent:'reviewer',model:'m'},inactivityTimeoutMs:1000,
    onSessionId:()=>{},
    qualityGate:async()=>{qualified++;return {passed:true,summary:'ok'};},
    publish:async()=>{published++;},
    invoke:async input=>({
      output:input.role==='planner'?wrap({summary:'plan',steps:['step']}):
        input.role==='builder'?'completed':wrap({verdict:'PASS',blockers:10,summary:'Not really'}),
      sessionId:null,elapsedMs:1,
    }),
  });
  await assert.rejects(orchestrateIssue({number:1,title:'Issue',body:''},adapters),/zero blockers/);
  assert.equal(qualified,0);
  assert.equal(published,0);
});
