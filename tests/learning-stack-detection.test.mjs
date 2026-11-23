import test from 'node:test';
import assert from 'node:assert/strict';
import {detectRepositoryLearningStacks} from '../src/core/learning-stack-detection.ts';
import {LEARNING_QUESTIONS,evaluateLearningProfile} from '../src/core/learning-assessment.ts';
const head='a'.repeat(40),tree='b'.repeat(40);
test('repository tree selects Java, Spring, TypeScript, React and SQL questions',async()=>{
 const read=async endpoint=>{
  if(endpoint.endsWith('/git/commits/'+head))return {tree:{sha:tree}};
  if(endpoint.endsWith('/git/trees/'+tree+'?recursive=1'))return {
   truncated:false,tree:[
    {path:'backend/pom.xml'},{path:'backend/src/main/java/demo/Controller.java'},
    {path:'backend/src/main/resources/db/migration/V1.sql'},
    {path:'frontend/app/page.tsx'}, {path:'frontend/package.json'},
   ]};
  throw Error('unexpected endpoint');
 };
 const stacks=await detectRepositoryLearningStacks('example/project',head,read);
 assert.deepEqual(stacks,['fundamentals','java','sql','typescript','react','spring']);
 const answers=LEARNING_QUESTIONS.filter(q=>stacks.includes(q.stack))
  .map(q=>({questionId:q.id,choice:q.correct}));
 const profile=evaluateLearningProfile(answers,1,stacks);
 assert.equal(profile.levels.sql,'intermediate');
});
test('single language repo does not demand unrelated questions',async()=>{
 const read=async endpoint=>endpoint.endsWith('/git/commits/'+head)
  ?{tree:{sha:tree}}:{truncated:false,tree:[{path:'src/Main.java'}]};
 const stacks=await detectRepositoryLearningStacks('example/project',head,read);
 assert.deepEqual(stacks,['fundamentals','java']);
 const answers=LEARNING_QUESTIONS.filter(q=>stacks.includes(q.stack))
  .map(q=>({questionId:q.id,choice:q.correct}));
 const profile=evaluateLearningProfile(answers,1,stacks);
 assert.equal(profile.levels.java,'intermediate');
 assert.equal(profile.levels.react,'beginner');
});
test('invalid revision and incomplete repository tree never report a stack',async()=>{
 await assert.rejects(detectRepositoryLearningStacks('example/project','main',async()=>({})),/Invalid/);
 await assert.rejects(detectRepositoryLearningStacks('example/project',head,async endpoint=>
  endpoint.endsWith('/git/commits/'+head)?{tree:{sha:tree}}:{truncated:true,tree:[]}),/Incomplete/);
});
