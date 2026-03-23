# Tool Output Guardrails Plan

## Summary

- Keep the existing single-tool offload behavior.
- Add batch fitting for tool results in the new session agent path only.
- Preserve the largest prefix of tool results that can still fit the next model call.
- Downgrade overflow tail results to the fixed context-window failure message before continuing.
- Keep terminal error fallback when even the fully downgraded batch cannot fit.

## Implementation

- Extend `ToolOutputGuard` with a batch fitting helper that:
  - evaluates the full staged batch against the context budget
  - downgrades tail items one by one to the fixed failure message
  - cleans up offload files for downgraded items
  - returns terminal fallback if the fully downgraded batch still does not fit
- Refactor `executeTools()` in `deepchatAgentPresenter/dispatch.ts` into two phases:
  - execute tools and stage candidate outputs plus side effects
  - fit the staged batch, then commit final tool messages, blocks, hooks, and search persistence once
- Keep `question` and `permission` pauses on the immediate path; they are not part of staged batch fitting.
- Keep deferred permission-resume behavior unchanged.

## Test Plan

- Multi-`read` batch: keep prefix, downgrade overflow tail, continue next provider turn.
- Mixed `exec`/`read`: downgraded offloaded results must delete their `.offload` files.
- Search resource result in downgraded tail: no search block and no persisted search rows.
- Fully downgraded batch still too large: return terminal error.
- Preserve existing deferred single-tool resume regressions.
