# Tape Trace Inspector Implementation Plan

## Status

The core implementation is complete on `feat/tape-trace-inspector`. The P1 read model and UI, P2
committed follow, and P3 sorting, export, and large-session work have landed. A renderer usability
refinement is in progress after the manual presentation pass exposed unavoidable horizontal
overflow and weak event scanability at supported side-panel widths. The data, identity, Live,
pagination, and security contracts remain unchanged.

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

- [x] Add shared Zod contracts and TypeScript types for fact pages, evidence pages, detail results,
  cursors, filters, and canonical sort.
- [x] Add bounded tail/older/newer storage reads beside the existing Tape entry readers.
- [x] Read incarnation, snapshot head, rows, and page evidence counts in one explicit SQLite
  transaction.
- [x] Implement total `traceInspectorProjection.ts` mapping with `tool` and `other` fallbacks,
  nullable names, bounded code values, and context/Skill body withholding.
- [x] Reuse stored-string SHA-256 semantics and expose integrity only through existing verifiers.
- [x] Add the narrow Tape Inspector reader capability and forward it through `SessionTape` and the
  session data/query boundary.
- [x] Extend the Tape layer-boundary allowlist only for this narrow consumer.

Completion condition: a session can request a bounded canonical page without loading an effective
view or omitting any physical Tape row.

## 3. P1 Evidence and Detail Reads

- [x] Add session-scoped trace metadata keyset pagination with optional message/request/attempt
  filters and no endpoint/headers/body fields.
- [x] Keep its cursor independent from Tape entry cursors.
- [x] Separate evidence history ordering from a row-append Live cursor so equal timestamps cannot
  hide later random IDs.
- [x] Preserve the append high-water mark across supported tail deletes and advance exhausted
  filtered scans to the session head.
- [x] Batch page-level evidence counts rather than issuing per-row lookups.
- [x] Add `sessions.getTapeInspectorRecordDetail` with incarnation validation.
- [x] Implement exact schema allowlists, then redaction, then byte/collection truncation.
- [x] Return hash/size-only detail for unknown event/anchor schemas and all context/Skill bodies.
- [x] Define the row-to-detail capability matrix in the renderer client.

Completion condition: bound and unbound evidence are discoverable without payloads, and every fact
selection has a safe, explicit detail result.

## 4. P1 Typed Session Routes

- [x] Register list, evidence, and detail route contracts.
- [x] Add `SessionQuery`, session data-port, and `SessionClient` methods using existing validation and
  session-existence checks.
- [x] Keep list and evidence outputs JSON-bounded and fully projected through public schemas.
- [x] Preserve existing Trace dialog and ReplaySlice routes unchanged.

Completion condition: renderer access is typed and context-isolated with no direct database or raw
IPC path.

## 5. P1 Renderer Model

- [x] Add a focused `tape-inspector` feature directory.
- [x] Implement stable fact/evidence maps, canonical keys, request generations, cursors, and
  incarnation reset.
- [x] Implement total identity grouping and renderer-only group rows.
- [x] Bind non-legacy evidence exactly; keep legacy evidence at request level; expose unbound
  evidence separately.
- [x] Pair run and tool timing by full identity; render attempts/evidence as points.
- [x] Implement loaded-scope text search and documented server filters.
- [x] Preserve selection during upsert, collapse, filter, and timing upgrades.

Completion condition: one pure snapshot drives all Inspector presentation without deriving facts
from timestamps or adjacency.

## 6. P1 Renderer UI and Entry Points

- [x] Build the full-height Inspector panel with toolbar, sticky table header, virtualized rows,
  waterfall, and detail pane.
- [x] Implement fixed-height fact/evidence/group rows and keyboard row navigation.
- [x] Preserve scroll position when older pages prepend and refresh newer facts from the canonical
  tail cursor; automatic follow remains a P2 watcher responsibility.
- [x] Add the active-session header entry point behind `traceDebugEnabled`.
- [x] Add the message toolbar Inspector entry point with message/request preselection while retaining
  the existing Trace dialog action. Message-only actions select a request only when the identity is
  unambiguous; an explicit `requestSeq` is never guessed or replaced.
- [x] Add vue-i18n copy for every supported locale.
- [x] Provide explicit sparse-Tape and unbound-evidence states for ACP sessions.

Completion condition: historical sessions are useful without Live and large loaded windows remain
virtualized.

## 7. P1 Contract Verification

- [x] Add the smallest durable projection tests covering every physical kind, nullable/unknown
  names, `other` fallback, `N -> N` totality, and context/Skill body withholding.
- [x] Add page contract tests for tail/older/newer boundaries, filtered empty pages, last-scanned
  cursors, snapshot consistency, and incarnation mismatch.
- [x] Add detail disclosure tests for allowlist order, unknown fail-closed behavior, and stored-string
  hashes.
- [x] Add renderer model tests for equal timestamps, retries, nested identities, legacy evidence,
  delayed endpoint pairing, reset, prepend anchoring, and stale response rejection.
- [x] Add focused component tests for entry points, virtualization contract, keyboard selection, and
  retained Trace dialog access.

Completion condition: documented cross-module, security, pagination, and identity contracts have
durable regression coverage without mirroring private control flow.

## 8. P2 Committed-head Watcher

- [x] Add typed subscribe/unsubscribe routes or equivalent renderer-target ownership for active
  Inspector sessions.
- [x] Reference-count watchers by session and renderer target.
- [x] Atomically poll `(tapeIncarnationId, maxEntryId)` only while subscribed.
- [x] Emit payload-free pulses only when the pair changes.
- [x] Release subscriptions on panel close, session change, renderer destruction, and app shutdown.
- [x] Pull `newer` pages on pulse; implement pause/resume and follow-tail without changing execution.
- [x] Poll bounded newer request-evidence metadata only while the Inspector is active and unpaused.
- [x] Add cancellable bounded page filling for loaded-scope text search.

Completion condition: committed tail facts are never starved, uncommitted rows are never observed,
and pause changes only automatic fetching/follow.

## 9. P2 Lifecycle Verification

- [x] Cover watcher sharing, cleanup, reset, pause/resume catch-up, and no-change polling.
- [x] Cover evidence-only append, cursor deduplication, pause, and teardown cleanup.
- [x] Cover terminal facts arriving at the end of a burst.
- [x] Cover session deletion and renderer destruction while a watcher is active.

Completion condition: the watcher has no timer, window, or session leaks and never pushes row
payloads.

## 10. P3 Sorting, Waterfall, and Large-session Closure

- [x] Add server-side composite-key keyset sorting for every column that advertises sort support.
- [x] Use flat fact presentation for non-canonical global sorts and restore grouping in canonical
  order.
- [x] Add measured expression/index-only migrations only where fixture query plans require them.
- [x] Add column resizing, horizontal pan/zoom, range brushing, and timing tooltips.
- [x] Add bounded session-level sanitized support export composition.
- [x] Add a representative high-entry-count fixture and responsive query/render regression.

Completion condition: every remaining implementation criterion is complete within the no-inference
contract. Issue closure additionally requires the multi-request message-entry acceptance decision
recorded in `spec.md`.

## 11. Whole-change Review

- [x] Compare the implementation against every invariant and acceptance criterion in `spec.md`.
- [x] Verify no new authority, table, write action, raw payload path, or timestamp identity exists.
- [x] Review all unknown-schema and malformed-data paths for fail-closed behavior.
- [x] Review query plans, scan budgets, watcher lifecycle, renderer memory growth, and subscription
  cleanup.
- [x] Review route and event naming for accurate authority and scope.
- [x] Remove obsolete implementation code and temporary probes created during development.

## 12. Validation Baseline

- [x] Run the smallest relevant main and renderer suites after each slice.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
- [x] Run focused Tape, session route/query, renderer model, and component suites.
- [ ] Manually verify light/dark presentation, keyboard navigation, session/message entry points,
  legacy/unbound evidence, sparse ACP Tape, reset, pause/resume, and large-session scrolling.

Baseline condition: all previously selected checks passed, or an unrelated pre-existing failure was
recorded with evidence before the renderer usability refinement began.

Automated final validation passed with 161 focused main-process tests and 249 focused renderer
tests. The main-process migration suite emitted its existing ignored duplicate-column diagnostics;
all selected tests still passed. The remaining manual presentation pass requires an interactive
desktop session and does not change the read, identity, or security contracts above.

## 13. Renderer Usability Refinement

- [ ] Replace the per-row waterfall column with a bounded three-lane overview above the ledger.
- [ ] Separate actual-time and canonical-sequence modes while preserving authoritative timing and
  explicit point semantics.
- [ ] Promote approved structured facts into localized row and group summaries without extending
  list IPC or exposing payloads.
- [ ] Make the ledger container-responsive at 360, 520, 760, and 960 px without horizontal
  scrolling; retain wide-mode column sorting and resizing.
- [ ] Make toolbar controls deterministic in compact widths and expose the existing side-panel
  maximize pattern for focused inspection.
- [ ] Show detail only after selection, as a wide side pane or compact in-panel overlay, with
  keyboard-safe close and focus restoration.
- [ ] Bound timeline rendering independently from the number of loaded records and preserve
  selection, pagination anchors, collapse, filtering, and Live follow.
- [ ] Add the smallest durable renderer coverage for semantic summaries, timeline projection,
  responsive structure, and detail open/close behavior.
- [ ] Run a full staged review for side effects, compatibility, edge cases, performance, security,
  naming, test sufficiency, and maintenance cost before each commit.
- [ ] Re-run format, i18n, lint, typecheck, focused renderer suites, and the manual presentation
  matrix after implementation.

Completion condition: the Inspector preserves every existing contract while a first-time user can
orient, scan, and inspect records at every supported side-panel width without horizontal ledger
navigation.

## Delivery Notes

- Legacy evidence remains request-scoped when `physicalAttempt` is null; null is never treated as
  zero.
- Group identities include the Tape incarnation, and run/request bridges remain stable regardless
  of pagination traversal order.
- Pause and resume preserve the durable Tape cursor and the independent evidence cursor;
  evidence-only appends follow without advancing Tape.
- The detail pane exposes correlation, timing, sanitized Raw data, and the existing message
  diagnostics. Explicit request diagnostics never fall back to a different request.
- Message toolbar actions currently provide only `messageId`. A single request group can be selected
  unambiguously; multiple request groups remain for explicit user selection rather than guessing.

## Original Commit Plan

1. `docs(tape): specify trace inspector`
2. `feat(tape): add inspector read model`
3. `feat(session): expose inspector diagnostics`
4. `feat(renderer): add inspector projection store`
5. `feat(renderer): add inspector panel`
6. `feat(tape): follow committed inspector facts`
7. `feat(renderer): complete inspector tooling`
8. `test(tape): cover inspector contracts`

Commit boundaries may combine adjacent slices when a public contract would otherwise land without
its only consumer. Commit messages describe the concrete capability or behavior, never the review
process.
