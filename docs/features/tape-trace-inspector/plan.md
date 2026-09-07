# Tape Trace Inspector Implementation Plan

## Status

The core implementation is complete on `feat/tape-trace-inspector`. The P1 read model and UI, P2
committed follow, and P3 sorting, export, and large-session work have landed. Container-responsive
layout and the overview timeline have also landed. Final semantic and activity-context refinements
are in progress after manual inspection showed that inapplicable values looked unresolved, model
requests without a loaded Tape parent looked invalid, and message Entries required unnecessary detail
navigation. Request-result projection now exposes final accumulated Transcript blocks without
claiming unavailable chunk replay. Exact evidence-parent discovery and bounded directed historical
loading now keep independent 100-row windows from looking like broken correlation. The authority,
Live, pagination, and security contracts remain unchanged.

The work is split into reviewable commits. Before every commit, review the complete staged diff for
hidden side effects, compatibility regressions, boundary behavior, performance, security, naming,
test sufficiency, and future maintenance cost. Fix findings before committing. Do not push from this
worktree.

## Objective

Implement the read-only session-level Inspector defined in `spec.md` while preserving Tape,
Runtime, Transcript, and request-evidence authority boundaries.

## Ownership

- Tape infrastructure owns bounded physical row reads and snapshot consistency.
- Tape application owns total Entry projection and sanitized detail projection.
- A narrow Tape inspection capability exposes the projection to session queries.
- Session routes own typed renderer-facing page, evidence, detail, and subscription contracts.
- The renderer feature owns grouping, timing, search, selection, pagination, and presentation.
- A demand-driven main-process watcher owns committed-head pulses in P2.

## 1. SDD and Contract Baseline

- [x] Land `spec.md` and this plan after a full document review.
- [x] Confirm every resolved decision has an implementation owner and no unresolved marker.

Completion condition: the committed SDD is sufficient to reject an implementation that drops
Entries, leaks payloads, invents identity, or relies on unbounded reads.

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

Completion condition: bound requests, diagnostics, and unmatched model requests are discoverable
without list payloads, and every Entry selection has a safe, explicit detail result.

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
- [x] Bind attempt evidence exactly; keep null-attempt evidence at request level; expose unmatched
  model requests separately without claiming that an execution context is missing.
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
- [x] Provide explicit sparse-Tape, diagnostics, and unmatched model-request states for ACP
  sessions.

Completion condition: historical sessions are useful without Live and large loaded windows remain
virtualized.

## 7. P1 Contract Verification

- [x] Add the smallest durable projection tests covering every physical kind, nullable/unknown
  names, `other` fallback, `N -> N` totality, and context/Skill body withholding.
- [x] Add page contract tests for tail/older/newer boundaries, filtered empty pages, last-scanned
  cursors, snapshot consistency, and incarnation mismatch.
- [x] Add detail disclosure tests for allowlist order, unknown fail-closed behavior, and stored-string
  hashes.
- [x] Add renderer model tests for equal timestamps, retries, nested identities, request-scoped
  evidence, delayed endpoint pairing, reset, prepend anchoring, and stale response rejection.
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
- [x] Cover evidence-only append, cursor deduplication, pause, window visibility, and teardown
  cleanup.
- [x] Cover terminal facts arriving at the end of a burst.
- [x] Cover session deletion and renderer destruction while a watcher is active.
- [x] Cover bounded read-failure backoff and automatic recovery.

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
  request-scoped/diagnostic/unmatched requests, sparse ACP Tape, reset, pause/resume, and
  large-session scrolling.

Baseline condition: all previously selected checks passed, or an unrelated pre-existing failure was
recorded with evidence before the renderer usability refinement began.

Automated final validation passed with 161 focused main-process tests and 249 focused renderer
tests. The main-process migration suite emitted its existing ignored duplicate-column diagnostics;
all selected tests still passed. The remaining manual presentation pass requires an interactive
desktop session and does not change the read, identity, or security contracts above.

## 13. Renderer Usability Refinement

- [x] Replace the per-row waterfall column with a bounded three-lane overview above the ledger.
- [x] Separate actual-time and canonical-sequence modes while preserving authoritative timing and
  explicit point semantics.
- [x] Promote approved structured facts into localized row and group summaries without extending
  list IPC or exposing payloads.
- [x] Make the ledger container-responsive at 360, 520, 760, and 960 px without horizontal
  scrolling; retain wide-mode column sorting and resizing.
- [x] Make toolbar controls deterministic in compact widths and expose the existing side-panel
  maximize pattern for focused inspection.
- [x] Show detail only after selection, as a wide side pane or compact in-panel overlay, with
  keyboard-safe close and focus restoration.
- [x] Bound timeline rendering independently from the number of loaded records and preserve
  selection, pagination anchors, collapse, filtering, and Live follow.
- [x] Add the smallest durable renderer coverage for semantic summaries, timeline projection,
  responsive structure, and detail open/close behavior.
- [x] Run a full staged review for side effects, compatibility, edge cases, performance, security,
  naming, test sufficiency, and maintenance cost before each commit.
- [ ] Re-run the manual presentation matrix after implementation. Automated format, i18n, lint,
  typecheck, focused renderer suites, and production build checks have passed.

Completion condition: the Inspector preserves every existing contract while a first-time user can
orient, scan, and inspect records at every supported side-panel width without horizontal ledger
navigation.

## 14. Semantic State and Evidence Refinement

- [x] Separate explicit status, not-applicable status, and unresolved group status in renderer
  presentation.
- [x] Map explicit successful tool outcomes without mixing unrelated child status vocabularies into
  request or attempt group status.
- [x] Keep duration on run and tool groups only; present fact, attempt, request, and evidence rows as
  point or not-applicable records without repeated `unknown` text.
- [x] Split diagnostic sentinel evidence from ordinary model requests and default-collapse the
  diagnostics lane without changing trace identity or detail access.
- [x] Rename null-attempt evidence as request-scoped rather than claiming it is always legacy, and
  describe evidence without a loaded parent as unmatched rather than missing execution context.
- [x] Right-align tabular time and duration values and keep placeholders visually quiet at all row
  breakpoints.
- [x] Add durable renderer tests for explicit outcome status, group-only timing, evidence category
  separation, default diagnostic collapse, and quiet not-applicable cells.
- [x] Review the full staged change for hidden side effects, compatibility, boundary behavior,
  performance, security, naming, test sufficiency, and maintenance cost before each commit.
- [ ] Re-run the manual screenshot matrix. Automated format, i18n, lint, typecheck, focused renderer
  suites, and production build checks have passed.

Completion condition: the ledger reserves visual emphasis for authoritative states and actionable
gaps, while point facts and diagnostics remain discoverable without dominating routine scanning.

## 15. Chronological Request and Message Context Refinement

- [x] Replace the ambiguous unmatched-evidence category with a neutral model-request collection
  while preserving the independent trace cursor and exact binding rules.
- [x] Order model requests whose Tape parent is not loaded by actual `(createdAt, traceId)` time and
  keep them visible in the actual-time overview.
- [x] Add fixed-height inline previews for cached user and assistant transcript messages without
  expanding Inspector list IPC.
- [x] Restrict assistant previews to visible content blocks and exclude reasoning, errors, and tool
  payloads; enforce committed-session ownership and bounded output.
- [x] Keep diagnostics separate and default-collapsed; retain on-demand provider request detail.
- [x] Add renderer tests for actual-time request ordering, safe preview projection, fixed row height,
  and session isolation.
- [x] Review the complete staged diff for hidden side effects, compatibility, edge cases,
  performance, security, naming, test sufficiency, and maintenance cost.
- [x] Run format, i18n, lint, typecheck, focused projection and renderer suites, and the production
  build.
- [ ] Re-run the manual presentation matrix.

Completion condition: routine scanning reads as a time-oriented activity history, while full
provider payloads and uncommon diagnostics remain available only through deliberate inspection.

## 16. Request Context Legibility

- [x] Replace aggregate final-message summaries on request rows with the latest visible Transcript
  activity strictly preceding each trace.
- [x] Show a bounded latest-first context tail in request detail while keeping tool arguments and
  results out of ledger summaries.
- [x] Persist normalized AI SDK instructions, messages, tools, and provider options in new request
  evidence so deliberate detail inspection contains the runtime context supplied to the SDK.
- [x] Narrow redaction to reusable credentials and preserve token accounting and ordinary
  diagnostics.
- [x] Warn beside the Trace setting that model request content is persisted locally and may contain
  sensitive prompt data.
- [x] Add focused renderer, persistence-redaction, and provider-runtime regression coverage.
- [x] Complete staged risk review and full automated checks.
- [ ] Manually verify wide and compact presentation with newly recorded requests.

Completion condition: consecutive model requests are distinguishable at a glance, deliberate detail
inspection exposes the useful normalized request context, and reusable credentials remain protected.

## 17. Final Request Result Projection

- [x] Persist optional logical-round, request-sequence, and physical-attempt identity on new
  provider-generated Transcript blocks.
- [x] Close a pending narrative block when a transparent provider retry changes physical attempt so
  content from two attempts cannot merge under one identity.
- [x] Project final accumulated content, reasoning, tool-call arguments, errors, and media presence
  from the committed session's existing Transcript cache.
- [x] Prefer the latest exactly correlated block in each model-request ledger row while retaining a
  bounded, explicitly non-binding temporal fallback for older blocks.
- [x] Separate observed result, later conversation activity, preceding context, and persisted model
  request in detail; state that provider chunks are not retained.
- [x] Keep tool results out of model-generated output and retain existing Tape outcome detail.
- [x] Add focused main and renderer coverage for retry boundaries, identity selection, null/zero
  attempt discipline, legacy fallback, block projection, and bounded text.
- [x] Complete staged risk review and automated validation.
- [ ] Run the manual wide/compact presentation pass with a newly generated multi-round session.

Completion condition: a developer can scan what each model request ultimately produced and inspect
its bounded final blocks without mistaking temporal fallback for binding or final snapshots for
token-by-token replay.

## 18. Tape Terminology and Historical Loading Feedback

- [x] Align user-facing nouns with the Tape core primitives: Tape, Entry, Anchor, and View.
- [x] Keep DeepChat run, request, attempt, journal, contract, message, tool, and lineage terms
  explicitly scoped to implementation semantics or derived groups.
- [x] Preserve established wire identifiers such as `FactRecord` for compatibility while calling
  durable rows Tape Entries in the UI.
- [x] Rename the unmatched association state so it does not conflate a Tape Entry, assembled View,
  and runtime execution context.
- [x] Explain at lane/detail level that a matching Entry may be outside the loaded window or that
  older evidence may lack stable identity; never infer a parent from timestamp proximity.
- [x] Preserve the prepend scroll anchor and add accessible result feedback for loaded Entries,
  bounded ranges without matches, reaching the beginning of Tape, and failed reads.
- [x] Add focused renderer coverage for unmatched ordering, non-repeated lane guidance, prepend
  anchoring, successful load feedback, and failure cleanup.

Completion condition: the Inspector uses Tape terms without overstating DeepChat-specific concepts,
and every older-page action has an observable result while preserving reading position.

## 19. Exact Evidence Parent Discovery

- [x] Add an incarnation-scoped, metadata-only route that resolves at most 200 exact
  `(messageId, requestSeq, physicalAttempt)` identities to provider-attempt Entry IDs.
- [x] Resolve all identities in one query through the existing unique provenance index, selecting
  only provenance keys and Entry IDs.
- [x] Preserve null-versus-zero identity, return explicit null results for absent completion
  Entries, and reject stale incarnations without payload disclosure.
- [x] Track resolution results independently from Tape and evidence cursors and discard late results
  after session or incarnation reset.
- [x] Distinguish loaded, earlier, filtered/newer, currently unrecorded, request-scoped, and
  diagnostic presentation without timestamp inference or repeated warning copy.
- [x] Add a contextual earlier-history action that loads at most six contiguous older pages per
  activation, preserves the viewport anchor, and can be continued explicitly.
- [x] Disable directed loading when non-canonical sorting or Entry filters can hide the exact target.
- [x] Add durable contract, query-plan, renderer-model, stale-response, bounded-loading, and
  interaction coverage after implementation.
- [x] Complete staged risk review and automated validation.
- [ ] Manually verify a new multi-request session at wide and compact widths.

Completion condition: independent bounded windows no longer look like failed correlation, exact
older parents are discoverable and loadable without sparse hydration, and interrupted or
request-scoped evidence remains truthful without being presented as an error.

## 20. Chronological Ledger and Runtime Context

- [x] Make Time mode render one stable actual-time merge of loaded Tape Entries and ordinary model
  requests while preserving Sequence mode's canonical grouped `entryId` order.
- [x] Keep timestamps display-only and preserve exact evidence binding, independent cursors,
  incarnation reset, selection, and bounded pagination.
- [x] Recognize the persisted Memory View and directive View Anchor manifests, surface bounded
  selection/budget summaries, and expose historical manifest detail without resolving mutable
  current Memory content.
- [x] Expose credential-redacted, bounded previews and structured detail for known physical
  `tool_call` and `tool_result` schemas; keep unknown schemas metadata-only.
- [x] Replace generic unresolved endpoint copy with classified earlier/filter/Live/not-recorded/
  inconsistent explanations and avoid repeating the same warning in Status and Duration.
- [x] Add the smallest durable projection and renderer coverage for the changed disclosure,
  ordering, stable tie-break, and incomplete-state contracts.
- [x] Review the complete staged diff for hidden side effects, compatibility, edge cases,
  performance, security, naming, test sufficiency, and maintenance cost.
- [x] Run format, i18n, lint, typecheck, focused Tape/route/renderer suites, and the production build.
- [ ] Manually verify Time/Sequence switching, tool/Memory detail, and incomplete groups at wide and
  compact widths.

Completion condition: the loaded activity reads in the order a developer experienced it, exact
runtime context is visible where it was durably recorded, and unavailable history is described
precisely without weakening authority or credential boundaries.

## Delivery Notes

- Evidence remains request-scoped when `physicalAttempt` is null; null is never treated as zero and
  the UI does not claim that every request-scoped record is legacy.
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
