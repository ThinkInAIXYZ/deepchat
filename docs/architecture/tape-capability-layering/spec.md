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
10. A published per-conversation runtime catalog is authoritative for execution. A missing tool in
    that catalog, or a missing/cleared mapper while the global snapshot belongs to another
    conversation, cannot fall back across conversations. A global snapshot published without a
    conversation ID remains available as the draft-to-persisted-session compatibility bridge.
11. Tape recall execution revalidates the persisted DeepChat session and complete runtime pair so
    stale, direct, or fabricated calls cannot bypass catalog availability.
12. Capability cleanup changes only disabled-tool state; it preserves session activity timestamps,
    conversation ordering, and environment recency.
13. Every Agent tool assembly site declares its expected exposure and verifies it against the
    shared exposure policy before adding definitions to a catalog.

## Acceptance Criteria

- No `agent-tape` group appears in either a new-thread draft or a persisted session. Other
  configurable Agent tool groups may continue to vary with session-scoped capabilities such as
  Memory, image generation, subagents, and active Skills.
- A DeepChat runtime session exposes exactly `tape_search` and `tape_context` from the Tape tool
  group, even when a legacy disabled list contains those names.
- ACP sessions, missing conversation IDs, and incomplete recall ports expose no Tape model tools.
- Direct or deferred model calls to diagnostic/runtime-only Tape names fail without appending an
  anchor or otherwise mutating Tape state.
- Empty or whitespace-only runtime handoff summaries fail before an anchor is appended.
- The disabled-tool cleanup is idempotent, preserves ordinary disabled tools, and yields while
  processing large session sets without changing session or environment recency.
- A request carrying a conversation ID cannot execute through another conversation's latest
  mapping when its own catalog is missing, cleared, or does not contain the tool, while a draft
  catalog published without an ID remains usable for the first persisted turn.
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
- Making every configurable Agent tool group identical between draft and persisted sessions.
- Making Bub's current tool exposure policy a compatibility target.

## Open Questions

None.
