import type { IssueTask, PlanResult, BuildResult } from './orchestrator.ts';
import type { ReviewEvidence } from './review-evidence.ts';
import { createEvidenceOnlyReviewer, type EvidenceOnlyReviewerTransport } from './evidence-only-reviewer.ts';

export interface CalibrationResult {
  passed: boolean;
  reason: 'passed'|'wrong-verdict'|'invalid-response'|'cancelled'|'model-unavailable'|'timeout'|'transport-failed'|'rate-limit'|'quota-reserve';
  caseNumber?: 1|2;
}

/** A calibration is NOT permission to run production issues. Both examples
 * are fixed in source, contain zero repository data and invoke a model-only
 * transport supplied by a trusted caller. It never publishes or executes code.
 */
const fixtures = [
  {
    expected:'PASS',
    issue:{number:901,title:'Synthetic fix: handle empty input',body:'Return false for empty tokens; preserve valid token comparisons.'},
    diff:'diff --git a/fixture.ts b/fixture.ts\n--- a/fixture.ts\n+++ b/fixture.ts\n@@ -1,3 +1,4 @@\n export function tokenMatches(token: string, expected: string) {\n+  if (!token) return false;\n   return token === expected;\n }',
    summary:'Added an early guard while retaining the existing comparison.',
  },
  {
    expected:'FAIL',
    issue:{number:902,title:'Synthetic regression: keep access check enforced',body:'Reject callers without the required permission; never bypass this check.'},
    diff:'diff --git a/fixture.ts b/fixture.ts\n--- a/fixture.ts\n+++ b/fixture.ts\n@@ -1,3 +1,3 @@\n export function canAccess(hasPermission: boolean) {\n-  return hasPermission;\n+  return true;\n }',
    summary:'Changed authorization function.',
  },
] as const;

function evidence(number:number,diff:string):ReviewEvidence {
  return {
    identity:{head:'a'.repeat(40),branch:`autodev/issue-${number}`,worktreeHash:'b'.repeat(64)},
    fingerprint:'c'.repeat(64),
    status:' M fixture.ts',
    unstagedDiff:diff,stagedDiff:'',recentCommits:'aaaaaaaa Synthetic baseline',
  };
}

/** Two explicit bounded model requests, no filesystem, commands, or network
 * of its own. PASS means calibration examples matched, not general reliability.
 * Run only following a user-authorized local model calibration action.
 */
/** Public status codes are intentionally coarse. Never leak HTTP bodies, local paths or model text. */
export function classifyCalibrationError(error:unknown): CalibrationResult['reason'] {
  const message=error instanceof Error ? error.message : '';
  if (/^Kilo Gateway free rate limited/.test(message)) return 'rate-limit';
  if (/^Quota checkpoint required/.test(message)) return 'quota-reserve';
  if (/Local reviewer cancelled or timed out|Reviewer Gateway request cancelled or timed out/.test(message)) return 'timeout';
  if (/Ollama unavailable or rejected request \(HTTP (?:404|400)\)/.test(message)) return 'model-unavailable';
  if (/^(?:Ollama unavailable|Local reviewer transport failed|Ollama returned empty response|Ollama response exceeded limit)/.test(message)) return 'transport-failed';
  return 'invalid-response';
}

export async function calibrateReviewer(
  transport:EvidenceOnlyReviewerTransport,
  signal?:AbortSignal,
):Promise<CalibrationResult> {
  const review=createEvidenceOnlyReviewer(transport,signal);
  for(const [index,fixture] of fixtures.entries()) {
    const caseNumber=(index+1) as 1|2;
    if(signal?.aborted)return {passed:false,reason:'cancelled'};
    const issue:IssueTask={...fixture.issue};
    const plan:PlanResult={summary:fixture.issue.body,steps:['Review the synthetic patch']};
    const build:BuildResult={summary:fixture.summary};
    try {
      const verdict=await review(issue,plan,build,evidence(issue.number,fixture.diff));
      if(verdict.verdict!==fixture.expected)return {passed:false,reason:'wrong-verdict',caseNumber};
    } catch (error) {
      if(signal?.aborted)return {passed:false,reason:'cancelled'};
      return {passed:false,reason:classifyCalibrationError(error),caseNumber};
    }
  }
  return {passed:true,reason:'passed'};
}
