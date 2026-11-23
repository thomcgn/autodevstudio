import test from 'node:test';
import assert from 'node:assert/strict';
import {formatLearningDuration,formatRemainingEta} from '../src/renderer/learning-time.ts';

test('durations render as HH:MM:SS rather than raw seconds',()=>{
 assert.equal(formatLearningDuration(0),'00:00:00');
 assert.equal(formatLearningDuration(59),'00:00:59');
 assert.equal(formatLearningDuration(60),'00:01:00');
 assert.equal(formatLearningDuration(3372),'00:56:12');
 assert.equal(formatLearningDuration(3600),'01:00:00');
 assert.equal(formatLearningDuration(3661),'01:01:01');
 assert.equal(formatLearningDuration(360000),'100:00:00');
});
test('remaining ETA updates every second without a new backend progress event',()=>{
 const receivedAt=1700000000000;
 assert.equal(formatRemainingEta(3372,receivedAt,receivedAt),'00:56:12');
 assert.equal(formatRemainingEta(3372,receivedAt,receivedAt+12000),'00:56:00');
 assert.equal(formatRemainingEta(3,receivedAt,receivedAt+10000),'00:00:00');
});
test('missing or invalid ETA is not falsely shown as zero',()=>{
 assert.equal(formatRemainingEta(null,1000,2000),'noch nicht messbar');
 assert.equal(formatRemainingEta(undefined,1000,2000),'noch nicht messbar');
 assert.equal(formatRemainingEta(20,0,2000),'noch nicht messbar');
 assert.equal(formatRemainingEta(Infinity,1000,2000),'noch nicht messbar');
});
