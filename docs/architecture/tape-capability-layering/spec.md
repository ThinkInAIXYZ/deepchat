# Tape Capability Layering - Spec

> Status: **implemented**

## Problem

DeepChat currently uses the runtime tool catalog as the source for both model execution and the
renderer's Agent tool configuration. Tape tools require a persisted DeepChat session, so the
configuration UI changes after the first message creates a session. The same catalog also applies
`disabledAgentTools` to every built-in Agent tool, which incorrectly presents Tape runtime
capabilities as optional user tools.

This behavior is reported by
[GitHub issue #1975](https://github.com/ThinkInAIXYZ/deepchat/issues/1975).

## Requirements

1. Tape recording, reconstruction, compaction, replay, and memory lineage remain always-on runtime
   infrastructure with no user-facing disable switch.
2. Agent tools have one authoritative exposure classification:

   | Tool | Exposure |
   | --- | --- |
   | `tape_search` | `system-model` |
   | `tape_context` | `system-model` |
   | `tape_info` | `diagnostic` |
   | `tape_anchors` | `diagnostic` |
   | `tape_handoff` | `runtime-only` |

3. Existing Agent tools without an explicit classification remain `user-configurable`.
4. The runtime catalog includes available `system-model` tools regardless of
   `disabledAgentTools`. The configurable catalog contains only `user-configurable` Agent tools.
5. Configurable catalog reads must not publish a `ToolMapper`, update conversation MCP access
   context, or mutate runtime tool-profile caches.
6. The model-facing Tape contract exposes `tape_search` and `tape_context` as an atomic recall pair.
   Neither tool is exposed if either runtime port is unavailable.
7. `tape_info`, `tape_anchors`, and `tape_handoff` remain reserved names but cannot be invoked as
   model tools.
8. Runtime handoff requires a non-empty durable summary before advancing the reconstruction cursor.
9. Persisted Tape names are removed from Agent and session disabled-tool lists without modifying
   messages, Tape entries, or replay manifests.

## Acceptance Criteria

- A new-thread draft and its persisted session show the same configurable Agent tool groups; no
  `agent-tape` group appears in either state.
- A DeepChat runtime session exposes exactly `tape_search` and `tape_context` from the Tape tool
  group, even when a legacy disabled list contains those names.
- ACP sessions, missing conversation IDs, and incomplete recall ports expose no Tape model tools.
- Direct or deferred model calls to diagnostic/runtime-only Tape names fail without appending an
  anchor or otherwise mutating Tape state.
- Empty or whitespace-only runtime handoff summaries fail before an anchor is appended.
- The disabled-tool cleanup is idempotent, preserves ordinary disabled tools, and yields while
  processing large session sets.
- Memory enablement, memory extraction/injection, subagents, skills, MCP tools, and ordinary Agent
  tool switches retain their existing behavior.
- Focused tests, typecheck, full tests, formatting, i18n validation, and lint pass.

## Constraints

- Keep the `tools.listDefinitions` IPC route name and wire shape compatible.
- Keep all Tape names reserved against same-name MCP definitions.
- Preserve historical messages, tool-call facts, Tape entries, and replay behavior.
- Do not modify or stage pre-existing untracked documentation in the working tree.
- Do not push, create a pull request, tag, or mutate the linked GitHub issue.

## Non-goals

- Implementing a phase-aware or topic-aware Tape view.
- Implementing an anchor graph, cross-anchor traversal, or a second `TapeViewPolicy`.
- Adding a Tape inspector or special-purpose Tape trace UI.
- Reclassifying Memory, Subagent, Skill, Browser, or other non-Tape Agent tools.
- Making Bub's current tool exposure policy a compatibility target.

## Open Questions

None.
