# Tool Call Path Summary

## User Story

Users should see the target file path in collapsed `read` and `write` tool call pills, even when
pagination or content fields appear before `path` in the tool arguments.

## Acceptance Criteria

- `read` tool calls preview `path` before `offset`, `limit`, or `base_directory`.
- `write` tool calls preview `path` before `content` or `base_directory`.
- `exec` tool calls continue to preview `command`.
- Generic tool calls keep the existing fallback summary behavior.
- Malformed JSON and missing paths continue to fall back without throwing.

## Non-goals

- Do not change the visible collapsed pill layout.
- Do not add new i18n strings.
- Do not change raw params shown in the expanded details panel.

## Constraints

- Keep the summary helper compatible with existing callers.
- Apply the same path-first behavior to renderer pills and remote trace logs.
