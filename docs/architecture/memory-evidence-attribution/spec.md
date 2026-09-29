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
calls. Model failure cannot block the conversation. Rollback is a code revert; stored finer-grained
lineage remains readable by the previous implementation.

## Acceptance

Independent inputs produce independent lineage; multiple supporting inputs retain their union.
Foreign evidence IDs and uncited outputs cannot create claims. Source changes during generation
cannot publish stale reflection evidence. Exact duplicates, retries and no-op results preserve
bounded work and existing forgetting behavior. Existing scope and extraction-cursor checks remain
valid. Validation includes asymmetric evidence fixtures and controlled removal of attribution
guards to show which protections are necessary; it does not claim real-model quality improvement.

## Open questions

None for this scope. Semantic citation quality and Topic Memory are separate follow-up work.
