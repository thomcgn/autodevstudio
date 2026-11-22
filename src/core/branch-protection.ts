import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parseGitHubRemote} from './git-preflight.ts';

const exec=promisify(execFile);
export type ProtectionCommand=(bin:'git'|'gh',args:readonly string[],cwd:string)=>Promise<string>;
const defaultCommand:ProtectionCommand=async(bin,args,cwd)=>
  (await exec(bin,[...args],{cwd,encoding:'utf8',timeout:20000,maxBuffer:2_000_000,
    windowsHide:true,shell:false,env:{...process.env,GH_PROMPT_DISABLED:'1',GIT_TERMINAL_PROMPT:'0'}})).stdout;

export interface BranchProtectionEvidence {
  repository:string;
  branch:string;
  rulesetId:number;
  requiredChecks:readonly string[];
  verifiedAt:string;
}
type JsonObject=Record<string,unknown>;
const object=(value:unknown):value is JsonObject=>
  value!==null&&typeof value==='object'&&!Array.isArray(value);
const parse=(value:string):unknown=>JSON.parse(value) as unknown;
const fail=(reason:string):never=>{throw new Error('Branch protection required: '+reason);};
const requiredTypes=['pull_request','required_status_checks','deletion','non_fast_forward'] as const;

export function verifyStrictRuleset(
  input:unknown,repository:string,branch:string,
):BranchProtectionEvidence|null {
  if(!object(input)||input.enforcement!=='active'||input.target!=='branch'||
    input.source!==repository||input.source_type!=='Repository'||
    input.current_user_can_bypass!=='never'||!Array.isArray(input.bypass_actors)||
    input.bypass_actors.length!==0||typeof input.id!=='number'||!Number.isSafeInteger(input.id))return null;
  const conditions=input.conditions;
  if(!object(conditions)||!object(conditions.ref_name))return null;
  const refs=conditions.ref_name;
  const included=refs.include;
  const excluded=refs.exclude;
  if(!Array.isArray(included)||!Array.isArray(excluded)||
    excluded.length!==0||
    !included.some(ref=>ref===`refs/heads/${branch}`||ref==='~DEFAULT_BRANCH'))
    return null;
  if(!Array.isArray(input.rules))return null;
  const rules=input.rules.filter(object);
  if(!requiredTypes.every(type=>rules.some(rule=>rule.type===type)))return null;
  const pull=rules.find(rule=>rule.type==='pull_request');
  if(!pull||!object(pull.parameters)||pull.parameters.required_review_thread_resolution!==true)
    return null;
  const checksRule=rules.find(rule=>rule.type==='required_status_checks');
  if(!checksRule||!object(checksRule.parameters)||
    checksRule.parameters.strict_required_status_checks_policy!==true||
    !Array.isArray(checksRule.parameters.required_status_checks))return null;
  const raw=checksRule.parameters.required_status_checks;
  const names=raw.filter(object).map(v=>v.context).filter((v):v is string=>
    typeof v==='string'&&v.trim().length>0);
  if(names.length===0||names.length!==raw.length||new Set(names).size!==names.length)return null;
  return {
    repository,branch,rulesetId:input.id as number,
    requiredChecks:names,verifiedAt:new Date().toISOString(),
  };
}

/** No saved approval: live remote check before each mutation.
 * We intentionally reject unverifiable GitHub state, not interpret it as protected.
 */
export async function assertBranchProtection(
  projectPath:string,command:ProtectionCommand=defaultCommand,
):Promise<BranchProtectionEvidence>{
  try {
    const slug=parseGitHubRemote(await command('git',['remote','get-url','origin'],projectPath));
    if(!slug)fail('selected project has no valid GitHub origin');
    const metadata=parse(await command('gh',['api',`repos/${slug}`],projectPath));
    if(!object(metadata)||metadata.full_name!==slug||
      typeof metadata.default_branch!=='string'||
      !/^[a-zA-Z0-9._/-]+$/.test(metadata.default_branch))
      fail('repository or default branch cannot be verified');
    const branch=metadata.default_branch as string;
    const pages=parse(await command('gh',['api','--paginate','--slurp',
      `repos/${slug}/rulesets?includes_parents=true&per_page=100`],projectPath));
    if(!Array.isArray(pages)||!pages.every(Array.isArray))fail('ruleset listing unavailable');
    for(const entry of pages.flat()){
      if(!object(entry)||typeof entry.id!=='number'||!Number.isSafeInteger(entry.id)||entry.enforcement!=='active')
        continue;
      const detail=parse(await command('gh',['api',
        `repos/${slug}/rulesets/${entry.id}`],projectPath));
      const evidence=verifyStrictRuleset(detail,slug,branch);
      if(evidence)return evidence;
    }
    return fail('no active, non-bypassable PR and strict-check ruleset for '+branch);
  }catch(error){
    if(error instanceof Error&&error.message.startsWith('Branch protection required:'))
      throw error;
    return fail('GitHub verification unavailable or invalid');
  }
}
