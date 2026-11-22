import test from 'node:test';
import assert from 'node:assert/strict';
import {findBuildWarnings} from '../scripts/strict-check.mjs';

test('zero-warning gate blocks warnings including deprecations and package installers',()=>{
 for(const input of [
  'npm warn deprecated glob@7: no longer supported',
  '(node:123) [DEP0040] DeprecationWarning: punycode is deprecated',
  '(node:234) [MODULE_TYPELESS_PACKAGE_JSON] Warning: module type is unspecified',
  '[vite] warning: dynamic import cannot be analyzed',
  'WARNING: build uses deprecated API',
  '(!) Some chunks are larger than 500 kB after minification',
  'deprecated: do not use this API',
 ])assert.ok(findBuildWarnings(input).length>0,input);
});
test('zero-warning gate does not mistake clean TypeScript and passing tests for diagnostics',()=>{
 assert.deepEqual(findBuildWarnings('Found 0 errors.\n# tests 481\n# pass 481\n# fail 0\n'),[]);
 assert.deepEqual(findBuildWarnings('npm ci succeeded without diagnostics\n'),[]);
});
test('zero-warning gate recognizes colored warning output',()=>{
 assert.equal(findBuildWarnings('\x1b[33mnpm warn deprecated tar@6\x1b[0m').length,1);
});
