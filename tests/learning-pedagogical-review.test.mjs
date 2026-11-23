import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewBeginnerLesson} from '../src/core/learning-pedagogical-review.ts';
import {requestValidatedLesson} from '../src/core/deep-learning-analysis.ts';
const base={
 title:'Wie verwaltet die Anwendung Bestände?',
 problem:'In einem Lager stehen Getränkeflaschen. Bei jedem Verkauf müssen wir herausfinden, wie viel noch übrig bleibt.',
 walkthrough:'Zuerst ermittelt das Programm die Anzahl vorhandener Flaschen. Danach verringert es den Bestand.',
 implementation:'Eine Konfiguration definiert Standardgrößen, eine Datenklasse speichert zusätzliche Angaben.',
 reasoning:'So ist die Bestandsverwaltung von anderen Aufgaben getrennt.',
 alternatives:'Man könnte die Standardwerte direkt in den Programmcode schreiben.',
 tradeoffs:'Daten müssen sorgfältig geprüft werden.',
 codeExample:'int remaining = 20 - 1;',
 exercise:'Was passiert, wenn zwei Flaschen verkauft werden?',
 solution:'Es bleiben 18 Flaschen.',
 uncertainty:'Welche Entscheidungen die Entwickler trafen, ist unbekannt.',
};
test('German everyday explanation passes beginner review',()=>{
 assert.deepEqual(reviewBeginnerLesson(base),{passed:true,findings:[]});
});
test('raw English architecture jargon fails educational quality gate',()=>{
 const result=reviewBeginnerLesson({
  ...base,
  problem:'Inventory defaults and consumption metadata configuration requires persistent storage and the settings are linked between tables.',
  walkthrough:'The implementation uses JPA with an EnumMap and a foreign key for metadata.',
 });
 assert.equal(result.passed,false);
 assert.ok(result.findings.some(x=>x.includes('englische')));
 assert.ok(result.findings.some(x=>x.includes('Fachbegriffe')));
});
test('invalid beginner explanation gets a grounded model revision before acceptance',async()=>{
 let calls=0;
 const model=async(_system,prompt)=>{
  calls++;
  if(calls===1)return JSON.stringify({...base,problem:'The metadata configuration defaults require persistent storage linked between records.'});
  assert.match(prompt,/ÜBERARBEITUNG ERFORDERLICH/);
  return JSON.stringify(base);
 };
 const lesson=await requestValidatedLesson(model,'system','verified source',new AbortController().signal,undefined,true);
 assert.equal(calls,2);
 assert.equal(lesson.problem,base.problem);
});
test('two rejected beginner completions fail instead of silently becoming chapters',async()=>{
 const invalid={...base,walkthrough:'The metadata configuration requires persistent storage linked between tables.'};
 await assert.rejects(requestValidatedLesson(async()=>JSON.stringify(invalid),'system','verified source',
  new AbortController().signal,undefined,true),/Didactic quality gate failed/);
});
