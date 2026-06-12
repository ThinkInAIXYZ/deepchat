# Image Generation Context Budget Bypass Spec

> Status: Draft
> Date: 2026-05-18

## Background

DeepChat Agent applies a chat-oriented provider-call context preflight before sending model
requests. The check estimates message tokens, tool schemas, and output tokens, then blocks requests
that cannot fit inside the configured model context window.

That check is valid for chat models, but image generation and other non-chat routes do not use the
same request shape. Image requests can therefore fail before reaching the provider with:

`Request was not sent because it cannot fit within the model context window after applying the safety margin.`

## Goals

- Only apply DeepChat's chat context budget to chat model requests.
- Skip the chat budget preflight, compaction recovery, and temporary max-token shrink for explicit
  image generation and other non-chat model routes.
- Preserve current behavior for chat models and ACP provider bypasses.

## Acceptance Criteria

- Image generation models or image endpoints reach the provider even when chat-budget estimation
  would fail.
- Non-chat requests do not trigger the DeepChat context-pressure compaction path solely because of
  chat message/tool-schema estimates.
- Non-chat request max tokens are not reduced by the chat preflight safety margin.
- Chat models keep the existing preflight, recovery, and overflow failure behavior.
- Existing legacy model configs without explicit type or endpoint metadata continue to be treated as
  chat requests.
- No public API, IPC, schema, or renderer UI changes are introduced.

## Non-Goals

- Redesign image generation request construction.
- Change the agent image generation tool behavior for chat models.
- Change `contextBudget.ts` budgeting math.
- Add renderer UI for non-chat routing diagnostics.
