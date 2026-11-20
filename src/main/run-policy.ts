/** Explicit one-run authorization. Never persist or infer consent from renderer state. */
export type RunMode = 'status' | 'dry-run' | 'execute';

export function assertRunApproved(mode: unknown, projectName: string, approval: unknown): asserts mode is RunMode {
  if (mode !== 'status' && mode !== 'dry-run' && mode !== 'execute') {
    throw new Error('Unsupported run mode');
  }
  if (mode === 'execute' && approval !== `EXECUTE ${projectName}`) {
    throw new Error('Explicit project-specific execution approval required');
  }
}
