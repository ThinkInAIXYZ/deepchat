# Auto-Tools Feature Specification

## Context
- Problem: Loading all tool definitions upfront burns tokens and hurts accuracy with large MCP/agent inventories.
- Goal: Auto-tools mode lets the LLM search tools and orchestrate them via JavaScript sandbox, only returning the final summarized output to the model.
- Compatibility: Works with all providers (no model gating) except ACP (already programmatic). Uses existing ToolPresenter/AgentLoop, permission system, and Node sandbox.

## User Stories
- US1 Token Reduction: Enable auto-tools to cut tool-definition/context tokens by ~60-80% without losing any tool access.
- US2 Automatic Workflows: LLM writes JS to search + batch-call tools; intermediate results stay in sandbox, only summaries go back.
- US3 Backward Compatibility: Traditional mode remains default; users can toggle per conversation or globally.
- US4 Safety & Transparency: Sandbox with restricted modules, permission checks, execution timeout; dev mode logs for observability.

## Acceptance Criteria
- Config flag `enableAutoTools` (default false) + UI toggle; conversation prompt shows current mode and allows manual switch.
- When enabled (non-ACP): send lightweight tool metadata + `run_auto_tool`; LLM can call search/call/batch APIs in sandbox.
- Sandbox returns summarized result only; intermediate data excluded from LLM context.
- Permissions enforced via existing CommandPermissionService/MCP permission flow; read auto-approve configurable, write/execute require prompt.
- Dev mode logs sandbox executions; UI shows progress (search → calls → summary) with collapsible detail.

## Non-Goals
- No Python sandbox (JS only leveraging existing Node runtime).
- No model restriction/allowlist (user confirmed strong function wrapping is enough).
- No new semantic/embedding search in v1 (start with lightweight text/fuzzy search).
- No behavior change to ACP provider.

## Open Questions / Decisions
- Fallback if sandbox fails: return partial results + error to LLM; do not auto-switch modes.
- Token budgeting: only log comparative savings in dev mode; do not auto-disable.
- UI surfacing: always show brief progress + summary; detailed logs only in debug/dev mode.

## Success Metrics
- Token: 60-80% reduction on multi-tool flows (baseline vs auto-tools).
- Latency: sandbox orchestration adds <2s overhead vs traditional; fewer model round-trips overall.
- Accuracy: higher tool selection precision via search (target fewer wrong tool calls).
- Safety: zero sandbox escapes; all write/execute actions require permission.

## Risks & Mitigations
- Sandbox escape → module blacklist, pattern guards, timeouts, iteration/memory caps.
- Permission bypass → reuse existing permission pipeline; cache per conversation; force prompt on write/execute.
- LLM hallucinated APIs → clear errors, allow retry; metadata kept concise; `getToolDetails` available on demand.
- Performance regressions → cache tool metadata/index; cap parallel calls; summarize outputs.
