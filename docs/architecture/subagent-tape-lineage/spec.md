# Subagent Tape Lineage - Specification

> Status: **implemented and validated**

## Problem

Before this change, DeepChat used the word "merge" for two different lineage models:

1. `DeepChatTapeService.mergeFork()` copies a true fork's selected delta into its parent Tape.
2. Production subagents ran in independent sessions, but `mergeSubagentTape()` only appended a
   `fork/merge` event containing child metadata and a textual result summary.

The production operation was useful as an audit link, but it was not a Tape merge: child entries
did not enter the parent Tape, the parent effective message view remained unchanged, and Tape
recall could only query one session. Keeping the merge name made the persistence contract and the
model-facing capabilities disagree.

This implemented specification supersedes the merge/discard wording in the implemented
`subagent-run-guardrails` acceptance criteria. It preserves that specification's cancellation
settlement and retry ordering while replacing the misleading persistence operation.

## Decision

Production subagent sessions remain independent Tapes. Their parent records a typed, immutable link
at task finalization, and Tape recall can explicitly resolve authorized linked-child views.

True forks retain copy-on-merge semantics and gain an atomic, idempotent merge boundary. The two
concepts are deliberately separate:

| Concept | Storage model | Parent effective view | Finalization record |
| --- | --- | --- | --- |
| True fork | Temporary branch Tape | Receives selected delta on merge | `fork/merge` |
| Production subagent | Durable child session/Tape | Never receives copied child entries | `subagent/tape_linked` |

## Invariants

### Production subagent links

1. A production child is identified by its durable session relationship:
   `new_sessions.parent_session_id = parentSessionId` and `session_kind = subagent`.
2. The relationship table is the authorization source of truth. A link event is a finalized
   snapshot, not a second mutable ownership graph.
3. `linkSubagentTape()` accepts a closed outcome union: `completed | error | cancelled`.
4. A successful link appends exactly one `subagent/tape_linked` event to the parent and returns a
   receipt containing the parent link entry, child head cutoff, child entry count, and outcome.
5. The event references the child through `source_type = subagent`, `source_id = childSessionId`,
   and `source_seq = childHead`. It also freezes a cryptographic identity of the child Tape
   incarnation. It does not copy child payloads or raw provider data.
6. Missing link capability or failed persistence is not finalization. The orchestrator must leave
   `tapeFinalized = false` so a retry remains possible and the failure is observable. Polling an
   active multi-task run retries terminal tasks independently without waiting for sibling tasks or
   blocking on a slow link backend.
7. Retrying the same task outcome is idempotent. It must return the existing receipt rather than
   append a second link.
8. Completed, errored, and cancelled tasks all retain their child Tape and use the same link
   operation. Outcome describes lifecycle state; it does not imply merge or deletion.
9. A child terminal update observed while its handoff is still settling is reconciled immediately
   after handoff; it cannot leave the task running indefinitely or skip Tape finalization.

### True fork merge

1. `createFork()` records the exact parent head from which the fork was created.
2. `mergeFork()` freezes the fork head before selecting the delta.
3. Branch-local bootstrap/control anchors (`session/start` and `fork/start`) are not copied.
4. All selected delta entries and the parent `fork/merge` receipt are appended in one SQLite
   transaction. A failure leaves neither partial delta nor a receipt.
5. A retry after a committed merge is idempotent and returns the existing receipt.
6. Entries appended after the frozen fork head are outside that merge and cannot leak into it.
7. A new merge requires a valid persisted `fork/start`; a missing, discarded, or malformed fork
   cannot create an empty merge receipt. An already committed receipt remains retryable after fork
   cleanup.

## Cross-Tape View Contract

### Scope

```ts
type AgentTapeViewScope = 'current' | 'linked_subagents' | 'current_and_linked'
```

- `current` remains the default for compatibility.
- `linked_subagents` searches finalized, directly linked child Tapes only.
- `current_and_linked` searches the current Tape and those linked children.
- A global result limit is applied after combining sources; it is not multiplied per child.

### Authorization and cutoff

A linked source is readable only when all of the following hold:

1. The requested parent is the current persisted session.
2. The child still exists and is a direct child owned by that parent.
3. A valid finalized `subagent/tape_linked` record, regardless of task outcome, or a compatible
   legacy record authorizes the view.
4. The current child Tape incarnation matches the immutable identity recorded by the link.
5. Reads stop at the immutable head recorded by that link.

Arbitrary session IDs supplied by a model or caller never authorize access. Grandchildren are not
traversed. Because the View API addresses a source by session ID rather than link entry ID, the
latest valid link event for a child defines its readable incarnation and cutoff.

### Search and context

- Search results include `sessionId` so entry IDs remain unambiguous across Tapes.
- Context expansion accepts optional `sourceSessionId`. When omitted, it reads the current session.
- One context request expands one source Tape only. Entry windows never cross a Tape boundary.
- A non-current source must resolve through the parent's authorized direct-child links and must
  stay within the link cutoff.
- A deleted or rebuilt child produces an explicit `linked_tape_unavailable` result/error until the
  current incarnation is explicitly linked. It does not silently fall back to the parent or return
  partial data from another source.
- Search and context remain read-only: no bootstrap, backfill, projection repair, memory ingestion,
  or event publication is triggered by a linked-source read.

## Compatibility

1. Existing callers that omit scope retain current-session-only behavior and result ordering.
2. Existing `tape_search` and `tape_context` remain the only model tools; no third tool or renderer
   surface is added.
3. Old external `fork/merge` records are read as completed child links when their child session
   relationship is valid. Their positive `referencedEntryCount` is used as the legacy frozen
   cutoff because those records did not store an exact child head.
4. Pre-incarnation link records remain readable while their original unmarked legacy Tape remains
   present. A Tape rebuilt with a new incarnation marker requires a new link.
5. Old external `fork/discard` records remain audit-only and never authorize a linked view.
6. Existing true `fork/merge` records keep their original meaning.
7. No database schema migration is required. The existing Tape source fields and session
   relationship are reused.

## Security and Privacy

- Parent-child ownership is checked from persisted session metadata for every cross-Tape read.
- Link payloads contain identifiers, counts, lifecycle outcome, task metadata, and bounded result
  summary only; they do not duplicate raw child entries, prompts, traces, headers, or credentials.
- Search projection rows are scoped by the authorized source set and cutoff before results are
  returned.
- Projection and FTS ranking is used only when every authorized source is fresh at its exact
  cutoff. Partial freshness falls back to one authoritative read across all selected Tapes so
  scored sources cannot starve unscored sources at the global limit.
- Context reads reject mixed-source entry IDs and source IDs not derived from an authorized link.

## Performance Constraints

- Resolve direct linked sources with bounded indexed queries and a constant number of SQL bind
  parameters; do not scan every session or expand one placeholder per linked child.
- Resolve child Tape incarnation identities in one batched first-entry query; never hash or
  materialize complete child Tapes during recall.
- Do not materialize complete child Tapes to search them.
- Apply source cutoff in SQL/projection reads, and enforce one global search limit.
- Derive bounded linked-context summaries from the selected authoritative Tape rows instead of
  trusting projection rows whose freshness belongs to a different child head.
- Avoid N+1 full-session hydration and linked-source bootstrap/backfill.
- Preserve existing FTS relevance ordering with deterministic Tape order tie-breaking across
  sources.

## Non-goals

- Copying production child entries into the parent Tape.
- Including linked child entries in the parent provider context or effective view.
- Recursive descendant search.
- A generic import/materialization namespace for external Tapes.
- UI for lineage browsing or child Tape recovery.
- Changing current session deletion/cascade policy.
- Syncing a GitHub issue as part of this architecture slice.

## Acceptance Criteria

- Production subagent finalization uses link terminology and typed outcomes end to end.
- A missing or failed link write remains retryable and is never reported as finalized.
- True fork merge is atomic, idempotent, head-bounded, and excludes branch-local control anchors.
- Current-only source selection, filtering, and ordering remain compatible when callers omit new
  fields; search/context outputs add explicit source identity.
- Authorized linked recall returns source session IDs and never reads beyond a frozen head.
- Rebuilding a child Tape cannot reuse entry IDs to impersonate a frozen linked snapshot.
- Sibling, grandchild, unrelated, deleted, and malformed legacy sources cannot leak data.
- Cross-Tape search respects one global limit and context windows remain within one Tape.
- DeepChat and direct ACP subagent routes share the same link and recall contract.
- Focused persistence, failure-recovery, authorization, compatibility, and non-interference tests
  pass.

## Open Questions

None.
