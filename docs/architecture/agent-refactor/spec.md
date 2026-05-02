# Agent Refactor Spec

## Goal

Raise the default DeepChat agent baseline without rewriting the presenter architecture. P0 must be useful on its own for code changes, requirement analysis, repository inspection, and structured research.

## Requirements

1. DeepChat agents default to subagents enabled unless explicitly disabled.
2. Default subagent slots include self-based `explorer`, `implementer`, and `reviewer` roles.
3. Provider requests receive one composed system message, not multiple system messages.
4. The composed system prompt order is stable:
   - user/base prompt
   - runtime capabilities
   - environment and `AGENTS.md`
   - skills metadata and pinned skills
   - tooling rules
   - permission rules
   - verification policy
5. Read-only canonical Agent tools may execute in parallel when a tool-call round contains only read-only calls.
6. Mutating and runtime canonical tools remain serialized or permission-gated.
7. Tool schemas are loaded through a stable session profile and cache. Ordinary user messages must not by themselves change the tool profile.
8. Code-agent verification policy requires final answers to account for verification after code changes.

## Non-Goals

1. Do not implement a per-turn tool router.
2. Do not rewrite IPC, renderer message flow, or provider runtime architecture.
3. Do not change the tool-result envelope implementation before the protocol document is reviewed.
4. Do not remove legacy function-call fallback in this phase.

## Acceptance

1. New or resolved DeepChat agent configs expose enabled subagents and the three default self slots.
2. Agent runtime requests include at most one `system` role message.
3. Prompt section order follows the requirement above and includes `AGENTS.md` via the environment section.
4. A batch of only `read`/`ls`/`find`/`grep` Agent tool calls starts concurrently and writes tool results back in model call order.
5. Any batch containing `write`/`edit`/`exec`/`process` stays serialized.
6. Repeated ordinary messages in the same session reuse the stable tool profile unless project directory, disabled tools, model, or active skills change.
