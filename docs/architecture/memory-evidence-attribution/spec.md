# Memory evidence attribution

## Goal and boundary

Generated claims identify their actual supporting inputs instead of inheriting every source in
an extraction window or reflection batch. Existing claims, derivation edges, tombstones, scopes,
provider budgets and operation fences remain authoritative. Historical lineage is not rewritten.

This change does not introduce Topic Memory, immutable claim history, a new database, a review
service, a provider call, a user setting or an executable instruction channel.

## Contract

- Generation inputs expose operation-local evidence IDs next to their content. Models cannot
  choose persistent identities. The host resolves cited IDs against that exact bounded input.
- Each generated result must cite a nonempty subset of its inputs. Unknown, malformed or missing
  citations reject that result rather than silently attributing the whole input window.
- Reflection persists only the cited parent claims as derivation edges, in the transaction that
  inserts its result. Cited claims are revalidated against their generation-time decision revision,
  owner, scope and eligibility before publication. Stale evidence cannot produce a new claim.
- Extraction retains the existing terminal/compaction cursor and cancellation contracts. Source
  attribution is carried per candidate through normalization, deduplication, decisions and retries.
  Equivalent candidates union their valid evidence; one candidate never borrows another's sources.
- A nonempty extraction response whose otherwise valid candidates all have invalid citations is
  retryable failure, not successful empty extraction. A deliberate empty result remains successful;
  mixed responses retain the existing per-entry tolerance and publish only valid candidates.
- Newly inserted claims, including superseding and challenging claims, persist the candidate's
  cited Tape entries. UPDATE and existing-owner folds retain the row's original source metadata;
  a single source session is not a multi-session revision history. Historical lineage is unchanged.
- Legacy callers without individually addressable extraction material retain their existing
  coarse provenance contract. The normal chat runtime supplies addressable evidence.
- A valid citation establishes input identity, not semantic entailment or truth. Recalled data
  remains untrusted. Draft directives retain their existing explicit-approval boundary.

## Ownership and data flow

Runtime owns Tape fragments and their source IDs. Extraction owns model-visible evidence and
output validation. Write coordination owns candidate-specific lineage through decision retries.
Reflection owns selection, current-source validation and transactional derivation publication.
No generic evidence registry or separate lifecycle is needed.

```text
bounded input -> local evidence IDs -> model proposals -> validated per-result evidence
             -> existing claim transaction + source IDs / derivation edges
```

## Compatibility and performance

No persistence migration or public tool change is required. Existing source arrays and derivation
tables can represent the more precise results. The new reflection output is a private model
contract; uncited legacy model responses are not upgraded to fabricated precise provenance.
Evidence validation uses bounded lookup maps and source checks, never corpus scans or extra model
calls. Runtime chunk limits include the exact model-visible evidence labels. Extraction renders raw
untrusted fragments without JSON escaping amplification; model output still uses JSON validation.
Model failure cannot block the conversation. Rollback is a code revert; stored finer-grained lineage
remains readable by the previous implementation.

## Acceptance

Independent inputs produce independent lineage; multiple supporting inputs retain their union.
Foreign evidence IDs and uncited outputs cannot create claims. Source changes during generation
cannot publish stale reflection evidence. Exact duplicates, retries and no-op results preserve
bounded work and existing forgetting behavior. Existing scope and extraction-cursor checks remain
valid. Validation includes asymmetric evidence fixtures and controlled removal of attribution
guards to show which protections are necessary; it does not claim real-model quality improvement.

## Open questions

None for this scope. Semantic citation quality and Topic Memory are separate follow-up work.

## Inspectable evidence

Memory details expose direct source conversations and immediate derivation parents/children in
the existing settings surface. Related claims show current content, not a generation-time snapshot.
Missing or management-hidden claims appear as unavailable, never as reconstructed deleted text.
Opening a related claim reuses the existing detail/edit/archive flows. Deletion remains selective:
the confirmation explains that derived claims are retained; there is no automatic cascade.

One additive read-only `memory.getLineage` route accepts agentId, memoryId, direction
(`parents` or `children`), an optional keyset cursor (createdAt, memoryId, derivationKind), and
limit (default 20, maximum 50). It returns a nullable page containing items (memoryId,
derivationKind, createdAt, nullable current MemoryItem) and nextCursor. Unknown, inaccessible or
clearing roots return no page. SQL limits the indexed relation lookup before related claims are
resolved through management visibility checks. Pagination orders by createdAt, related memory ID,
and derivation kind, with no recursive traversal or unbounded graph load.

This extension adds no service, dependency, migration, setting or generation call. Validation covers
pagination boundaries, Agent isolation, unavailable sources, clearing, navigation, stale requests,
and selective-delete copy. Isolated UI fixtures provide repeatable visual and interaction checks;
real-model attribution quality remains distinct from deterministic correctness tests.

### UI acceptance

```text
BEFORE                           AFTER
Memory details                   Memory details
  Content / category               Content / category
  Conversation source              Conversation source
  Lifecycle details                Derived from > current claims / unavailable
  Delete                           Derived claims > current claims / unavailable
                                   Lifecycle details
                                   Delete > derived claims retained warning
```

Open Settings > Memory, select a claim, and expand either relation section. Relations load only
when expanded, 20 at a time. Opening a related claim reveals it even outside the loaded page or
active filters, after the existing unsaved-edit guard. Archived claims retain their read-only
state. Older claims without recorded edges correctly show no related claims; attribution is not
backfilled. Deleting one source leaves its derived claim and an unavailable-source entry.

For deterministic acceptance without a model or personal data, run `pnpm run build`, then
`pnpm exec playwright test -c test/e2e/playwright.config.ts 41-memory-lineage`. The test creates a
disposable profile, seeds explicit relations while the app is closed, and exercises the real
renderer, preload, route and SQLite path. It also captures desktop, narrow and deletion states.
