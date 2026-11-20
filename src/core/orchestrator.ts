import { initializeWorkflow, transition, type WorkflowState, type Stage } from './workflow.ts';

/** Contract for execution adapters. Adapters are injected, not inferred from project files.
 * Real adapters must be separately reviewed before enabling production actions.
 */
export interface IssueTask { number: number; title: string; body: string }
export interface PlanResult { summary: string; steps: string[] }
export interface BuildResult { summary: string }
export type ReviewResult = { verdict: 'PASS'; blockers: 0; summary: string }
  | { verdict: 'FAIL'; blockers: number; feedback: string };
export type QualityResult = { passed: true; summary: string } | { passed: false; feedback: string };

export interface WorkflowAdapters {
  planner(issue: IssueTask): Promise<PlanResult>;
  builder(issue: IssueTask, plan: PlanResult, feedback: readonly string[]): Promise<BuildResult>;
  reviewer(issue: IssueTask, plan: PlanResult, build: BuildResult): Promise<ReviewResult>;
  quality(issue: IssueTask): Promise<QualityResult>;
  publish(issue: IssueTask): Promise<void>;
}

export interface WorkflowTrace {
  stage: Stage;
  message: string;
  issueNumber: number;
  fixAttempts: number;
}
export type EmitTrace = (event: WorkflowTrace) => void;
export interface WorkflowResult {
  state: WorkflowState;
  events: WorkflowTrace[];
}

export async function orchestrateIssue(
  issue: IssueTask,
  adapters: WorkflowAdapters,
  options: { maxFixAttempts?: number; signal?: AbortSignal; onEvent?: EmitTrace } = {},
): Promise<WorkflowResult> {
  let state = initializeWorkflow(issue.number, options.maxFixAttempts ?? 3);
  const events: WorkflowTrace[] = [];
  const emit = (message: string): void => {
    const entry = { stage: state.stage, issueNumber: issue.number, fixAttempts: state.fixAttempts, message };
    events.push(entry);
    options.onEvent?.(entry);
  };
  const ensureActive = (): void => {
    if (options.signal?.aborted) throw new Error('Workflow aborted; publication prevented');
  };

  emit('Planning issue');
  ensureActive();
  const plan = await adapters.planner(issue);
  ensureActive();
  if (!plan.summary.trim() || plan.steps.length === 0 || plan.steps.some(step => !step.trim())) {
    throw new Error('Planner returned an incomplete plan');
  }
  state = transition(state, { type: 'plan-approved' });
  emit('Plan approved; builder starts');

  while (state.stage === 'build') {
    ensureActive();
    const result = await adapters.builder(issue, plan, state.feedback);
    ensureActive();
    if (!result.summary.trim()) throw new Error('Builder returned no summary');
    state = transition(state, { type: 'build-complete' });
    emit('Builder complete; independent review starts');

    const review = await adapters.reviewer(issue, plan, result);
    ensureActive();
    if (review.verdict === 'FAIL') {
      state = transition(state, { type: 'review-fail', feedback: review.feedback });
      emit(state.stage === 'blocked' ? 'Review failed; retry budget exhausted' : 'Review failed; builder receives feedback');
      continue;
    }
    if (review.blockers !== 0) throw new Error('Reviewer PASS must have zero blockers');
    state = transition(state, { type: 'review-pass', blockers: review.blockers });
    emit('Independent review PASS; quality gates start');

    const quality = await adapters.quality(issue);
    ensureActive();
    if (!quality.passed) {
      state = transition(state, { type: 'quality-fail', feedback: quality.feedback });
      emit(state.stage === 'blocked' ? 'Quality failed; retry budget exhausted' : 'Quality failed; builder receives feedback');
      continue;
    }
    state = transition(state, { type: 'quality-pass' });
    emit('All gates PASS; publishing');
    ensureActive();
    await adapters.publish(issue);
    state = transition(state, { type: 'published' });
    emit('Issue completed');
  }
  return { state, events };
}

/** Deliberately inert implementation: never launches Kilo, writes code, runs Git or publishes.
 * A simulated publish is an in-memory callback only.
 */
export function createSimulationAdapters(options: { failFirstReview?: boolean; failFirstQuality?: boolean } = {}): WorkflowAdapters {
  let reviews = 0;
  let qualities = 0;
  return {
    async planner(issue) {
      return { summary: `Simulation: plan issue #${issue.number}`,
        steps: ['Understand requirements', 'Prepare proposed changes', 'Review and validate'] };
    },
    async builder(_issue, _plan, feedback) {
      return { summary: feedback.length ? 'Simulation: fix based on review feedback' : 'Simulation: initial implementation' };
    },
    async reviewer() {
      reviews++;
      return options.failFirstReview && reviews === 1
        ? { verdict: 'FAIL', blockers: 1, feedback: 'Simulated reviewer requests a correction' }
        : { verdict: 'PASS', blockers: 0, summary: 'Simulated reviewer PASS' };
    },
    async quality() {
      qualities++;
      return options.failFirstQuality && qualities === 1
        ? { passed: false, feedback: 'Simulated quality gate failed' }
        : { passed: true, summary: 'Simulated quality gates passed' };
    },
    async publish() { /* Simulation: intentionally no external effects. */ },
  };
}
