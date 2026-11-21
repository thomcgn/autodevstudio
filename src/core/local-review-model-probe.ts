import type { IssueTask, PlanResult, BuildResult } from './orchestrator.ts';
import type { ReviewEvidence } from './review-evidence.ts';
import { createEvidenceOnlyReviewer } from './evidence-only-reviewer.ts';
import { createSelectedReviewerTransport } from './reviewer-provider-selection.ts';

export interface LocalReviewModelProbeResult {
  passed:boolean;
  reason:'passed'|'unsupported-platform'|'model-unavailable'|'invalid-verdict'|'request-failed';
}
const issue:IssueTask={
  number:1,title:'Synthetic validation example',
  body:'Review the following artificial patch. No user files are included.',
};
const plan:PlanResult={summary:'Check input validation',steps:['Inspect patch only']};
const build:BuildResult={summary:'Fixture: added an early return for empty input'};
const evidence:ReviewEvidence={
  identity:{head:'a'.repeat(40),branch:'autodev/issue-1',worktreeHash:'b'.repeat(64)},
  fingerprint:'c'.repeat(64),
  status:' M fixture.ts',
  unstagedDiff:'diff --git a/fixture.ts b/fixture.ts\n--- a/fixture.ts\n+++ b/fixture.ts\n@@ -1 +1,2 @@\n function validate(input: string) {\n+  if (!input) return false;\n }',
  stagedDiff:'',
  recentCommits:'aaaaaaaa Synthetic fixture',
};
const DEFAULT_MODEL='qwen2.5-coder:3b';

/** ONE deliberate local model request. The prompt contains ONLY a hard-coded
 * synthetic fixture, never selected project files, Git state or credentials.
 * The model endpoint is fixed to 127.0.0.1 in the selected transport.
 * Any well-formed PASS or FAIL shows only protocol readiness, NOT review quality.
 */
export async function probeLocalReviewModel(
  model:string=DEFAULT_MODEL,
  fetcher:typeof fetch=fetch,
):Promise<LocalReviewModelProbeResult>{
  if(process.platform!=='linux')return {passed:false,reason:'unsupported-platform'};
  try{
    const transport=createSelectedReviewerTransport({
      provider:'ollama-local',model,timeoutMs:150000,
    },fetcher);
    const verdict=await createEvidenceOnlyReviewer(transport)(issue,plan,build,evidence);
    return verdict.verdict==='PASS'||verdict.verdict==='FAIL'
      ?{passed:true,reason:'passed'}
      :{passed:false,reason:'invalid-verdict'};
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(/HTTP 404|unavailable/.test(message))
      return {passed:false,reason:'model-unavailable'};
    if(/^(?:Agent did not provide a delimited JSON result|Malformed agent result|Expected agent JSON object|Missing reviewer verdict|Invalid reviewer|Reviewer output|Reviewer (?:PASS|FAIL)|Invalid Ollama JSON|Ollama tools|Ollama completion|Reviewer response|Agent result exceeds size limit)/i.test(message))
      return {passed:false,reason:'invalid-verdict'};
    return {passed:false,reason:'request-failed'};
  }
}
