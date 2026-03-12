# Agent/Session Legacy Archive

Snapshot date: `2026-03-12`

This archive preserves the retired agent/session stack that was removed from live `src/`.

Included:
- `src/main/presenter/agentPresenter`
- `src/main/presenter/sessionPresenter`
- legacy tests under `test/main/presenter/agentPresenter` and `test/main/presenter/sessionPresenter`
- pre-cleanup architecture and navigation docs

Live replacements:
- `src/main/presenter/newAgentPresenter`
- `src/main/presenter/deepchatAgentPresenter`
- `src/main/presenter/agentRuntime`

Rules:
- Do not import archive code from live runtime.
- Archive code is reference-only for migration and debugging.
- Lint/format ignores `archive/**`.
