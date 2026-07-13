# Context Overflow Auto-Handoff Spec

## Problem

When a provider rejects a request after DeepChat's local budget preflight, the first streamed event
can be a context-window error such as "input exceeds the context window". Today that event reaches
`processStream`, is persisted as an assistant error, and users see the provider's raw red error.

This is especially visible when local estimates differ from a provider tokenizer or when provider
schemas/system prompts are counted differently by the upstream API.

## Goal

Recover from provider-side context overflow before any output is shown, using DeepChat's existing
tape, rolling summary, summary cursor, and view manifest flow. The behavior should mirror the Bub
`auto_handoff/context_overflow` pattern, where an overflow is treated as an automatic handoff point,
without adding a Bub or tape.systems dependency.

## Acceptance Criteria

- Provider context overflow thrown before the first stream event triggers one automatic recovery and
  retry.
- Provider context overflow delivered as the first stream event triggers one automatic recovery and
  retry without persisting that error event.
- Provider context overflow after any streamed content, tool call, permission request, image, usage,
  or stop event does not retry.
- With auto compaction enabled, recovery creates an `auto_handoff/context_overflow` compaction anchor,
  updates rolling summary state, rebuilds the system prompt, and retries.
- With auto compaction disabled, recovery does not call the summary LLM or write compaction anchors;
  it only uses deterministic request trimming and max-token shrink before retrying.
- Retry performs a fresh preflight and never sends a request that DeepChat already knows cannot fit.
- If the retry still fails with a context-window error before any provider output, DeepChat returns
  local budget guidance instead of showing the provider's raw context-window error.
- A local preflight recovery and a provider overflow recovery share the same assistant-run recovery
  budget; once preflight recovery has compacted or trimmed the request, provider overflow may only
  trigger a summary-free strict trim retry.
- The `auto_handoff/context_overflow` anchor is written at most once per assistant run.
- Context-window detection must not classify quota, billing, or rate-limit failures as context
  overflow.
- Context-window detection scans SDK `Error` custom fields such as `body` and `response` without
  losing the recursion and text-size guards.
- Context-window detection scans bounded array-shaped provider error fields such as `errors[]` and
  `issues[]` without changing quota, billing, rate-limit, or `429` exclusion semantics.
- Context-window detection does not treat generic `input exceeds` failures such as file-size or
  upload-limit errors as context overflow unless token/context-pressure wording is also present.
- Provider retry failure diagnostics distinguish local over-budget requests from provider tokenizer
  disagreement after DeepChat already compacted or trimmed the request.
- View manifests record the actual per-attempt token budget, including strict retry max-token shrink
  and strict retry extra reserve.
- Video generation models detected by model id keep bypassing DeepChat chat context budgeting.
- Large wrapped provider errors cannot hide a later context-window field behind a long unrelated
  message field.
- Memory is not a trigger. Memory only affects optional system prompt injection and optional
  extraction after a successful compaction.
- ACP, image, video, and TTS paths that bypass DeepChat's chat context budget keep their current
  behavior.

## Constraints

- No database schema, IPC route, or public configuration field changes.
- No deletion of stored messages as part of recovery.
- Automatic recovery is limited to once per assistant run.
- Provider error matching is implemented with a shared main-process classifier.

## Non-Goals

- Replacing DeepChat's compaction implementation with Bub or tape.systems.
- Changing Memory storage, recall, injection, or extraction semantics.
- Exact provider tokenizer parity.
