/** Deterministic, provider-independent AutoDev workflow contract.
 * No Git, Kilo or GitHub mutations occur in this module.
 * Only a valid sequence of events can enter the publish state.
 */
export type Stage = 'plan' | 'build' | 'review' | 'quality' | 'publish' | 'done' | 'blocked';
export interface WorkflowState {
  issueNumber: number;
  stage: Stage;
  fixAttempts: number;
  maxFixAttempts: number;
  feedback: string[];
  reviewed: boolean;
  qualityPassed: boolean;
}

export type WorkflowEvent =
  | { type: 'plan-approved' }
  | { type: 'build-complete' }
  | { type: 'review-pass'; blockers: number }
  | { type: 'review-fail'; feedback: string }
  | { type: 'quality-pass' }
  | { type: 'quality-fail'; feedback: string }
  | { type: 'published' };

export function initializeWorkflow(issueNumber: number, maxFixAttempts = 3): WorkflowState {
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) throw new Error('Invalid issue number');
  if (!Number.isSafeInteger(maxFixAttempts) || maxFixAttempts < 0 || maxFixAttempts > 10) {
    throw new Error('Invalid retry budget');
  }
  return { issueNumber, stage: 'plan', fixAttempts: 0, maxFixAttempts,
    feedback: [], reviewed: false, qualityPassed: false };
}

function failOrRetry(state: WorkflowState, feedback: string): WorkflowState {
  const message = feedback.trim();
  if (!message) throw new Error('Review/quality feedback is required');
  const attempts = state.fixAttempts + 1;
  return { ...state, stage: attempts > state.maxFixAttempts ? 'blocked' : 'build',
    fixAttempts: attempts, feedback: [...state.feedback, message],
    reviewed: false, qualityPassed: false };
}

export function transition(state: WorkflowState, event: WorkflowEvent): WorkflowState {
  if (state.stage === 'done' || state.stage === 'blocked') {
    throw new Error('A completed or blocked workflow cannot advance');
  }
  switch (state.stage) {
    case 'plan':
      if (event.type === 'plan-approved') return { ...state, stage: 'build' };
      break;
    case 'build':
      if (event.type === 'build-complete') {
        return { ...state, stage: 'review', reviewed: false, qualityPassed: false };
      }
      break;
    case 'review':
      if (event.type === 'review-fail') return failOrRetry(state, event.feedback);
      if (event.type === 'review-pass') {
        if (!Number.isSafeInteger(event.blockers) || event.blockers < 0) throw new Error('Invalid blocker count');
        if (event.blockers !== 0) throw new Error('Reviewer PASS with blockers is not acceptable');
        return { ...state, stage: 'quality', reviewed: true };
      }
      break;
    case 'quality':
      if (event.type === 'quality-fail') return failOrRetry(state, event.feedback);
      if (event.type === 'quality-pass') {
        if (!state.reviewed) throw new Error('Reviewer PASS is required');
        return { ...state, stage: 'publish', qualityPassed: true };
      }
      break;
    case 'publish':
      if (event.type === 'published') {
        if (!state.reviewed || !state.qualityPassed) throw new Error('Cannot publish without gates');
        return { ...state, stage: 'done' };
      }
      break;
  }
  throw new Error(`Invalid transition: ${state.stage} → ${event.type}`);
}

export const WORKFLOW_STAGES: ReadonlyArray<{ stage: Stage; title: string; explanation: string }> = [
  { stage: 'plan', title: 'Plan', explanation: 'Issue verstehen und Akzeptanzkriterien formulieren' },
  { stage: 'build', title: 'Builder', explanation: 'Änderungen implementieren und Tests schreiben' },
  { stage: 'review', title: 'Review', explanation: 'Unabhängiger Agent prüft Code und Anforderungen' },
  { stage: 'quality', title: 'Quality Gates', explanation: 'Automatisierte Prüfungen müssen bestehen' },
  { stage: 'publish', title: 'Abschluss', explanation: 'Erst nach PASS und grünen Gates veröffentlichen' },
];
