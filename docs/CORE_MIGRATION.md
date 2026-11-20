# Migration: AutoDev Core from LaceFrame to AutoDev Studio

## Binding architecture decision
- **Only AutoDev Studio owns the Planner, Builder, independent Reviewer, Quality Gates, sessions, checkpoints and GitHub issue lifecycle.**
- Projects (including LaceFrame and AutoDev Studio itself) contain **no AutoDev runtime**. A Git repository and optional project-level test/build configuration are sufficient.
- The former LaceFrame implementation is a reference and fallback **until Studio is production-ready**. Never delete, reset or migrate its active checkpoint silently.

## Definition of Production Ready (all required)
- [ ] A standalone Studio controller processes issues from arbitrary selected local Git repositories.
- [ ] Distinct Plan -> Builder -> independent Reviewer -> Quality Gates -> Publish workflow.
- [ ] Review FAIL -> Builder fixes -> independent review again; bounded attempts and fail-closed policy.
- [ ] Review PASS with zero blockers **and** successful project quality gates required for publish.
- [ ] Session ID preserved on streaming failures, rate limits and interrupted processes; checkpoint resumes safely with verified repo HEAD and working-tree identity.
- [ ] Explicit user approval for productive execution, no automatic starts after application restarts.
- [ ] Independent concurrency control across Studio processes, no worktree/reset/force push, no inherited staged changes.
- [ ] Project-specific tests, dry-run and integration simulations pass; separate Linux desktop smoke tests.
- [ ] At least one real, supervised end-to-end issue completes through Studio, including PASS -> publish and failure recovery.
- [ ] Historical logs, checkpoints and configuration are backed up with a documented migration and rollback plan.

## Final LaceFrame cleanup (separate PR, **after** production-ready validation)
1. Record an inventory of AutoDev-specific source, tests, scripts, config, state, logs and GitHub Actions.
2. Archive operational state and verify no active workflow or checkpoint is lost.
3. Demonstrate equivalent issue handling in Studio against LaceFrame as an external project.
4. Remove **only** AutoDev-specific runtime/integration artifacts from LaceFrame; preserve its unrelated game/tool features and tests.
5. Review, run the full LaceFrame suite, merge via ordinary PR. Keep rollback instructions and archive available.
6. Do not remove or overwrite local secrets or untracked state automatically.

This document defines the release gate; a green TypeScript test alone is never enough to declare Production Ready.
