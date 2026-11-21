import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runIsolatedQualityGates } from './isolated-quality-gates.ts';
import { runIsolatedNpmScript } from './isolated-quality.ts';
import type { QualityScriptRunner } from './quality-gates.ts';

export interface QualityScriptProbeResult {
  passed: boolean;
  reason: 'passed' | 'unsupported-platform' | 'script-failed' |
    'missing-expected-write' | 'git-metadata-modified';
}

export type IsolatedScriptProbeRunner = QualityScriptRunner;

// This script is an intentionally fixed local test fixture, not sourced from
// a GitHub issue or the user's selected repository.
const PROBE_SCRIPT = [
  'const fs=require("node:fs");',
  'fs.writeFileSync("/project/probe-canary.txt","written");',
  'try{fs.writeFileSync("/project/.git/write-forbidden.txt","bad");process.exit(41)}',
  'catch(e){if(e.code!=="EROFS"&&e.code!=="EACCES")process.exit(42)}',
].join('');

/** Actual isolated npm run smoke test on a disposable project.
 * No selected user project is mounted. A sandbox must allow writing to the
 * fixture worktree but deny writing to its nested .git mount.
 *
 * A successful result does not authorize real Quality-Gates or any Kilo agent.
 */
export async function probeIsolatedQualityScript(
  runner: IsolatedScriptProbeRunner = runIsolatedNpmScript,
): Promise<QualityScriptProbeResult> {
  if (process.platform !== 'linux') return {passed:false,reason:'unsupported-platform'};
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'autodev-script-probe-'));
  try {
    fs.mkdirSync(path.join(temp,'.git'));
    fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({
      name:'autodev-isolated-sandbox-probe',version:'1.0.0',private:true,
      scripts:{'studio-probe':'node -e '+JSON.stringify(PROBE_SCRIPT)},
    }),{mode:0o600});
    const result=await runIsolatedQualityGates({
      cwd:temp,scripts:['studio-probe'],timeoutMs:10000,
    },runner);
    if(!result.passed) return {passed:false,reason:'script-failed'};
    if(!fs.existsSync(path.join(temp,'probe-canary.txt')) ||
       fs.readFileSync(path.join(temp,'probe-canary.txt'),'utf8')!=='written')
      return {passed:false,reason:'missing-expected-write'};
    if(fs.existsSync(path.join(temp,'.git','write-forbidden.txt')))
      return {passed:false,reason:'git-metadata-modified'};
    return {passed:true,reason:'passed'};
  } catch {
    return {passed:false,reason:'script-failed'};
  } finally {
    fs.rmSync(temp,{recursive:true,force:true});
  }
}
