import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {selectSafeQualityScripts} from '../src/core/safe-quality-scripts.ts';

function fixture(scripts){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autodev-safe-quality-'));
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({scripts}));
 return {root,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('trusted policy picks typecheck and deterministic test from repository scripts',()=>{
 const f=fixture({typecheck:'tsc --noEmit',test:'node --test',
   'test:policy':'node --test tests/*.test.mjs'});
 try{assert.deepEqual(selectSafeQualityScripts(f.root),['typecheck','test']);}
 finally{f.close();}
});
test('policy supports Studio test:policy without any UI/model-supplied script',()=>{
 const f=fixture({typecheck:'tsc --noEmit','test:policy':'node --test tests/*.test.mjs',
   attack:'rm -rf /'});
 try{assert.deepEqual(selectSafeQualityScripts(f.root),['typecheck','test:policy']);}
 finally{f.close();}
});
test('missing typecheck or test script prevents quality preflight',()=>{
 for(const scripts of [{test:'node --test'},{typecheck:'tsc'}]){
  const f=fixture(scripts);
  try{assert.throws(()=>selectSafeQualityScripts(f.root),/requires/);}
  finally{f.close();}
 }
});
