# AI SDK System Message Warning

## Problem

AI SDK 6 warns when `role: 'system'` appears inside `messages` or `prompt` because those fields may contain untrusted conversation data. DeepChat currently keeps request-level system instructions as a leading internal `ChatMessage`, then passes the mapped messages directly to AI SDK.

## Requirements

- Preserve DeepChat's internal `ChatMessage` shape and leading system message semantics.
- Send request-level system instructions to AI SDK through the top-level `system` option.
- Keep conversation history, compaction, prompt assembly, token budgeting, and provider routing behavior unchanged.
- Reject non-leading system messages at the AI SDK boundary instead of silently reordering them.

## Acceptance Criteria

- AI SDK `generateText` and `streamText` calls receive leading system messages through top-level `system`.
- AI SDK `messages` no longer include leading system messages.
- Blank leading system messages are ignored.
- Later system messages remain in `messages` and are rejected by `allowSystemInMessages: false`.
- Existing agent context builder tests continue to assert internal `[system, ...history, user]` request construction.

## Non-Goals

- Do not refactor upstream context builders or public `ChatMessage` types.
- Do not suppress the warning with `allowSystemInMessages: true`.
- Do not change prompt section order or compaction summary placement.
