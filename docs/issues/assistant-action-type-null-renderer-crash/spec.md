# Assistant `action_type` Null Renderer Crash

## Problem

Resuming a tool interaction can reload assistant message blocks from the normalized SQLite table. That table stores `action_type` as nullable text, and hydrated non-action blocks currently carry `action_type: null` into runtime message content. Renderer flushes then validate the block array with `AssistantMessageBlockSchema`, which allows an omitted `action_type` but rejects `null`, causing stream finalization and tool-interaction routes to fail.

## Goals

- Keep nullable `action_type` as a storage detail only.
- Materialize assistant blocks with `action_type` omitted unless the persisted value is a supported renderer action type.
- Preserve the strict renderer/event contract so invalid message shapes are still rejected before publication.

## Non-Goals

- No schema migration for `deepchat_assistant_blocks`.
- No IPC, route, renderer component, or public type changes.
- No behavior change for valid `tool_call_permission`, `question_request`, or `rate_limit` blocks.

## Acceptance Criteria

- Hydrated content/tool blocks with `action_type = NULL` do not include an `action_type` property.
- Hydrated rows with unknown `action_type` values omit the property instead of crashing renderer publication.
- Valid persisted action blocks keep their action type.
- Regression tests cover hydration and renderer cloning for the affected shapes.
