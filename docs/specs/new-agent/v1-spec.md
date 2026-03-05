# New Agent Architecture v1 — Multi-Turn Context Assembly

## Overview

v0 proved the new agent architecture end-to-end but sends only the latest user message to the LLM — no conversation history, no system prompt. Every message starts a fresh, context-free conversation. v1 adds multi-turn context assembly so the LLM sees the full conversation history within token limits.

## Goals

1. **System prompt injection** — prepend the user's configured default system prompt to every LLM call
2. **Conversation history** — include all prior sent messages in the LLM context
3. **Context window truncation** — drop oldest user+assistant pairs when history exceeds available tokens

## Non-Goals (deferred)

- Tool calling context (v2)
- `is_context_edge` usage (future)
- Per-session system prompts (future)
- Vision/image content in messages (future)
- Streaming context or partial messages

## Data Model

No new DB tables or columns. Reuses existing:
- `deepchat_messages` table — fetch prior messages by session
- `configPresenter.getDefaultSystemPrompt()` — system prompt retrieval
- `ModelConfig.contextLength` — context window size

## Context Assembly Algorithm

1. Fetch all messages for session via `messageStore.getMessages(sessionId)`
2. Filter to `status === 'sent'` only (skip pending/error messages)
3. Exclude the just-inserted new user message (it hasn't been marked sent yet — it's the latest with status 'sent' but we pass `newUserContent` explicitly)
4. Convert each `ChatMessageRecord` → `ChatMessage`:
   - **User**: parse JSON `UserMessageContent`, extract `.text`
   - **Assistant**: parse JSON `AssistantMessageBlock[]`, concatenate text from `content` and `reasoning_content` blocks
5. Apply truncation to fit within token budget
6. Prepend system prompt (if non-empty): `{ role: 'system', content }`
7. Append new user message: `{ role: 'user', content: newUserContent }`

## Truncation Strategy

1. Calculate: `available = contextLength - systemPromptTokens - newUserMessageTokens - reserveForOutput`
2. Sum tokens of all history messages using `approximateTokenSize` from `tokenx`
3. If total exceeds `available`, drop oldest messages from the front until it fits
4. Return trimmed history

Reserve for output: use `maxTokens` from model config to ensure the model has room to respond.

## Acceptance Criteria

- [ ] Multi-turn works: LLM sees prior messages in conversation
- [ ] System prompt injected as first message when non-empty
- [ ] System prompt omitted when empty string
- [ ] Truncation drops oldest messages when history exceeds available tokens
- [ ] Error/pending messages excluded from context
- [ ] Assistant blocks concatenated correctly (content + reasoning_content)
- [ ] `pnpm run typecheck` passes
- [ ] All tests pass
- [ ] `pnpm run lint && pnpm run format` passes
