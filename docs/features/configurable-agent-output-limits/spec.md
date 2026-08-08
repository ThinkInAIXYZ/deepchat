# Configurable Agent Output Limits Spec

## Status

Implemented and verified on `codex/configurable-agent-output-limits`.

There are no unresolved product questions in this spec.

## Source

This feature addresses [GitHub issue #2102](https://github.com/ThinkInAIXYZ/deepchat/issues/2102).

## Problem

DeepChat currently fixes three user-visible output limits in code:

- file reads without an explicit `limit` are truncated at 4,500 characters;
- selected large tool results are offloaded at 5,000 characters;
- foreground command and skill-script results expose at most 12,000 output characters.

The fixed values are conservative for small context windows but unnecessarily hide usable output
from larger-context models. Users cannot tune the trade-off between inline context and follow-up
file reads for each Agent.

The issue also names two 10,000-character constants and a `webContentLengthLimit` setting. The
10,000-character values are internal disk-spooling ceilings, not the effective inline command
preview. `webContentLengthLimit` no longer exists in the current Agent runtime. Exposing those
implementation details would produce misleading settings.

## Goals

- Let each DeepChat Agent configure the three effective, user-visible character limits.
- Preserve current defaults for file reads and generic tool output.
- Use the current 12,000-character command preview as the command default.
- Apply changes to subsequent tool calls, including calls in existing sessions.
- Keep explicit file-read `offset` and `limit` arguments authoritative.
- Keep the context preflight check authoritative even when a configured limit is large.
- Reuse an existing command output file when context pressure requires a smaller stub.
- Keep saved values portable and validated across renderer, route, and main-process boundaries.

## Non-goals

- Exposing internal command or utility-process disk-spooling thresholds.
- Restoring the removed `webContentLengthLimit` setting or the legacy chat-mode web pipeline.
- Allowing an unlimited value such as `0`.
- Estimating limits in tokens or bytes. The contract is JavaScript string characters.
- Changing background `process` tool pagination. Polling previews follow the Agent command limit.
- Removing the final request-context safety check.
- Adding a new settings store, persistence table, IPC route, dependency, or migration.

## User-visible Contract

The Agent editor adds a collapsed **Advanced output limits** section under **Tools**.

| Setting | Config field | Default | Allowed range | Meaning |
| --- | --- | ---: | ---: | --- |
| File read auto-truncate | `readFileAutoTruncateChars` | 4,500 | 1,000-200,000 | Maximum file content returned when `read` omits `limit` |
| Tool output inline limit | `toolOutputInlineChars` | 5,000 | 1,000-200,000 | Maximum inline result for tools already covered by the output guard |
| Command output inline limit | `commandOutputInlineChars` | 12,000 | 1,000-200,000 | Maximum foreground output preview for `exec` and `skill_run` |

Values are integers. Renderer input is normalized on save; route validation rejects values outside
the contract. Missing fields resolve to defaults, so existing Agent records need no migration.

### File reads

- An explicit positive `limit` continues to win, even when it is larger than the Agent setting.
- Without `limit`, text and prepared document content use the Agent's file-read value.
- Pagination metadata continues to report the actual character range and total length.
- The tool description no longer hardcodes 4,500; it describes Agent-configured auto-truncation.

### Generic tool output

- The current guarded tool set remains unchanged except that `exec` is owned by the command path.
- Results at or below the configured limit stay inline.
- Larger results are written to the existing per-session tool-offload path and represented by the
  current preview stub.

### Commands and skill scripts

- `exec` and `skill_run` return at most the configured output preview plus terminal metadata.
- Background sessions retain the Agent command limit that started them, while explicit `process`
  polls use the current Agent command limit.
- The fixed 10,000-character spooling ceiling remains an internal upper bound.
- When the configured preview is lower, spooling begins at the lower value so omitted output stays
  recoverable from the generated log file.
- The generic tool guard does not offload an already prepared command preview a second time.

### Context safety

The configured values are upper bounds, not a promise that every character enters the next model
request.

1. The runtime prepares results using the configured limits.
2. The batch context preflight checks the complete next request.
3. If it does not fit, eligible raw results are replaced with offload stubs.
4. For command output, an existing generated log path is reused.
5. Only if the smaller stubs still do not fit does the existing tool-error/terminal-error fallback
   apply.

Deferred-result fitting uses the model's effective context budget, observes cancellation, and
checks turn ownership before mutating or persisting the resumed result. A fallback file created by
an abandoned resume is removed; an existing command log remains owned by the command tool and is
never removed by the context guard.

## Settings UI

### BEFORE

```text
+----------------------------------------------------------+
| Tools                                                    |
| agent-filesystem                         [enabled]        |
| [read] [write] [edit] [glob] [grep] [exec] [process]    |
+----------------------------------------------------------+
```

### AFTER

```text
+----------------------------------------------------------+
| Tools                                                    |
| agent-filesystem                         [enabled]        |
| [read] [write] [edit] [glob] [grep] [exec] [process]    |
|                                                          |
| Advanced output limits                         [v]       |
| Tune inline context per Agent                             |
|   File read       [ 4500 ] chars                          |
|   Tool output     [ 5000 ] chars                          |
|   Command output  [12000 ] chars          [Reset]         |
+----------------------------------------------------------+
```

The native number inputs have visible labels, min/max constraints, and short descriptions. The
collapsed state is local presentation state and is not persisted.

## Data and Ownership

- Source of truth: optional fields in `DeepChatAgentConfig`, persisted in the existing Agent config
  JSON.
- Repository owner: `DeepChatAgentRepository` preserves the optional fields when merging saved
  config with runtime defaults.
- Renderer owner: `DeepChatAgentsSettings.vue`, alongside other per-Agent tool configuration.
- Runtime normalization owner: a shared pure helper that supplies defaults and clamps defensive
  in-process reads.
- File-read owner: `AgentToolManager` resolves the session Agent and supplies the read limit to both
  raw-text and prepared-document paths.
- Command owner: `AgentBashHandler` and `SkillExecutionService` apply the command preview while the
  background execution manager retains disk-spooling ownership.
- Context owner: `ToolOutputGuard` applies the generic tool limit and final batch fit.
- Electron boundary: the existing typed Agent config routes. No new preload or IPC API is needed.

## Compatibility

- Existing config JSON remains valid because all fields are optional.
- Existing Agents behave as before for file reads and generic guarded tools.
- Foreground commands may now remain inline up to 12,000 characters instead of being re-offloaded
  by the generic 5,000-character guard. Their own log offload remains available above the command
  limit.
- ACP Agents are unaffected because these fields belong to `DeepChatAgentConfig` and the DeepChat
  Agent runtime.

## Acceptance Criteria

- Saving and reloading an Agent preserves all three limits.
- Empty, invalid, fractional, or out-of-range UI values normalize to the documented integer range.
- Route schemas reject invalid external values.
- A raw text read and a prepared document read both honor a custom file-read limit.
- An explicit read `limit` overrides the configured auto-truncate value.
- A guarded tool result uses a custom inline threshold.
- `exec` and `skill_run` use a custom foreground preview and preserve overflow in a readable file.
- Background command and skill sessions preserve their configured preview, and later `process`
  polls use the current Agent command limit.
- Context overflow reuses an existing command log path instead of creating a nested offload.
- Deferred-result fitting stops on cancellation or stale turn ownership, removes only newly created
  fallback files, and never removes a tool-owned command log.
- Production Agent config resolution preserves all three saved values.
- Existing defaults remain effective when the fields are absent.
- Focus, keyboard input, save dirty-state tracking, and nearby Agent settings remain stable.

## Verification Evidence

- `pnpm format`
- `pnpm i18n`
- `pnpm lint`
- `pnpm typecheck`
- Focused main-process regression suite: 11 files, 572 tests passed.
- Agent settings component suite: 1 file, 27 tests passed.
- The final worktree contains only durable contract and regression tests; no temporary test files or
  implementation-only artifacts remain.
