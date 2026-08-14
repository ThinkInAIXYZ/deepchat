# Tape Trace Inspector Implementation Plan

## Status

Implementation approved on `feat/tape-trace-inspector`. No implementation slice is complete yet.

The work is split into reviewable commits. Before every commit, review the complete staged diff for
hidden side effects, compatibility regressions, boundary behavior, performance, security, naming,
test sufficiency, and future maintenance cost. Fix findings before committing. Do not push from this
worktree.

## Objective

Implement the read-only session-level Inspector defined in `spec.md` while preserving Tape,
Runtime, Transcript, and request-evidence authority boundaries.

## Ownership

- Tape infrastructure owns bounded physical row reads and snapshot consistency.
- Tape application owns total fact projection and sanitized detail projection.
- A narrow Tape inspection capability exposes the projection to session queries.
- Session routes own typed renderer-facing page, evidence, detail, and subscription contracts.
- The renderer feature owns grouping, timing, search, selection, pagination, and presentation.
- A demand-driven main-process watcher owns committed-head pulses in P2.

## 1. SDD and Contract Baseline

- [x] Land `spec.md` and this plan after a full document review.
- [x] Confirm every resolved decision has an implementation owner and no unresolved marker.

Completion condition: the committed SDD is sufficient to reject an implementation that drops
facts, leaks payloads, invents identity, or relies on unbounded reads.

## 2. P1 Tape Read Model

- [ ] Add shared Zod contracts and TypeScript types for fact pages, evidence pages, detail results,
  cursors, filters, and canonical sort.
- [ ] Add bounded tail/older/newer storage reads beside the existing Tape entry readers.
- [ ] Read incarnation, snapshot head, rows, and page evidence counts in one explicit SQLite
  transaction.
- [ ] Implement total `traceInspectorProjection.ts` mapping with `tool` and `other` fallbacks,
  nullable names, bounded code values, and context/Skill body withholding.
- [ ] Reuse stored-string SHA-256 semantics and expose integrity only through existing verifiers.
- [ ] Add the narrow Tape Inspector reader capability and forward it through `SessionTape` and the
  session data/query boundary.
- [ ] Extend the Tape layer-boundary allowlist only for this narrow consumer.

Completion condition: a session can request a bounded canonical page without loading an effective
view or omitting any physical Tape row.

## 3. P1 Evidence and Detail Reads

- [ ] Add session-scoped trace metadata keyset pagination with optional message/request/attempt
  filters and no endpoint/headers/body fields.
- [ ] Keep its cursor independent from Tape entry cursors.
- [ ] Batch page-level evidence counts rather than issuing per-row lookups.
- [ ] Add `sessions.getTapeInspectorRecordDetail` with incarnation validation.
- [ ] Implement exact schema allowlists, then redaction, then byte/collection truncation.
- [ ] Return hash/size-only detail for unknown event/anchor schemas and all context/Skill bodies.
- [ ] Define the row-to-detail capability matrix in the renderer client.

Completion condition: bound and unbound evidence are discoverable without payloads, and every fact
selection has a safe, explicit detail result.

## 4. P1 Typed Session Routes

- [ ] Register list, evidence, and detail route contracts.
- [ ] Add `SessionQuery`, session data-port, and `SessionClient` methods using existing validation and
  session-existence checks.
- [ ] Keep list and evidence outputs JSON-bounded and fully projected through public schemas.
- [ ] Preserve existing Trace dialog and ReplaySlice routes unchanged.

Completion condition: renderer access is typed and context-isolated with no direct database or raw
IPC path.

## 5. P1 Renderer Model

- [ ] Add a focused `tape-inspector` feature directory.
- [ ] Implement stable fact/evidence maps, canonical keys, request generations, cursors, and
  incarnation reset.
- [ ] Implement total identity grouping and renderer-only group rows.
- [ ] Bind non-legacy evidence exactly; keep legacy evidence at request level; expose unbound
  evidence separately.
- [ ] Pair run and tool timing by full identity; render attempts/evidence as points.
- [ ] Implement loaded-scope text search and documented server filters.
- [ ] Preserve selection during upsert, collapse, filter, and timing upgrades.

Completion condition: one pure snapshot drives all Inspector presentation without deriving facts
from timestamps or adjacency.

## 6. P1 Renderer UI and Entry Points

- [ ] Build the full-height Inspector panel with toolbar, sticky table header, virtualized rows,
  waterfall, and detail pane.
- [ ] Implement fixed-height fact/evidence/group rows and keyboard row navigation.
- [ ] Preserve scroll position when older pages prepend and follow only from the tail.
- [ ] Add the active-session header entry point behind `traceDebugEnabled`.
- [ ] Add the message toolbar Inspector entry point with message/request preselection while retaining
  the existing Trace dialog action.
- [ ] Add vue-i18n copy for every supported locale.
- [ ] Provide explicit sparse-Tape and unbound-evidence states for ACP sessions.

Completion condition: historical sessions are useful without Live and large loaded windows remain
virtualized.

## 7. P1 Contract Verification

- [ ] Add the smallest durable projection tests covering every physical kind, nullable/unknown
  names, `other` fallback, `N -> N` totality, and context/Skill body withholding.
- [ ] Add page contract tests for tail/older/newer boundaries, filtered empty pages, last-scanned
  cursors, snapshot consistency, and incarnation mismatch.
- [ ] Add detail disclosure tests for allowlist order, unknown fail-closed behavior, and stored-string
  hashes.
- [ ] Add renderer model tests for equal timestamps, retries, nested identities, legacy evidence,
  delayed endpoint pairing, reset, prepend anchoring, and stale response rejection.
- [ ] Add focused component tests for entry points, virtualization contract, keyboard selection, and
  retained Trace dialog access.

Completion condition: documented cross-module, security, pagination, and identity contracts have
durable regression coverage without mirroring private control flow.

## 8. P2 Committed-head Watcher

- [ ] Add typed subscribe/unsubscribe routes or equivalent renderer-target ownership for active
  Inspector sessions.
- [ ] Reference-count watchers by session and renderer target.
- [ ] Atomically poll `(tapeIncarnationId, maxEntryId)` only while subscribed.
- [ ] Emit payload-free pulses only when the pair changes.
- [ ] Release subscriptions on panel close, session change, renderer destruction, and app shutdown.
- [ ] Pull `newer` pages on pulse; implement pause/resume and follow-tail without changing execution.
- [ ] Add cancellable bounded page filling for loaded-scope text search.

Completion condition: committed tail facts are never starved, uncommitted rows are never observed,
and pause changes only automatic fetching/follow.

## 9. P2 Lifecycle Verification

- [ ] Cover watcher sharing, cleanup, reset, pause/resume catch-up, and no-change polling.
- [ ] Cover terminal facts arriving at the end of a burst.
- [ ] Cover session deletion and renderer destruction while a watcher is active.

Completion condition: the watcher has no timer, window, or session leaks and never pushes row
payloads.

## 10. P3 Sorting, Waterfall, and Large-session Closure

- [ ] Add server-side composite-key keyset sorting for every column that advertises sort support.
- [ ] Use flat fact presentation for non-canonical global sorts and restore grouping in canonical
  order.
- [ ] Add measured expression/index-only migrations only where fixture query plans require them.
- [ ] Add column resizing, horizontal pan/zoom, range brushing, and timing tooltips.
- [ ] Add bounded session-level sanitized support export composition.
- [ ] Add a representative high-entry-count fixture and responsive query/render regression.

Completion condition: every remaining #2154 acceptance criterion is implemented or the issue text
has been explicitly updated to an agreed narrower contract.

## 11. Whole-change Review

- [ ] Compare the implementation against every invariant and acceptance criterion in `spec.md`.
- [ ] Verify no new authority, table, write action, raw payload path, or timestamp identity exists.
- [ ] Review all unknown-schema and malformed-data paths for fail-closed behavior.
- [ ] Review query plans, scan budgets, watcher lifecycle, renderer memory growth, and subscription
  cleanup.
- [ ] Review route and event naming for accurate authority and scope.
- [ ] Remove obsolete implementation code and temporary probes created during development.

## 12. Final Validation

- [ ] Run the smallest relevant main and renderer suites after each slice.
- [ ] Run `pnpm run format`.
- [ ] Run `pnpm run i18n`.
- [ ] Run `pnpm run lint`.
- [ ] Run `pnpm run typecheck`.
- [ ] Run focused Tape, session route/query, renderer model, and component suites.
- [ ] Manually verify light/dark presentation, keyboard navigation, session/message entry points,
  legacy/unbound evidence, sparse ACP Tape, reset, pause/resume, and large-session scrolling.

Completion condition: all selected checks pass, or any unrelated pre-existing failure is recorded
with evidence before handoff.

## Commit Slices

1. `docs(tape): specify trace inspector`
2. `feat(tape): add inspector read model`
3. `feat(session): expose inspector diagnostics`
4. `feat(renderer): add tape inspector`
5. `feat(tape): follow committed inspector facts`
6. `feat(renderer): complete inspector tooling`
7. `test(tape): cover inspector contracts`

Commit boundaries may combine adjacent slices when a public contract would otherwise land without
its only consumer. Commit messages describe the concrete capability or behavior, never the review
process.
