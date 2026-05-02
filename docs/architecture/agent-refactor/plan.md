# Agent Refactor Plan

## P0 Baseline

1. Default DeepChat subagent config:
   - Enable subagents by default.
   - Add self-based `explorer`, `implementer`, and `reviewer` slots.
2. Prompt composition:
   - Build a single system prompt string.
   - Keep section order stable.
   - Add permission and verification policy sections.
3. Tool execution:
   - Parallelize all-read-only canonical Agent tool rounds.
   - Preserve result writeback order.
   - Keep writes, edits, commands, and process operations serialized.

## P1 Stable Tool Profile

1. Add a main-layer session tool-profile cache.
2. Select `code` profile when a project directory is present; otherwise use `general`.
3. Refresh the profile when project directory, model, disabled tools, or active skills change.
4. Keep schemas stable across ordinary user messages.

## P2 Follow-Up

1. Expand profile types for `research` and `analysis`.
2. Add UI affordances for weak agent capability where only legacy tool fallback is available.
3. Implement the documented tool-result envelope after review.
4. Extend subagent lifecycle commands for background management.
