# Memory Provider Text Cancellation

## Issue

`MemoryProviderGateway` creates and forwards an `AbortSignal` for every text-generation request,
but the production composition root drops that signal before calling
`ILlmProviderPresenter.generateText`. The presenter and provider-level `generateText` contracts do
not currently accept a caller signal, so an outer Memory deadline or lifecycle abort can return
promptly while the underlying provider request continues running.

## Impact

- Cancelled or expired Memory text requests can continue consuming network and provider resources.
- Gateway capacity remains reserved until the uncancelled provider Promise eventually settles.
- Repeated slow requests can exhaust the per-key or global unsettled-request limits even though
  callers already observed cancellation.
- Existing generation fences prevent late results from committing, so this is a resource-lifetime
  defect rather than a stale-write defect.

## Root Cause

- The production Memory provider binding accepts only three arguments for `generateText` and drops
  the gateway's fourth `signal` argument.
- `ILlmProviderPresenter.generateText` and `BaseLLMProvider.generateText` have no caller-cancellation
  option.
- Provider implementations use model-level timeouts where available, but do not combine them with
  the Memory caller signal.
- Gateway unit tests stop at a mocked dependency and therefore do not cover the composition and
  transport boundaries where the signal is lost.

## Review Findings

The first implementation propagated the signal but exposed additional lifecycle defects:

- ACP standalone requests share a conversation-scoped session and replace its hooks. Passing a
  request-scoped signal into that shared session allows one request to cancel or detach another.
- ACP returns from a caller abort before the original `session/prompt` request settles, so Memory
  gateway capacity can be released while the ACP turn is still running.
- GitHub Copilot's primary Device Flow token exchange does not receive the caller signal and can
  fall back to a second credential request after cancellation.
- Replacing AI SDK's positional `systemPrompt` argument with an options object silently drops the
  prompt for untyped or out-of-tree callers using the old concrete-provider API.
- VoiceAI creates timeout/listener state before validation paths that can throw outside its cleanup
  boundary. AI SDK media transports need equivalent cleanup and active-abort coverage.

## Fix Plan

- Add an optional trailing `{ signal?: AbortSignal }` option to
  `ILlmProviderPresenter.generateText` and forward it into a provider-level options object.
- Add a named AI SDK provider option so `systemPrompt` and `signal` share one extensible internal
  contract, while retaining a deprecated runtime-compatible positional `systemPrompt` overload.
- Extract the Memory LLM bindings from the application composition root and test exact signal
  forwarding for rate-limit admission, embeddings, dimensions, and text generation.
- Pass the existing compaction signal into `generateText` while retaining its defensive outer abort
  race.
- Propagate caller cancellation through AI SDK/Ollama, GitHub Copilot, VoiceAI, and ACP transports.
  Combine it with existing model timeouts without changing which source wins or how timeout errors
  are classified.
- Preserve the gateway invariant that capacity is released only when the provider Promise settles;
  never decrement capacity merely because the outer deadline or abort race completed.
- Serialize ACP standalone turns per reused session with an abort-aware FIFO owner queue. Only the
  active owner may install session hooks or cancel a prompt; queued aborts leave the session alone.
- After an ACP prompt is dispatched, send protocol cancellation promptly but retain ownership and
  consume late events until the original prompt Promise settles. Cancel pending and late permission
  requests without surfacing them to the user.
- Keep the generic provider text options signal-only. Add an AI SDK-specific options type and a
  deprecated runtime-compatible overload for the old positional `systemPrompt` argument.
- Propagate cancellation into the GitHub Device Flow token fetch and prevent fallback after abort.
- Extend cleanup boundaries so every timer and caller-signal listener is disposed on validation,
  setup, transport, polling, and download failures.

## Constraints

- No renderer behavior, route, database, persisted schema, or IPC wire-format changes.
- New API parameters remain optional, so existing callers keep their current behavior.
- Memory cancellation, deadline, and capacity error codes remain unchanged.
- Late provider results and rejections remain absorbed and cannot commit side effects.
- Providers or upstream SDKs that genuinely ignore cancellation may still settle late and retain
  capacity until then.
- ACP standalone calls keep the existing per-model session/process reuse. They are serialized
  rather than moved to per-request sessions or processes.

## Tasks

- [x] Document the issue, constraints, and acceptance criteria.
- [x] Add and forward the presenter/provider `generateText` cancellation options.
- [x] Extract and test production Memory provider bindings.
- [x] Propagate cancellation through every in-tree provider implementation.
- [x] Pass the existing compaction signal into text generation.
- [x] Add composition, transport, timeout-composition, and capacity regression tests.
- [x] Add ACP standalone ownership and prompt-drain semantics.
- [x] Restore AI SDK positional `systemPrompt` compatibility and narrow generic option naming.
- [x] Propagate Device Flow cancellation and close VoiceAI/media cleanup gaps.
- [x] Add review regression tests for ACP, compatibility, Device Flow, cleanup, TTS, and video.
- [x] Run formatting, i18n validation, typecheck, focused and full main tests, and lint.

## Validation

- [x] The production Memory text binding forwards the gateway's exact signal.
- [x] A pre-aborted signal prevents a provider transport request from starting.
- [x] Aborting an active request reaches the in-tree transport or ACP cancel operation promptly.
- [x] Caller cancellation and model timeout coexist, with the first source winning.
- [x] Signal-aware provider settlement releases gateway capacity; a provider that ignores abort
  continues to retain capacity until settlement.
- [x] Memory deadline/abort classification and late-result side-effect fencing remain unchanged.
- [x] Compaction still returns promptly and never persists a late summary after cancellation.
- [x] Concurrent ACP standalone requests cannot replace or cancel each other's session hooks.
- [x] ACP provider and gateway capacity remain occupied until the dispatched prompt settles.
- [x] Queued ACP requests can abort without opening or mutating the shared session.
- [x] Device Flow token exchange receives the exact request signal and does not fall back after
  cancellation.
- [x] Legacy positional AI SDK system prompts and the new options form produce identical prompts.
- [x] Validation and media-route failures leave no request timer or caller-signal listener behind.

## Verification

- Focused Vitest: 12 files and 163 tests passed.
- `pnpm run typecheck:node`: passed.
- `pnpm run test:main`: 369 files and 4201 tests passed; 15 files and 196 tests skipped by existing
  suite conditions.
- `pnpm run format` and `pnpm run format:check`: passed.
- `pnpm run i18n`: passed with no missing keys or invalid translations.
- `pnpm run lint`: passed, including agent cleanup and architecture guards.
- `git diff --check`: passed.

## GitHub

No GitHub issue sync was requested.
