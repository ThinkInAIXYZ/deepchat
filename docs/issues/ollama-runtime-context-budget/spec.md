# Ollama Runtime Context Budget

Status: implemented and validated.

GitHub issue: [#2161](https://github.com/ThinkInAIXYZ/deepchat/issues/2161)

## Issue

DeepChat treats Ollama's model metadata `context_length` as the context available to the active
runner. That value describes the model's theoretical window. Ollama may allocate a much smaller
runtime window based on configuration and available memory, and its OpenAI-compatible endpoint
silently truncates an oversized prompt instead of returning a context-overflow error.

In the reported case, model metadata advertised 262,144 tokens while `ollama ps` and the runner
reported 8,192. DeepChat therefore sent a roughly 9,200-token Agent prompt with a 4,096-token output
budget. Ollama retained only about 4,098 input tokens from the right, removing early instructions
and conversation context before the tool-result continuation.

## Required Behavior

- Keep theoretical model context and currently allocated runtime context as separate facts.
- Read runtime context only from a non-loading provider operation. For Ollama, use `ps()` and its
  top-level `context_length`; never infer an allocation from `show()`.
- Before each DeepChat Agent provider round, constrain the existing context budget to the minimum
  of the configured context, a current runtime limit, and any provider limit learned from an
  explicit overflow.
- Bind provider prompt-usage anchors to the effective context budget. If a runner limit appears or
  changes between rounds, discard usage measured under the previous budget and measure the full
  provider-visible prompt again.
- A larger user context setting must not override a smaller observed runtime limit.
- Do not cache a runtime limit as a monotonic context-window observation. A runner can unload or be
  reloaded with a different allocation during the same Session.
- If the model is not running, the runtime query fails, or its value is invalid, report no runtime
  limit and preserve existing request behavior. The query must not load or reconfigure the model.
- Bound the runtime query so a diagnostics failure does not add unbounded pre-stream latency.

## Compatibility And Non-goals

- Do not change Ollama's `num_ctx`, `OLLAMA_CONTEXT_LENGTH`, Modelfile, or runner lifecycle.
- Do not move Ollama requests from the OpenAI-compatible API to the native API.
- Preserve theoretical context metadata for model settings and discovery.
- Preserve existing context-overflow learning and compaction behavior for every provider.
- A runner that is not loaded exposes no truthful runtime allocation. This change does not invent
  an 8K fallback; after the first request loads the model, the next Agent round can observe and
  enforce the allocation.

## Acceptance Criteria

1. An Ollama running model with theoretical context 262,144 and runtime context 8,192 exposes both
   values without allowing `show()` metadata to replace the runtime fact.
2. A DeepChat Agent request configured above 8,192 uses 8,192 as its total context budget and fits
   messages before calling the provider.
3. Runtime context is refreshed for later provider rounds and can increase, decrease, or disappear
   without retaining a stale Session-local hard limit.
4. A first-round usage snapshot produced before the runner is observable cannot hide an oversized
   second-round prompt after the runtime limit becomes available.
5. Missing models, malformed context values, `ps()` failures, and query timeout do not block the
   provider request or load a model.
6. Non-Ollama providers retain their existing behavior.

## Task Checklist

- [x] Separate Ollama theoretical and runtime context facts.
- [x] Add a non-loading provider runtime-limit query.
- [x] Apply the current runtime limit through the existing Agent context budget.
- [x] Invalidate provider usage anchors when their effective context budget changes.
- [x] Add focused provider, context-coordinator, and Agent regressions.
- [x] Run formatting, i18n, lint, type checking, and relevant tests.
- [x] Complete the pre-commit review and validation record.

## Validation

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm exec vitest run --config vitest.config.ts test/main/agent/deepchat/loop/contextCoordinator.test.ts test/main/provider/ollamaProvider.test.ts`
- `pnpm exec vitest run --config vitest.config.ts test/main/agent/deepchat/loop/contextCoordinator.test.ts test/main/agent/deepchat/harness/deepChatAgentHarness.test.ts`
- `pnpm run test:main`
