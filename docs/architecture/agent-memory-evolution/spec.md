# Agent Memory Evolution

## Status

- State: In progress
- Initial implementation completed: 2026-07-26
- Post-implementation hardening opened: 2026-07-27
- Branch: `feat/agent-memory-evolution`
- Classification: Architecture evolution with user-visible behavior
- Naming: This work does not assign a numeric version to the Agent Memory system. Existing `v1` and
  `v2` names remain scoped to the DuckDB vector-store format.

## Context

DeepChat already has a mature per-agent memory subsystem:

- Tape-backed extraction with provenance;
- SQLite rows as durable synthesized memory;
- FTS and per-agent DuckDB vector retrieval;
- background conflict handling, consolidation, reflection, persona drafting, and decay;
- a rebuildable working-memory projection;
- bounded, sanitized user-role injection;
- management, diagnostics, and retrieval-quality gates.

The remaining quality failures are semantic rather than infrastructural:

1. A fact can remain highly ranked after it has stopped being true because temporal validity is not
   represented.
2. Evidence confidence and temporal-parse confidence share no explicit boundary.
3. Repeated confirmation monotonically raises factual confidence, so overloading it with temporal
   confidence would make a bad date interpretation increasingly authoritative.
4. Derived claims have source data in operational audit events, but audit retention is not a durable
   lineage contract.
5. Explicit deletion hard-deletes the row and releases the provenance key, allowing the same source
   span to recreate the memory.
6. User directives cannot safely share the read-only memory container: memory content is untrusted
   data, while an executable directive is trusted only after an explicit user action.
7. The current working blob is rebuildable but does not expose temporal state or allocate its budget
   against query recall through one explicit policy.
8. `user_scope` exists without a complete applicability contract.

The design is informed by the behavior demonstrated in OpenAI's memory research, especially
carry-forward, preference adherence, and temporal correctness. It does not claim to reproduce
OpenAI's undisclosed implementation.

## Goal

Make Agent Memory behave as a time-aware, correctable, auditable set of atomic claims while
preserving the existing ownership, failure-isolation, and bounded-runtime contracts.

The runtime model is:

```text
authoritative atomic claims
  + durable derivation edges
  + exact deletion tombstones
  + explicit trusted directives
  -> rebuildable working projection
  + query-dependent retrieval
  -> bounded typed user-role contributions
```

## Terminology

### Claim

An existing non-internal `agent_memory` row is the authoritative atomic claim. This work evolves the
row contract; it does not introduce a second fact table or a summary that can diverge from the row.

### Projection

A projection is derived, replaceable state such as the working-memory row, FTS mirror, vector
sidecar, or UI summary. A projection is never an independent fact source.

### Directive

A directive is an instruction the runtime may execute. It is stored outside `agent_memory` and is
active only after explicit user creation or approval. Model-derived text may create a draft, never
an active directive.

## Required invariants

1. `agent_memory` remains the sole authoritative store for remembered facts.
2. Existing rows migrate to an atemporal, agent-scoped interpretation without changing their recall
   eligibility. The historically non-enforced `user_scope` value remains metadata until a caller
   explicitly writes the new scope contract.
3. Temporal intervals use half-open semantics: `[valid_from, valid_until)`.
4. Factual confidence and temporal confidence are independent values with independent update rules.
5. Temporal precision is explicit; an inferred month or year must not masquerade as an exact
   timestamp.
6. Expired state claims may be excluded only when the temporal parse is sufficiently trustworthy.
   Uncertain parses fail open with a ranking penalty and an annotation.
7. A past plan is represented as “previously planned”; the system must not infer that it happened.
8. Directive content never enters the read-only memory container.
9. Active directives come only from explicit user input or an explicit approval action.
10. Forget tombstones store only hashes and metadata, never the forgotten plaintext.
11. The first tombstone contract is exact: it blocks replay of the same provenance/content identity.
    Semantic suppression of paraphrases is out of scope until behavioral evaluation can bound false
    positives.
12. Claim-to-claim derivation remains available after operational audit retention.
13. All query and mutation paths retain the current Agent ownership checks and execution fences.
14. Runtime time decisions use an injected domain clock. Infrastructure timeout measurement may
    continue to use a monotonic or wall clock local to that infrastructure.
15. Scope broadening is explicit. Missing scope context never grants access to a narrower scope.
16. Memory, projection, and directive contributions remain user-role data; none may rewrite or
    append to the base system prompt.
17. Content tombstone identity includes applicability scope. The original agent-scope hash remains
    valid for compatibility, while user/project/session tombstones cannot suppress identical
    content outside their exact scope.
18. Management and search response DTOs enforce the same temporal, scope, and directive-kind
    invariants as persistence; malformed durable state is never normalized silently at the IPC
    boundary.
19. A model-initiated `memory_remember` call is an untrusted runtime write, not explicit user
    re-authorization, and can never release a forget tombstone.
20. Generic claim lifecycle and delete APIs reject internal `persona` and `working` rows; those
    rows remain owned by their dedicated state machines.
21. Agent-wide claim clear becomes effective before its first deletion batch: claim reads and
    writes are fenced while a durable clear job exists, and a restart resumes that job instead of
    exposing a partially cleared namespace.
22. Each clear transaction processes a bounded claim batch. Tombstone insertion, authoritative row
    deletion, and FTS maintenance for that batch are atomic; directive state remains outside this
    operation.
23. Persisted support for a scope does not imply end-to-end runtime identity wiring. The capability
    matrix below is part of the public architecture contract.

## Temporal claim contract

Each authoritative claim gains:

| Field | Contract |
| --- | --- |
| `temporal_kind` | `atemporal`, `state`, `event`, `plan`, or `recurring` |
| `valid_from` | Inclusive epoch milliseconds, nullable |
| `valid_until` | Exclusive epoch milliseconds, nullable |
| `temporal_confidence` | Independent parse confidence in `[0, 1]`, nullable for atemporal claims |
| `temporal_precision` | `exact`, `day`, `week`, `month`, `quarter`, `year`, or `unknown` |
| `temporal_timezone` | IANA timezone used to interpret local temporal text, nullable |

Validation rules:

- `atemporal` has no validity bounds, confidence, precision, or timezone.
- Non-atemporal claims require `temporal_confidence`, `temporal_precision`, and
  `temporal_timezone`.
- When both bounds exist, `valid_from < valid_until`.
- Extraction outputs are normalized and rejected per candidate when malformed; a malformed temporal
  fragment does not fail the entire extraction batch.
- Existing rows backfill to `atemporal`.

Runtime interpretation:

- `state`: a high-confidence expired or not-yet-effective state is ineligible for current-fact
  recall; a low-confidence one remains eligible with a penalty and qualification.
- `event`: remains historical evidence and is annotated with its interval.
- `plan`: remains a plan; after its interval it is annotated as previously planned.
- `recurring`: remains eligible when its recurrence is not fully materialized; the stored interval
  describes the known recurrence window, not proof of an occurrence.
- `atemporal`: preserves existing behavior.

The initial hard-filter threshold is a named policy constant and is covered by behavioral tests. It
is not user-configurable in this change.

Retrieval refills FTS and vector candidates adaptively when authoritative, scope, directive, or
temporal filtering leaves fewer than top-K distinct claims. Refills reuse the query embedding,
grow geometrically, stop at 800 candidates per source, and emit `candidateBudgetExhausted` when a
saturated source reaches that hard bound without filling top-K.

## Directive contract

Directives use a dedicated durable table and typed runtime contribution.

Minimum fields:

- owner Agent;
- stable ID;
- kind: `instruction` or `suppress_topic`;
- status: `draft`, `active`, or `rejected`;
- source: `explicit_user`, `manual`, or `derived_suggestion`;
- content;
- optional normalized topic for `suppress_topic`;
- creation/update timestamps.

Behavior:

1. Explicit manual creation may create an active directive.
2. Extraction may propose a `derived_suggestion` draft.
3. Only an explicit approve action changes a draft to active.
4. Active `suppress_topic` directives gate recalled claim content before access accounting and
   assembly.
5. Active directives are rendered in a dedicated directive contribution with a separate container
   and policy version.
6. Natural-language directives are prompt-level guidance, not a hard output guarantee. Strict
   “never mention” guarantees would require output verification/regeneration and are a non-goal.
7. Because CJK suppression uses normalized substring matching, a topic containing CJK characters
   requires at least two visible base characters. New writes are rejected and malformed persisted
   topics are ignored so a single broad character cannot suppress unrelated recall.
8. The current contribution policy orders active directives deterministically by `updated_at DESC,
   id ASC` before applying its hard budget. This is recency ordering, not semantic priority, and
   active persistence alone does not guarantee that an instruction fits in every prompt.
9. `priority` or `pinned` semantics require a separate product contract, persistence migration, and
   user-visible controls. They must not be inferred from directive text or source.

## Durable derivation contract

Claim derivation uses a dedicated relation:

```text
(agent_id, parent_memory_id, child_memory_id, derivation_kind, created_at)
```

`derivation_kind` is a closed set for the implemented writers:

- `merge`;
- `reflection`;
- `supersede`;
- `manual_edit`.

Rows are inserted transactionally with the resulting claim mutation. Audit may duplicate the IDs for
operational observability, but audit is not the source of truth for lineage.

## Forget contract

Explicit single-row deletion:

1. resolves the owned row;
2. rejects internal `persona` and `working` rows;
3. hashes its canonical provenance key and scope-qualified normalized content, retaining the
   original agent-scope content hash so pre-scope tombstones remain effective;
4. inserts tombstones and deletes the row in one SQLite transaction;
5. removes the vector after the durable transaction;
6. blocks future exact provenance/content recreation.

Agent-wide clear is an explicit, resumable forget operation:

1. a durable job records the Agent, a row cutoff, cumulative removed count, creation time, and
   `claims|vectors` phase;
2. the runtime immediately fences all claim reads, writes, lifecycle operations, persona
   transitions, conflict operations, projection rebuilds, and maintenance for that Agent;
3. each synchronous SQLite transaction tombstones and deletes at most 256 rows while maintaining
   the FTS mirror atomically;
4. derivation and dirty-work state are removed after the final claim batch;
5. vector cleanup must either complete or be explicitly deferred by the vector manager before the
   durable job completes; a restart resumes any unfinished phase before claim access is restored.

The job preserves tombstones so replay of existing Tape cannot repopulate the cleared data. Standing
directives remain readable and independently manageable throughout because directive clearing is a
separate trust-plane operation. Every clear control must therefore name factual memories/persona as
its target and state that standing directives are retained.

`memory_forget` is a compatibility name for soft archival. Its tool definition and result must both
say that the row remains stored locally and is excluded from normal recall; it must never claim
permanent deletion or complete forgetting.

Agent deletion is a namespace-retirement operation. It removes claims, tombstones, directives, and
derived state, so a newly created Agent identity starts clean.

## Scope contract

Memory ownership and applicability remain separate:

- `agent_id` is always the storage/security owner and vector-sidecar namespace;
- `scope_type` is `agent`, `user`, `project`, or `session`;
- `scope_id` is null only for `agent`; narrower scopes require a non-empty ID.

Existing `user_scope` remains a compatibility shadow during this evolution:

- all existing rows backfill to `scope_type=agent`, `scope_id=NULL`, because `user_scope` has never
  participated in recall and narrowing it during migration would be a behavior regression;
- new callers use the typed scope object; new writes keep the shadow synchronized for user-scoped
  rows;
- other scope types write `user_scope=null`.

This change does not introduce cross-Agent sharing. A user- or project-scoped claim remains owned by
one Agent and cannot cross its ownership boundary.

Current runtime capability:

| Scope | Persistence / explicit API | Normal DeepChat recall | Automatic extraction |
| --- | --- | --- | --- |
| `agent` | Supported and default | Fully wired | Writes Agent scope |
| `session` | Supported | Wired when the current Session ID is supplied | Does not assign Session scope |
| `user` | Supported as an internal typed capability | No user identity is supplied by the normal chat runtime | Does not assign User scope |
| `project` | Supported as an internal typed capability | No project identity is supplied by the normal chat runtime | Does not assign Project scope |

Until DeepChat has authoritative user/project identity sources and lifecycle rules, user/project
scope is internal/experimental rather than an end-to-end product capability. Callers must not infer
that DTO and route support alone enables it.

## Behavioral acceptance criteria

### AC-1: Carry-forward

- Stable atemporal claims continue to be retrieved and injected across sessions.
- The new policies do not regress the maintained retrieval fixture beyond its declared thresholds.

### AC-2: Preference and directive adherence

- Stable user preferences remain recallable.
- Active directives are present in the directive contribution and absent from the read-only memory
  contribution.
- Draft and rejected directives never affect retrieval or injection.
- Suppressed-topic claims are neither injected nor access-counted.

### AC-3: Temporal correctness

- A high-confidence expired state is not presented as current.
- An uncertain expired state fails open but is qualified.
- A future plan stays a plan.
- An expired plan is rendered as previously planned and never as a completed event.
- Atemporal rows retain current ranking behavior.

### AC-4: Correction and forgetting

- Contradicting claims still follow the existing decision/conflict lifecycle.
- Exact source replay cannot recreate a selectively deleted claim.
- A later, independently sourced statement is not suppressed merely because it is semantically
  similar to forgotten content.
- Identical content in another user, project, or session scope is not suppressed by a tombstone
  from the forgotten claim's scope.

### AC-5: Consolidation and lineage

- A committed claim mutation marks bounded dirty work.
- Consolidation consumes dirty seeds and bounded neighbors instead of repeatedly scanning the full
  corpus.
- Reflection claims participate in dirty consolidation; transient failures rotate retryable
  generations behind untouched work, while stale and terminal generations are discarded safely.
- Merge/reflection outputs retain durable parent edges after audit pruning.
- Retrying maintenance is idempotent.

### AC-6: Projection and budget

- The working projection is deterministic for identical authoritative rows and clock.
- Projection ordering and temporal annotations are stable and diffable.
- One allocator reserves query-recall capacity, applies explicit floors/ceilings, and permits bounded
  borrowing of unused capacity.
- Assembled contributions never exceed the configured total memory budget.

### AC-7: Scope isolation

- Agent-scoped rows preserve current behavior.
- User/project/session rows are returned only when the matching scope context is supplied.
- A scope ID never broadens access outside the owner Agent.

### AC-8: Compatibility, reliability, and security

- Existing databases migrate without re-extraction or re-embedding solely because of new metadata.
- Existing public DTO fields remain compatible; new fields are additive.
- Memory remains fail-open for the conversation and fail-closed for stale writes.
- No forgotten plaintext appears in tombstones, logs, audit refs, or diagnostics.
- Hot-path database and vector work remains bounded.

### AC-9: Post-implementation hardening

- Every Memory-owned test is classified into exactly one maintained gate; native trust-boundary
  tests execute in the native gate.
- Upgraded databases enforce temporal and scope invariants at write time. Import skips malformed
  rows independently, and startup neutralizes invalid temporal metadata instead of boot-looping.
  External claims repaired this way are archived rather than promoted to permanent atemporal facts;
  internal persona/working rows are normalized to their required atemporal form.
- A rewrite merge preserves the only available temporal interpretation; conflicting interpretations
  never erase time semantics without an observable audit decision.
- Malformed model-produced temporal metadata rejects only that extracted candidate.
- An explicit renderer user-add action may recreate an exactly forgotten claim atomically;
  model-initiated tools, background extraction, and replay remain suppressed.
- Scoped FTS importance candidates retain indexed ordering without a whole-Agent temporary sort.
- Directive approval text is display-safe, capacity rejection is distinguishable, and trusted
  directives are the last optional contribution shed before a hard context overflow.
- Management search remains evidence-complete even when a topic is suppressed from runtime recall.
- Persistent claim lineage contains no self-edges; in-place revisions remain observable through
  audit rather than pretending to derive a claim from itself.
- Working projection and reflection tests prove that narrow-scope claims cannot be promoted into
  Agent-wide projections.

## Review disposition

The 2026-07-27 post-implementation review was verified against the branch rather than accepted as a
premise:

- Confirmed: test-scope classification, upgraded-schema temporal enforcement, import isolation,
  temporal merge preservation, explicit user relearning, retired-index churn, scoped FTS ordering,
  directive display controls and capacity results, projection/reflection scope tests, strict
  extraction temporal validation, management-search visibility, lineage self-edges, directive
  overflow fallback, Chinese locale gaps, migration/boundary/idempotency coverage, and live system
  timezone resolution.
- Corrected after trust-boundary verification: `memory_remember` retains the structured
  `forgotten` domain result but maps it to `requires_user_reauthorization`; only the explicit
  renderer add action can atomically release matching tombstones. Generic deletion now rejects
  internal persona and working rows.
- Corrected after suppression-boundary verification: single-character CJK topics are rejected at
  write time, ignored if already persisted, and explained in the directive editor.
- Corrected after recall-completeness verification: fixed oversampling now grows adaptively after
  post-query filtering, reuses the existing embedding, and reports bounded exhaustion.
- Corrected after clear-performance verification: Agent clear now uses a durable two-phase job,
  immediate claim-access fencing, 256-row transactions, event-loop yields, startup recovery, and
  completion only after vector cleanup. Directives remain on their independent trust plane.
- Documented rather than guessed: directive contribution ordering is recency-based and has no
  semantic priority/pinning contract; user/project scopes are persisted internal capabilities but
  are not wired end to end by the normal chat runtime.
- Rejected: adding an unknown allocation lane does not null Tape inspection. The parser ignores
  unknown object fields while retaining the four known lanes, and a Tape-to-route allocation
  fixture already exists.
- Deferred as unrelated or tuning-only: pre-existing vector-sidecar cleanup and abort/resume access
  deduplication, directive lane share tuning, downgrade release notes, and translations that require
  native-language review beyond the maintained Chinese variants.

## Non-goals

- Reproducing OpenAI's Dreaming implementation or claiming equivalent internals.
- Assigning an Agent Memory V2/V3 product version.
- Promoting file, tool, or knowledge-base content into long-term memory without the current policy
  and provenance path.
- Cross-Agent memory sharing.
- End-to-end User/Project scope identity wiring.
- Directive priority/pinning before its product semantics and controls are specified.
- Semantic tombstones or embedding-based topic suppression.
- A strict output firewall for natural-language directives.
- Replacing query retrieval with a single summary.
- Rewriting every infrastructure `Date.now()` call.
- Prompt-cache savings from projection ordering; ordering is for determinism and testability.

## Open questions

No implementation-blocking questions remain. Policy thresholds and initial budget shares are named
constants guarded by tests so they can be tuned without changing persisted contracts.
