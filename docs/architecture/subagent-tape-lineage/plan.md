# Subagent Tape Lineage - Implementation Plan

## Phase 1: Specify the boundary

- Record the distinction between true fork merge and durable subagent link.
- Freeze the event, outcome, authorization, head-cutoff, compatibility, and read-only view
  contracts before changing production code.
- Keep the current session relationship as the topology and authorization source of truth.

## Phase 2: Harden true fork merge

- Persist the exact parent head in `fork/start`.
- Freeze the fork head when merge begins and select only entries at or below it.
- Exclude `session/start` and `fork/start` from copied delta entries.
- Add a narrow Tape-store transaction operation so copied delta and `fork/merge` receipt commit or
  roll back together.
- Use stable merge provenance to return an existing receipt on retry.
- Reject missing, discarded, or malformed fork starts before creating a merge receipt, while
  preserving retries of an already committed receipt after cleanup.
- Cover valid empty forks, missing/discarded forks, injected append failure, retry, and concurrent
  tail append boundaries with native SQLite tests.

## Phase 3: Model production subagents as links

- Add typed `SubagentTapeLinkInput`, `SubagentTapeLinkOutcome`, and `SubagentTapeLinkReceipt`
  contracts at the shared runtime boundary.
- Replace `mergeSubagentTape` and `discardSubagentTape` ports with one `linkSubagentTape` port across
  DeepChat, direct ACP, session assignment, presenter, and tool runtime adapters.
- Append `subagent/tape_linked` with stable task provenance, a frozen child head/count, and a
  cryptographic identity of the child Tape incarnation.
- Update orchestration finalization so completed, error, and cancelled tasks all link after child
  settlement, while absent/failed capability leaves the task retryable. Polling retries a terminal
  task even while sibling tasks remain active, without blocking on an in-flight link.
- Reconcile terminal runtime status observed before handoff settlement as soon as the task enters
  its started state.
- Preserve legacy event reads without producing new legacy external fork records.

## Phase 4: Add authorized linked Tape views

- Introduce `AgentTapeViewScope` and a resolver that returns the current source and/or finalized
  direct-child sources with immutable cutoffs.
- Reuse persisted session ownership for authorization and Tape events for finalized snapshots.
- Give newly created Tape bootstraps an opaque incarnation marker; derive a compatible stable
  identity for existing unmarked Tapes without rewriting them.
- Validate linked incarnation identities through one batched first-entry query so reset/rebuild
  cannot reuse entry IDs to impersonate the frozen snapshot.
- Resolve child ownership in one indexed JSON-set query so linked-source count cannot exhaust the
  SQLite bind-variable limit.
- Extend projection/FTS reads to query a bounded authorized source set, enforce per-source cutoffs,
  and apply one global result limit.
- Use projection/FTS ranking only for complete exact-head coverage; on partial freshness, fall back
  all selected sources together so result scores remain comparable.
- Add source `sessionId` to search results.
- Extend context reads with `sourceSessionId`, reject mixed or unauthorized sources, and keep one
  context window within one Tape.
- Return explicit diagnostics for deleted or unavailable linked Tapes without triggering bootstrap,
  backfill, or repair writes.
- Build linked context evidence and summaries from the bounded authoritative rows already read at
  the frozen head, without consulting a projection at a different freshness boundary.

## Phase 5: Expose cross-Tape recall through existing tools

- Add optional `scope` to `tape_search` and optional `sourceSessionId` to `tape_context`.
- Keep omitted fields compatible with current-session-only recall.
- Carry the types through tool manager, runtime session routes, DeepChat backend, and direct ACP
  backend without adding another model tool.
- Add tool-schema, route, ownership, ACP, global-limit, and parent-effective-view non-interference
  tests.

## Phase 6: Validate and finalize contracts

- Review the complete branch diff against hidden writes, compatibility, transactionality, edge
  cases, performance, authorization, naming, test depth, and future maintenance cost.
- Run focused Tape/orchestrator/tool tests, native SQLite tests, main tests, typecheck, i18n, lint,
  format, and format check.
- Update the retained Tape baseline, runtime Tape contract, and this task ledger only for behavior
  proven by the implementation and validation.
- Do not run the full build in this slice because it refreshes unrelated provider and ACP registry
  artifacts.

## Commit Strategy

1. `docs(tape): specify subagent tape lineage`
2. `fix(tape): make fork merge atomic`
3. `refactor(tape): model subagents as tape links`
4. `feat(tape): add linked tape views`
5. `feat(tools): add cross-tape recall`
6. `docs(tape): finalize subagent tape lineage`

If cumulative review finds an implementation defect not cleanly owned by the final documentation
commit, add `fix(tape): address lineage review findings` without rewriting prior commits.

## Review Gate

Before every commit:

1. Inspect status, full unstaged diff/stat/check, and run the smallest sufficient validation.
2. Review P0 through P3 for hidden side effects, compatibility, boundaries, performance, security,
   semantic naming, test gaps, and maintenance cost.
3. Fix every in-scope actionable finding and repeat the review.
4. Stage explicit task paths only; inspect full staged diff/check and repeat the same severity review.
5. Commit only when staged changes contain no unrelated file and no actionable P0-P3 finding.

## Rollback and Compatibility

- The change adds no database schema migration; rollback leaves append-only link events readable as
  inert unknown events by older code.
- Current-only tool calls and true fork event readers remain compatible.
- New code keeps a legacy reader for old external `fork/merge` events.
- No child Tape is deleted or copied as part of production subagent finalization.
