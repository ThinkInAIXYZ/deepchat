# Cache-Aware Context Runtime Specification

## Background

DeepChat already persists a stronger execution model than Bub or Pi: Tape is append-only, message
corrections are explicit, reconstruction anchors are durable, ViewManifest records provider-visible
context, and fork or subagent reads are bounded by frozen heads. Replacing that model with another
agent's transcript or handoff format would weaken replay and compatibility guarantees.

The current prompt projection nevertheless has two independent defects:

1. Prompt-cache metadata is not always represented in the final AI SDK request. OpenRouter and
   Zenmux use the OpenAI-compatible adapter, which does not consume Anthropic metadata placed on
   message parts. Amazon Bedrock expects its own `cachePoint` metadata rather than
   `anthropic.cacheControl`.
2. Rolling summaries, handoff state, and recalled Memory are appended to the system prompt. These
   mutable, untrusted values invalidate the provider's stable prefix and receive a stronger trust
   role than their origin permits.

This architecture keeps Tape as the source of truth while adopting the useful properties of Bub's
append-stable prefix and Pi's user-role checkpoint, token-aware retained tail, and isolated
summarization calls.

## Goals

1. Emit prompt-cache controls in the exact wire shape accepted by the installed AI SDK provider
   adapters.
2. Keep deterministic instructions at the front of the request and move mutable conversation
   reconstruction into explicitly untrusted user-role contributions.
3. Preserve complete recent turns according to both the existing configured minimum and a
   model-aware token target.
4. Persist one compact provider-attempt outcome per actual request so the last cache-read ratio is
   observable independently from turn-wide usage aggregation.
5. Advance ViewManifest provenance without invalidating schema versions 1 and 2 or legacy policy
   identifiers.
6. Preserve existing fail-open Memory behavior, Tape append-only semantics, public provider
   configuration, and database schema.

## Required Invariants

### Prompt order and trust

Provider-visible context is ordered as:

1. deterministic base system instructions;
2. an optional synthetic user checkpoint derived from the current summary and visible handoff
   state;
3. complete history turns after the summary cursor;
4. the active user turn with an optional untrusted Memory contribution;
5. the current user payload or partial assistant continuation.

Summary, reconstruction state, and Memory content never use the system role. Their text remains
bounded, fenced, and labeled untrusted. A resume injects Memory into the user message that owns the
target assistant; it never appends a new user message after a partial assistant. If that owner
cannot be identified, Memory is omitted.

Tool or skill refresh replaces only the deterministic leading system instructions. It does not
repeat Memory retrieval, Memory access accounting, or `memory/view_assembled` persistence.
Context-pressure recovery may replace the checkpoint and cursor, but it also reuses the original
Memory contribution.

### Cache intent and provider mapping

Every text-generation request has an internal cache intent:

- `conversation`: reusable agent-loop request;
- `isolated`: one-shot request such as rolling summarization or title generation.

Isolated requests do not receive DeepChat cache keys, explicit breakpoints, or sticky-session
identifiers. This contract does not claim that a provider with implicit caching can be forced to
disable its own platform behavior.

Conversation requests use these transports:

| Provider path | Cache transport |
| --- | --- |
| OpenAI Chat and Responses | Hashed `promptCacheKey` |
| Official Anthropic | Top-level `anthropic.cacheControl` |
| Amazon Bedrock | `providerOptions.bedrock.cachePoint` on a reusable message or system instruction |
| OpenRouter fixed Claude models | Explicit content-block `cache_control` plus hashed `session_id` |
| Zenmux fixed Claude models | Explicit content-block `cache_control` |

OpenAI-compatible explicit breakpoints are applied in `transformRequestBody` after the AI SDK has
created its final messages. The breakpoint precedes the last user-owned active turn, keeping
partial assistant continuations, tool calls, and tool results in the dynamic suffix. Any
DeepChat-only transport marker is removed before the HTTP body is sent. Raw Session identifiers,
prompts, credentials, headers, responses, and exception stacks are never persisted in cache
telemetry.

### Context fitting and compaction

The base system, checkpoint, and active turn are protected. Optional Memory is removed before
historical turns. History is removed from the oldest complete turn and tool call/result groups are
not split. If protected content still does not fit, the runtime follows its explicit overflow
failure path rather than silently dropping trusted instructions or current user input.
Initial chat and resume selection use the same usable context length, including the provider
safety margin, as request preflight so manifest record provenance cannot describe history removed
only at the final provider boundary.

Automatic and context-pressure compaction calculate:

```text
inputBudget =
  max(0, floor((contextLength - reserveTokens - extraReserveTokens) / 1.2))

retainedTailTokenTarget =
  min(20_000, floor(inputBudget * 0.25))
```

The retained tail is selected from newest to oldest until it satisfies both the token target and
the existing `autoCompactionRetainRecentPairs` minimum. Resume always retains the active target
turn and at least that many preceding complete turns. Manual compaction retains no configured
minimum. Retained messages are derived from Tape and the summary cursor; they are not copied into
anchor state.

### Tape provenance and attempt telemetry

New context writes use policy `cache_aware_context_v1`, policy version 1, builder
`cache-aware-v1`, and ViewManifest schema version 3. Schema versions 1 and 2 and builder
`legacy-v1` remain readable and hash-verifiable. Schema 3 may record synthetic contribution
reasons, source entry identifiers, and content hashes without copying source text.

Each provider stream that actually starts appends one idempotent `provider/attempt_completed`
event keyed by Session, message, and request sequence. It records terminal classification, the
last cumulative usage snapshot, and a cache-read ratio only when the provider supplied valid
input and cache-read counts. An attempt canceled during rate-gate waiting is not recorded because
the provider was never called. A resumed run initializes its request sequence from the maximum
persisted manifest, request trace, and provider-attempt event so independent fail-open writes
cannot cause an idempotency collision. Its first new attempt still records the supplied chat or
resume selection provenance; absolute request-sequence values do not reclassify it as a tool loop.
Tape append failure is fail-open for generation.

## Acceptance Criteria

1. Real installed AI SDK adapters produce the expected final OpenAI, Anthropic,
   OpenAI-compatible, and Bedrock request shapes.
2. No internal cache marker reaches a captured HTTP body.
3. One-shot generation receives no DeepChat cache opt-in.
4. Recalled Memory, summary text, and handoff state are never present in system instructions.
5. Repeated turns with unchanged resources produce a byte-identical stable prefix; dynamic Memory
   changes only the active user turn.
6. Resume and tool-loop refresh preserve role order and do not perform duplicate Memory work.
7. Compaction obeys the configured turn floor, the 25-percent token target, the 20,000-token cap,
   and complete-turn/tool-group boundaries.
8. ViewManifest schemas 1, 2, and 3 remain readable; legacy manifests are not rewritten.
9. Provider overflow retry, abort, error, and cumulative usage produce at most one outcome per
   actual request sequence.
10. Tape info exposes the latest attempt cache metrics without changing existing aggregate usage
    semantics.
11. No database migration, renderer feature, public provider setting, GitHub issue, push, or pull
    request is created.

## Constraints

- The implementation targets the provider packages pinned in the current lockfile.
- Existing provider reasoning, tool, attachment, and tracing behavior must remain unchanged unless
  a cache transport requires preserving provider metadata that was previously discarded.
- New Tape data is append-only and uses existing entry storage.
- Every local commit requires a complete diff review and relevant validation before it is created.
- SDD artifacts in this directory use English prose.

## Non-Goals

- Guaranteeing a cache hit or a fixed cache-hit percentage.
- Adding cache controls to the settings UI.
- Persisting a second retained-history representation.
- Replacing Tape with Bub or Pi storage semantics.
- Enabling OpenAI model-specific explicit breakpoints or cache TTL controls.
- Redesigning aggregate Usage Dashboard calculations.

## Open Questions

None. The implementation decisions required for this architecture are recorded here and in the
accompanying plan.
