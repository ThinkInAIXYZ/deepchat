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
- Before turn prompt/history assembly when the runner is already observable, and again before
  later DeepChat Agent provider rounds, constrain the existing context budget to the minimum of
  the configured context, a current runtime limit, and any provider limit learned from an explicit
  overflow.
- Query once before turn assembly and once before each later provider round. Do not repeat the
  pre-turn query immediately at the first provider dispatch.
- Use that same effective budget for output capping, prompt/Skill-catalog assembly, initial and
  resume compaction, provider pressure recovery, Tape resume Views, and tool-result fitting. Do not
  defer the runtime fact until the final provider preflight.
- Bind provider prompt-usage anchors to the effective context budget. If a runner limit appears or
  changes between rounds, discard usage measured under the previous budget and measure the full
  provider-visible prompt again.
- A larger user context setting must not override a smaller observed runtime limit.
- Do not cache a runtime limit as a monotonic context-window observation. A runner can unload or be
  reloaded with a different allocation during the same Session. A successful query that reports a
  new allocation replaces the prior value, and a successful query that confirms the model is not
  running clears it.
- A transient query failure is not evidence that the runner unloaded. During an active Run, retain
  the last successfully observed limit until a successful `ps()` response replaces or clears it,
  and report at most one warning per consecutive failure streak.
- Rebuild prompt assembly when the effective runtime budget either decreases or increases so a
  larger reloaded runner restores eligible system and Skill-catalog content.
- Bound each runtime query to 400 ms so diagnostics add only bounded pre-stream latency. The query
  must not load or reconfigure the model.

## Compatibility And Non-goals

- Do not change Ollama's `num_ctx`, `OLLAMA_CONTEXT_LENGTH`, Modelfile, or runner lifecycle.
- Do not move Ollama requests from the OpenAI-compatible API to the native API.
- Preserve theoretical context metadata for model settings and discovery.
- Preserve existing context-overflow learning and compaction behavior for every provider.
- Runtime `context_length` discovery requires Ollama v0.9.7 or newer. Older versions do not expose
  the allocation through `/api/ps`; diagnose that unsupported response and preserve existing
  request behavior when no prior successful runtime observation exists.
- A runner that is not loaded exposes no truthful runtime allocation. This change does not invent
  an 8K fallback or load the model as a side effect; after the first request loads the model, the
  next Agent round can observe and enforce the allocation. A cold first request therefore retains
  the provider's existing behavior until Ollama exposes a runtime fact.
- If the system prompt, current user input, and open tool-call/result protocol themselves exceed
  the observed physical window, fail before the provider request. DeepChat must not drop protected
  content or knowingly delegate left truncation to Ollama.

## Acceptance Criteria

1. An Ollama running model with theoretical context 262,144 and runtime context 8,192 exposes both
   values without allowing `show()` metadata to replace the runtime fact.
2. A DeepChat Agent request configured above 8,192 uses 8,192 for turn assembly, compaction,
   provider preflight, pressure recovery, and tool-result fitting while retaining the theoretical
   configured context as model metadata.
3. Runtime context is refreshed for later provider rounds and can increase, decrease, or disappear.
   Prompt assembly follows both increases and decreases; only a successful response can replace or
   clear the last limit during an active Run.
4. A first-round usage snapshot produced before the runner is observable cannot hide an oversized
   second-round prompt after the runtime limit becomes available.
5. Missing models do not load a model. Malformed or unsupported context values, `ps()` failures,
   and query timeout add at most 400 ms per observation and do not discard a prior successful limit.
6. Non-Ollama providers retain their existing behavior.
7. A continuation containing the current user task and a complete tool call/result pair reduces
   its output reserve to fit 8,192 without discarding those protected messages.
8. Protected input that physically exceeds 8,192 fails before Ollama is called instead of being
   silently left-truncated.

## Task Checklist

- [x] Separate Ollama theoretical and runtime context facts.
- [x] Add a non-loading provider runtime-limit query.
- [x] Apply the current runtime limit through the existing Agent context budget.
- [x] Propagate the effective limit through turn assembly, pressure recovery, and tool-output
  fitting.
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
- `pnpm exec vitest run --config vitest.config.ts test/main/agent/deepchat/runtime/process.test.ts`
- `pnpm exec vitest run --config vitest.config.ts test/main/agent/deepchat/loop/contextCoordinator.test.ts test/main/agent/deepchat/harness/deepChatAgentHarness.test.ts`
- `pnpm run test:main`
