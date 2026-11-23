import test from 'node:test';
import assert from 'node:assert/strict';
import {LEARNING_QUESTIONS,LEARNING_STACKS,evaluateLearningProfile,validateLearningProfile,learningInstructions} from '../src/core/learning-assessment.ts';
test('assessment covers different programming languages and basic concepts',()=>{
 assert.deepEqual([...new Set(LEARNING_QUESTIONS.map(q=>q.stack))].sort(),[...LEARNING_STACKS].sort());
 assert.equal(new Set(LEARNING_QUESTIONS.map(q=>q.id)).size,LEARNING_QUESTIONS.length);
 for(const q of LEARNING_QUESTIONS){
  assert.equal(q.answers.length,3);
  assert.ok(q.correct>=0&&q.correct<q.answers.length);
  assert.ok(q.explanation.length>15);
 }
});
test('grade per stack independently and produce safe language instructions',()=>{
 const answers=LEARNING_QUESTIONS.map(q=>({questionId:q.id,choice:q.stack==='java'?q.correct:(q.correct+1)%3}));
 const profile=evaluateLearningProfile(answers,1700000000000);
 assert.equal(profile.levels.java,'intermediate');
 assert.equal(profile.levels.react,'beginner');
 assert.equal(profile.scores.java,100);
 assert.equal(profile.scores.react,0);
 assert.equal(validateLearningProfile(profile),profile);
 assert.match(learningInstructions(profile),/Spring Boot/);
 assert.match(learningInstructions(profile),/Anfänger/);
});
test('invalid and partial answers fail closed',()=>{
 assert.throws(()=>evaluateLearningProfile([],1700000000000),/Incomplete/);
 const answers=LEARNING_QUESTIONS.map(q=>({questionId:q.id,choice:q.correct}));
 assert.throws(()=>evaluateLearningProfile([...answers,answers[0]],1),/Invalid/);
 assert.throws(()=>evaluateLearningProfile(answers.map((x,i)=>i===0?{...x,choice:100}:x),1),/Invalid/);
 assert.throws(()=>evaluateLearningProfile(answers,-1),/Invalid/);
 assert.throws(()=>validateLearningProfile({...evaluateLearningProfile(answers,1),levels:{java:'expert'}}),/Invalid/);
});
