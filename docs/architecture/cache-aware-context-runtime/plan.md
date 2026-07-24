# Cache-Aware Context Runtime Implementation Plan

## Provider Cache Transport

Introduce `PromptCacheIntent` at the AI SDK runtime boundary. Streaming conversation calls pass
`conversation`; `runAiSdkGenerateText` passes `isolated`. Prompt-cache planning returns no key,
breakpoint, or sticky identifier for isolated calls.

Keep official provider mappings in the provider-options mapper. OpenAI receives its hashed cache
key and Anthropic receives its top-level automatic cache directive. Bedrock receives a
message-level `bedrock.cachePoint`. Leading system messages with provider options remain structured
AI SDK instructions; the existing joined-string representation remains for metadata-free system
messages.

For OpenRouter and Zenmux, place a private cache directive in the adapter-specific top-level
provider options only when explicit caching is supported. Configure the OpenAI-compatible
provider's `transformRequestBody` to consume and remove that directive, find the last reusable
text block before the final user-owned active turn, and apply `cache_control`. Partial assistant
continuations and tool-loop messages therefore remain outside the reusable prefix. The OpenRouter
transform also emits the hashed conversation key as `session_id` for fixed Claude models.
Wire-capture tests use the real installed adapters and a local fetch stub.

## Context Projection

Replace string-based post-compaction prompt assembly with structured contributions:

- base system instructions;
- zero or more checkpoint sections with source anchor identifiers and content hashes;
- an optional Memory contribution with its existing selection manifest and persisted anchor ID.

The context builder owns role placement and token accounting. It emits one synthetic user
checkpoint before history. For a new turn it prefixes the Memory section inside the current user
message and leaves the original request last. For resume it prefixes the owner user message of the
target assistant. The projection returns parallel synthetic-contribution provenance for
ViewManifest assembly. Initial selection applies the same provider safety margin as final request
preflight so the selection and transmitted history remain identical.

The loop carries that provenance through provider attempts. System refresh changes only the first
system message. Context-pressure recovery rebuilds the checkpoint from the new summary while
reusing Memory. Fitting protects the base system, checkpoint, and active turn; it first removes
Memory and then removes old complete history turns.

Remove the composed system-prompt cache, its incomplete fingerprint, and the internal
system-cache invalidation contract. Continue using the existing bounded Skill and AGENTS source
caches. Keep the tool-profile cache and rename internal invalidation paths so their names describe
the remaining behavior.

## Compaction

Replace a fixed protected-turn slice with a reusable retained-tail selector. It traverses
`HistoryTurn` values from newest to oldest, preserving whole turns until both the configured
minimum and calculated token target are reached. Resume provides the target turn as mandatory and
applies the configured minimum to preceding turns. Manual compaction passes a zero target and zero
minimum.

Add retained turn count, estimated tokens, and target tokens to `CompactionIntent` and the
append-only summary anchor state. These are diagnostics only and do not participate in summary
state compare-and-set identity. Rolling summary generation continues through the normal provider
gateway, whose one-shot path now has isolated cache intent.

## ViewManifest and Attempt Outcomes

Register `cache_aware_context_v1` as the default policy while retaining the legacy policy in the
registry. Add `cache-aware-v1` to the builder-version union and pass the assembler's version into
each provider attempt manifest. Advance new manifests to schema version 3. Extend included refs
with optional source entry IDs and content hashes for `summary_checkpoint`,
`reconstruction_checkpoint`, and `memory_context`.

Add a narrow `TapeProviderAttemptWriter` capability. The context coordinator captures the last
usage and stop event inside each request-sequence attempt, classifies completion, overflow, abort,
or error, and writes once after a provider call started. The application implementation appends
`provider/attempt_completed` with an idempotent provenance key. Failure is logged and ignored by
the generation path. Request-sequence recovery reads the maximum persisted manifest, trace, and
provider-attempt sequence so a successful outcome write cannot collide after an independent
manifest or trace write failure.

Tape recall parses the latest well-formed outcome event and exposes nullable cache-read,
cache-write, and hit-rate fields. A latest event without usage produces nulls rather than falling
back to an older attempt. Existing assistant-derived `lastTokenUsage` remains unchanged.

## Compatibility and Rollback

- No SQLite schema or settings migration is required.
- Old policy IDs, manifest schema versions, hashes, traces, and Tape entries remain readable.
- Shared `AgentTapeInfo` additions are optional; internal `TapeInfo` always materializes them.
- New outcome events are ignored by Memory's message/tool ingestion projection.
- Legacy manifests remain replayable. A runtime rollback must revert the structured contribution
  projection and default policy together; changing only the default policy would intentionally
  omit cache-aware checkpoint and Memory placement.
- Disabling provider cache planning removes new wire controls without affecting context storage.

## Validation

Each implementation slice adds focused unit or integration tests and runs the related suite plus
type checking before commit. Final validation runs formatting, i18n validation, lint, full type
checking, the full test suite, and the production build. Any expected provider or ACP registry
refresh produced by the build is reviewed and retained according to repository policy.
