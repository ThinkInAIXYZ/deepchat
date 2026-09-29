# Memory impact review

## Goal

Let users review direct reflection dependants before editing or deleting a source claim, then
explicitly archive selected dependants. A changed source does not prove every dependant false.
Source edits/deletes retain their existing semantics and never implicitly archive descendants.

## Design

Reuse the existing lineage table, indexed keyset pagination, claim visibility and archive state
machine. No migration, service, model invocation, recursive traversal or automatic invalidation.
Only `reflection` edges participate: manual edits and supersession are not evidence dependencies.
The preview contains currently active, management-visible reflection claims. Other sources do not
prevent user-selected archival; the UI explicitly describes this as a review, not a truth verdict.

`memory.getImpact` accepts agentId, memoryId, optional lineage cursor and limit (default 20,
maximum 50). It returns `{ page: MemoryImpactPage | null }`, where items contain `memory` and its
`revision`, and nextCursor uses the existing lineage keyset. Pagination bounds relation reads
before hydration; pages may be sparse when related claims are no longer eligible. Inaccessible
roots return null. Only direct reflection edges are queried.

`memory.archiveImpact` accepts agentId, memoryId (source), derivedMemoryId and expectedRevision.
It returns the existing MemoryCommandResult. The host revalidates source visibility, the direct
reflection edge, target Agent/kind/lifecycle/conflict state and exact decision revision before
using the existing transactional archive operation. Stale, missing or ineligible claims are not
changed. Per-item operations intentionally permit explicit partial success rather than pretending
the source mutation and archive batch form one atomic action.

The renderer uses one paged review component in edit mode and both delete confirmation entry
points. Selection starts empty, is bounded to loaded rows, and resets on external refresh.
Archive runs only on an explicit button press. Each result is shown; failures do not undo successful
items, and retry requires fresh preview data and deliberate selection. Source save/delete and
navigation are blocked while archival is in progress. Delayed reads cannot restore obsolete rows.

## Acceptance

Independent descendants and other Agents remain untouched. Archived or changed targets cannot be
archived using a stale preview. Editing/deleting a source without choosing archive has no effect
on descendants. Sparse pages remain navigable. Partial failures are visible. All new copy is
localized for each supported language. Desktop/narrow UI is rendered and inspected. Existing
privacy, source deletion, unsaved-edit and asynchronous request guards remain in force.

```text
BEFORE: Edit/delete source -> source-only operation
AFTER:  Edit/delete source -> review direct reflections (optional)
                           -> select -> archive selected -> per-item results
                           -> source-only operation
```

## Non-goals

No graph browser, recursive cascade, historical snapshots, semantic re-evaluation, automatic
recall filtering or attribution-quality benchmark. No push or external issue synchronization.
