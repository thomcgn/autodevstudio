import test from 'node:test';
import assert from 'node:assert/strict';
import {isLearningCancellation} from '../src/renderer/learning-cancellation.ts';

test('user-cancelled Electron IPC is not an error',()=>{
 assert.equal(isLearningCancellation(new Error("Error invoking remote method 'learning:deep-generate': Error: Learning analysis cancelled")),true);
 assert.equal(isLearningCancellation(new Error('Learning analysis cancelled')),true);
});
test('real analysis errors remain errors',()=>{
 assert.equal(isLearningCancellation(new Error('Ollama failed to generate valid lesson')),false);
 assert.equal(isLearningCancellation(new Error('Learning analysis cancelled by network issue')),false);
 assert.equal(isLearningCancellation(new Error("Error invoking remote method 'learning:deep-generate': Error: Ollama timeout")),false);
});
