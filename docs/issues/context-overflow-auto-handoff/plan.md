# Context Overflow Auto-Handoff Plan

## Approach

Add a provider-call wrapper inside `runStreamForMessage` around the provider `coreStream`. The
wrapper will keep the existing local preflight, detect context-window failures before any provider
output is yielded to `processStream`, recover the request once, and retry with a rebuilt request view.

## Implementation

- Add `contextWindowError.ts` with `isContextWindowErrorLike(value: unknown): boolean` and use it
  from both `process.ts` and the provider wrapper.
- Preserve local request preflight before provider calls.
- Track whether any provider event has been yielded. If the provider throws a matching context
  overflow before that point, recover and retry. If the provider's first event is a matching error
  event, recover and retry without yielding it.
- Keep every event after the first yielded event non-recoverable, including content, reasoning, tool
  call, permission, usage, image, rate limit, stop, and later errors.
- Reuse `recoverRequestContextPressure` for auto-compaction recovery. When it returns no compaction
  intent because auto compaction is disabled, keep the existing deterministic fit/max-token shrink
  path and retry without summary generation.
- Re-run preflight after recovery. If the request still does not fit, throw
  `buildRequestContextOverflowErrorMessage`.
- If the post-recovery retry still returns or throws a context-window error before any output, throw
  a local DeepChat diagnostic instead of yielding the provider error. Use
  `buildRequestContextOverflowErrorMessage` only when the fresh retry preflight still does not fit;
  otherwise explain that the provider still reported context overflow after recovery despite
  DeepChat's local estimate fitting.
- Treat local preflight recovery and provider overflow recovery as one assistant-run recovery
  budget. If preflight recovery has already run, a provider overflow can only schedule one
  summary-free strict trim retry; it must not run summary handoff again.
- Keep context-window matching strict enough to avoid quota, billing, and rate-limit false positives;
  only generic token-limit wording may match when accompanied by request/context/input/prompt
  wording.
- Keep `input exceeds` behind stronger token/context-pressure hints so unrelated input-size or upload
  errors do not trigger context overflow recovery.
- Scan wrapped provider error fields by priority and stop on the first match so a long unrelated
  field cannot hide a later context-window field.
- Continue scanning SDK `Error` instances after `message`, `name`, and `cause` so custom fields such
  as `body` and `response.data.error.message` can trigger recovery.
- Scan array-shaped provider error payloads with a small fixed element cap. Include common
  `errors` and `issues` fields while keeping existing quota, billing, rate-limit, and `429`
  exclusion behavior unchanged.
- Cap strict retry's extra reserve at 8,192 tokens while preserving the existing max-token shrink.
- Persist view manifests with the actual per-attempt budget. Strict retry manifests record the
  halved/capped requested max tokens and include the strict extra reserve in `reserveTokens`.
- Pass the request model id into DeepChat budget bypass detection so video-generation model-id
  heuristics remain effective.
- Continue calling Memory injection after successful compaction recovery through the existing system
  prompt rebuild path. Continue calling Memory extraction only when a compaction intent was actually
  applied.

## Compatibility

- No schema, IPC, route, or public setting changes.
- Existing tape anchor name `auto_handoff/context_overflow` is reused.
- Existing stored messages are not deleted; recovery only changes the request view and summary cursor.
- Auto compaction disabled remains respected for summary generation, while still allowing deterministic
  trim retry as a hard fallback.

## Tests

- Add classifier coverage for common provider messages.
- Add classifier negative coverage for quota, billing, TPM/RPM, rate-limit, and generic token-quota
  failures.
- Add agent runtime coverage for first-event context overflow recovery, thrown context overflow
  recovery, post-output overflow non-retry, auto-compaction-disabled trim retry, oversized local
  request blocking, and ACP/image bypass.
- Add retry-failure coverage proving a second pre-output context overflow returns DeepChat local
  budget guidance and does not perform a third provider call.
- Add video model-id bypass coverage for models such as `sora-*`.
- Add an agent-runtime test path that uses the real `processStream` to verify persisted assistant
  errors do not contain provider raw context-window text.
- Add regression coverage for preflight recovery followed by provider overflow, proving no second
  summary handoff occurs and only one strict trim retry is allowed.
- Add classifier coverage for SDK `Error` objects with nested `response`/`body` fields.
- Add classifier coverage for bounded `errors[]` / `issues[]` provider payloads.
- Add classifier coverage proving generic `input exceeds` file-size or upload-limit failures do not
  match.
- Add manifest coverage for strict retry token budget fields.
- Preserve process-stream behavior for context overflow errors that are not intercepted by the
  provider wrapper.
