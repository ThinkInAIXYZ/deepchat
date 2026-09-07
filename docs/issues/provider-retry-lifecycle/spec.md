# Provider Retry Lifecycle And Attempt Provenance

## Issue

DeepChat currently treats every provider stream invocation as a provider round. It does not own an
explicit transient retry lifecycle, relies on provider SDK defaults in some paths, and records only
part of the identity needed to distinguish a logical model round from repeated physical requests.
Consequently, a retry can consume the wrong round budget, become impossible to diagnose after the
run, or be replayed after output has already become externally observable.

## Impact

- Transient provider failures that occur before usable output terminate runs even when replay is
  safe, while AI SDK retries may happen invisibly outside DeepChat's lifecycle and Tape.
- `maxProviderRounds` can be consumed by physical requests and the stored counter can advance to
  `limit + 1`, so metadata does not describe the logical loop that users actually ran.
- Abort cannot consistently interrupt provider setup, SDK requests, or retry backoff across all
  provider implementations.
- Provider errors are flattened into strings, losing retry signals or risking unsafe persistence if
  callers compensate by retaining raw error objects.
- Tape and message traces cannot identify which physical attempt produced a result, and trace replay
  can select an older failed attempt for the same request payload.
- Retrying after projected text, reasoning, tool lifecycle, permission, image, plan, or rate-limit
  output could duplicate user-visible effects.

## Root Cause

1. `DeepChatContextCoordinator` owns payload construction, rate gating, provider streaming,
   projection, abort, context recovery, and Tape outcomes, but provider retry is not modeled there.
2. `LoopRun.providerRoundCount` and `StreamState.providerRoundCount` represent overlapping counters;
   the latter is incremented per invocation and used for the public round limit.
3. `requestSeq` is currently used as both payload identity and physical-attempt identity. Trace
   callbacks can also read its later mutable value instead of the identity of the request they
   observed.
4. Provider stream ports do not uniformly accept the Run `AbortSignal`, and AI SDK chat streams do
   not explicitly disable the SDK's own retry policy.
5. Stream errors expose only display text, so structured retry classification is unavailable at the
   retry owner.

## Fix Design

### Identity And Budgets

- `logicalRound` identifies one model response and its tool settlement cycle.
- `requestSeq` identifies one immutable provider payload and ViewManifest.
- `physicalAttempt` identifies an actual send of that request, starting at one for each request.
- A transient retry preserves `logicalRound` and `requestSeq`, increments `physicalAttempt`, and
  shares a budget of at most two transient retries across the logical round.
- Context recovery changes the payload, increments `requestSeq`, and resets `physicalAttempt`
  without consuming the transient retry budget.
- A tool loop increments both `logicalRound` and `requestSeq`.
- Remove the duplicate stream-state round counter. Keep public `metadata.providerRounds` and
  `maxProviderRounds` names for compatibility, but define them strictly in terms of logical rounds.
  Resume restores the logical round from existing metadata.
- Check the round limit before starting the next logical round so persisted metadata never reaches
  `limit + 1`.

### Retry Ownership And Policy

`DeepChatContextCoordinator.streamProviderAttempts` is the sole transient retry owner because it is
the narrowest component that owns the immutable payload, ViewManifest, provider rate gate, Run
signal, projection boundary, context recovery, and Tape outcome.

The policy is internal and fixed for this change:

- at most two transient retries per logical round;
- exponential backoff starting at 500 ms and capped at 8 seconds;
- 0-25% downward jitter, which never delays beyond the computed exponential value;
- a valid server `Retry-After` value takes precedence, capped at 60 seconds;
- a server delay above 60 seconds rejects transparent retry instead of requesting early;
- every retry re-enters the provider rate gate;
- backoff and rate waits remain abortable.

Failure classification uses this precedence:

1. cancelled Run signal: `aborted`;
2. context overflow: `context_overflow`;
3. authentication, billing/quota, invalid request, model-not-found, or content-filter failure:
   `permanent`;
4. AI SDK retryable errors, HTTP 408/409/429/5xx, or recognized network/timeout codes:
   `transient`;
5. unresolved bounded cause-chain and text fallback: `unknown`, which is not retried.

### Replay Boundary And Stream Settlement

Transparent replay is allowed only before `outputCommitted`, defined as the first semantic event
projected into the run. Text, reasoning, tool lifecycle, permission, image, plan, and provider
rate-limit events commit output. Usage, stop, and error are control events and may be buffered until
the retry decision is final.

- Do not project an error event before deciding that the attempt will not be retried.
- End-of-stream without a stop event and without semantic output is a transient premature EOF.
- End-of-stream after partial semantic output is an incomplete-stream failure and is never
  transparently retried; preserve the partial output.
- Context-overflow recovery continues through the existing compaction and strict-trim path. It is
  not a transient retry and may create a new request payload.
- Aggregate checked usage from failed attempts and the final attempt into message metadata so the
  recorded logical round reflects actual provider consumption. Tape retains per-attempt usage.

### Provider Boundary And Safe Errors

- Add an optional `{ signal }` option to `ProviderRuntimePort.streamChat`,
  `BaseLLMProvider.coreStream`, and every implementation. Propagate the Run signal through AI SDK,
  Ollama, GitHub Copilot, Voice, and ACP provider paths.
- Explicitly set AI SDK chat streaming to `maxRetries: 0`. Explicitly retain `maxRetries: 2` for
  one-shot text and embedding calls. Image, video, TTS, and ACP do not gain transparent replay.
- Extend `ErrorStreamEvent` with optional serializable failure metadata containing only
  `statusCode`, `code`, `retryable`, and allowlisted retry headers. Never pass or persist raw
  request data, response bodies, stacks, complete headers, or raw error objects.

### Diagnostics And Provenance

- Add a narrow typed observer for `retry_scheduled`, `retry_started`, and `retry_finished`. It is
  for structured diagnostics only, does not enter the renderer event bus, and is not a durable
  source of truth.
- Write `provider/attempt_completed` as Tape schema v2 while continuing to read schema v1. V2 adds
  `logicalRound`, `physicalAttempt`, `requestOrigin`, `attemptOrigin`, `failureClassification`,
  `retryDecision`, nullable `httpStatus`, nullable `errorCode`, and nullable `retryDelayMs`.
- Use `requestSeq + physicalAttempt` as attempt provenance. Tape `source.seq` remains requestSeq.
- Transient retries reuse the existing ViewManifest. Context recovery writes a new manifest because
  it creates a new payload.
- Add nullable `logical_round` and `physical_attempt` columns through SQLite migration v45. Existing
  rows remain null, and ACP traces remain valid.
- Create DeepChat trace contexts per physical attempt and capture immutable identity. Never resolve
  identity by reading a later mutable `LoopRun.requestSeq`.
- Sort trace queries stably by request sequence, physical attempt, and creation time in descending
  order. Replay selects the newest physical attempt for a requested sequence.
- Expose nullable identity fields on `MessageTraceRecord` and replay trace snapshots without
  changing existing route input contracts.

## Compatibility And Non-Goals

- Existing public setting and metadata field names remain unchanged. No Session or UI retry setting
  is introduced.
- Tape schema v1 remains readable; SQLite migration is additive and old message traces remain valid.
- Existing ACP trace records continue to use null attempt identity when no DeepChat identity exists.
- The retry observer is diagnostic only and must not become renderer state or another durable fact.
- This change does not add session-level retry that deletes assistant errors and replays a complete
  round, nor does it adopt streaming recovery that projects an error before replay.
- Same-run steering, tool parallelism, Harness facade extraction, hook reducers, and broad
  coordinator decomposition are outside this issue.
- No GitHub issue is created or synchronized for this local change.

## Acceptance Criteria

1. A retryable throw, buffered error event, or premature EOF before output can retry at most twice
   with abortable backoff and rate gating; unknown and permanent failures do not retry.
2. Once semantic output is projected, a later error or premature EOF preserves partial output and
   never replays the request.
3. Context recovery does not consume logical-round or transient-retry budget, and a new payload gets
   a new request sequence with physical attempt reset to one.
4. Tool continuation increments logical round and request sequence; round limits never persist
   `limit + 1`, and resume restores the prior logical-round count.
5. Usage from every physical attempt is checked and aggregated into message metadata while Tape
   records each attempt separately.
6. Retry diagnostics are ordered and include immutable attempt identities without changing renderer
   events or durable ownership.
7. Every provider stream path accepts the Run signal, AI SDK chat streaming has no hidden retries,
   and non-chat calls retain their explicitly documented behavior.
8. Failure metadata remains serializable and allowlisted, with no request body, response body,
   stack, raw error, or unrestricted headers.
9. Tape v1 and v2, migration v45, trace ordering, and replay selection remain backward compatible.

## Tasks

- [x] Model logical-round and physical-attempt identity in the loop and persistence contracts.
- [x] Add Tape v2 provenance and backward-compatible readers.
- [x] Add migration v45 and immutable trace identity, ordering, and replay selection.
- [x] Propagate Run cancellation and safe failure metadata through all provider stream ports.
- [x] Disable hidden chat-stream retries while preserving explicit one-shot policies.
- [x] Implement failure classification, replay boundary, retry policy, usage aggregation, and
  diagnostic observer.
- [x] Add focused coverage for retry policy, stream settlement, context recovery, limits, resume,
  provider boundaries, Tape compatibility, and trace migration/replay.
- [x] Run targeted tests, main tests, agent evals, formatting, i18n, lint, and type checking.
- [x] Review each staged commit for side effects, compatibility, boundaries, performance, security,
  naming, coverage, and maintenance cost.

## Validation

```bash
pnpm exec vitest run --config vitest.config.ts <targeted-files>
pnpm run test:main
pnpm run test:agent:eval
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
```

The read-only baseline on 2026-07-24 passed five test files and 96 tests. Another 22 tests were
skipped because the local SQLite native module was unavailable, including the message-trace table
suite. Final validation must report whether that environment limitation remains.

Final validation on 2026-07-24:

- targeted retry, runtime, provider, Tape, and trace suites: 22 files passed, 1 skipped; 790 tests
  passed, 24 skipped;
- main-process suite: 413 files passed, 19 skipped; 4,802 tests passed, 239 skipped;
- native-agent evaluations: 15 tests passed;
- formatting, i18n validation, lint, and node/web type checking passed;
- the local SQLite native module remained unavailable, so the native message-trace suites were
  still skipped.
