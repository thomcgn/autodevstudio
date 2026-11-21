import type { ReviewResult } from './orchestrator.ts';
import type { ReviewEvidence } from './review-evidence.ts';
import { collectReviewEvidence } from './review-evidence.ts';

export interface BoundReviewVerdict {
  issueNumber: number;
  verdict: ReviewResult;
  evidenceFingerprint: string;
  head: string;
  branch: string;
  worktreeHash: string;
}
export type EvidenceCollector = (projectPath: string, signal?: AbortSignal) => Promise<ReviewEvidence>;
export type EvidenceReviewer = (evidence: Readonly<ReviewEvidence>) => Promise<ReviewResult>;

function exactEvidenceMatches(a: ReviewEvidence,b: ReviewEvidence): boolean {
  return a.fingerprint === b.fingerprint &&
    a.identity.head === b.identity.head &&
    a.identity.branch === b.identity.branch &&
    a.identity.worktreeHash === b.identity.worktreeHash;
}

/** Bind a reviewer verdict to exactly one Git content fingerprint.
 * A changed workspace invalidates PASS or FAIL, even when the reviewer text
 * appears valid. This API does not grant permission to run an agent or publish.
 */
export async function reviewEvidenceBound(
  projectPath: string, issueNumber: number, reviewer: EvidenceReviewer,
  signal?: AbortSignal,
  collect: EvidenceCollector = collectReviewEvidence,
): Promise<BoundReviewVerdict> {
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1)
    throw new Error('Invalid issue number');
  if (signal?.aborted) throw new Error('Review cancelled');
  const before = await collect(projectPath,signal);
  if (signal?.aborted) throw new Error('Review cancelled');
  const verdict = await reviewer(before);
  if (signal?.aborted) throw new Error('Review cancelled');
  const after = await collect(projectPath,signal);
  if (!exactEvidenceMatches(before,after))
    throw new Error('Review evidence changed during model review; verdict invalid');
  if (verdict.verdict==='PASS' && (verdict.blockers !== 0 || !verdict.summary.trim()))
    throw new Error('Invalid PASS verdict');
  if (verdict.verdict==='FAIL' && (verdict.blockers < 1 || !verdict.feedback.trim()))
    throw new Error('Invalid FAIL verdict');
  return {
    issueNumber,verdict,evidenceFingerprint:before.fingerprint,
    head:before.identity.head,branch:before.identity.branch,
    worktreeHash:before.identity.worktreeHash,
  };
}

/** A prior PASS may be accepted by later trusted code only after a fresh
 * evidence collection. Changes after an approval must invalidate it.
 */
export async function assertBoundReviewStillCurrent(
  projectPath: string, issueNumber: number, approval: BoundReviewVerdict,
  signal?: AbortSignal,
  collect: EvidenceCollector = collectReviewEvidence,
): Promise<void> {
  if (approval.issueNumber !== issueNumber || approval.verdict.verdict !== 'PASS' ||
      approval.verdict.blockers !== 0) {
    throw new Error('No matching PASS approval');
  }
  if (signal?.aborted) throw new Error('Review approval check cancelled');
  const current = await collect(projectPath,signal);
  if (approval.evidenceFingerprint !== current.fingerprint ||
      approval.head !== current.identity.head ||
      approval.branch !== current.identity.branch ||
      approval.worktreeHash !== current.identity.worktreeHash) {
    throw new Error('Review PASS became stale after repository changes');
  }
}
