# Tape Trace Inspector

## Status

Implemented. This specification is the normative contract for the session-level Tape Trace
Inspector requested by [#2154](https://github.com/ThinkInAIXYZ/deepchat/issues/2154).

## Problem

DeepChat already records durable execution evidence in Tape and provider request evidence in
`deepchat_message_traces`. The existing message-level Trace dialog exposes Request, View, Entries,
Budget, and nested Execution diagnostics, but it does not provide a session-wide causal view of
Tape facts, physical runs, provider attempts, tool operations, compaction, and terminal states.

Developers need a DevTools-style inspector that correlates these records without creating another
source of truth, weakening redaction boundaries, or requiring a full session to cross IPC or render
at once.

## Authority Model

The Inspector is a read-only derived view. It is never an authority and never writes annotations or
repairs history.

| Source | Authority |
| --- | --- |
| Tape | Immutable chronological history and durable execution facts |
| Runtime | Current online execution state |
| Transcript | Renderer-facing conversation read model |
| `deepchat_message_traces` | Redacted and bounded provider request evidence |
| Inspector | Correlation, grouping, timing, filtering, and presentation only |

The Inspector must not add a second fact table, copy provider traces into Tape, rewrite historical
rows, or treat its grouping and status projections as durable state.

## Goals

- Open a session-level inspector from the active session header.
- Open the same inspector from a message with its authoritative message/request selection applied
  without guessing a request identity.
- Present every committed Tape row in canonical `entryId` order.
- Correlate runs, provider attempts, tool operations, views, contracts, and trace evidence through
  authoritative identities.
- Present request traces in the same correlated view without assigning them Tape identities.
- Keep list IPC metadata-only, bounded, paginated, typed, and context-isolated.
- Preserve current diagnostics and sanitized export behavior through an on-demand detail pane.
- Keep large sessions responsive through keyset pagination and row virtualization.
- Add committed-only live follow without changing Tape producers.
- Preserve selection and scroll position across pagination, grouping, filtering, and live updates.

## Non-Goals

- A replacement for Tape, Runtime, Transcript, or message trace storage.
- A writable debugger, history editor, retry control, or permission authority.
- Adding provider request start facts or inventing durations that are not currently recorded.
- Adding a second event log or a materialized Inspector table.
- Exposing context/Skill bodies, raw tool arguments/results, raw provider content, or unredacted
  request data.
- Deleting the existing message-level Trace dialog during the migration period.
- A standalone Electron window in the first release.

## Terminology

- **Fact row**: one committed Tape entry projected into bounded list metadata.
- **Evidence row**: one `deepchat_message_traces` record projected into bounded metadata. It is not
  a Tape fact.
- **Group row**: a renderer-only synthetic row for a run, request, attempt, or tool operation.
- **Tape spine**: all fact rows in canonical `entryId` order for one Tape incarnation.
- **Tape incarnation**: the UUID on the canonical `session/start` bootstrap anchor.
- **Canonical order**: ascending `entryId` within one Tape incarnation.
- **Bound evidence**: trace evidence with an exact authoritative parent identity.
- **Legacy/unattributed evidence**: trace evidence lacking `physicalAttempt`; it belongs to a
  request group but not to a physical attempt.
- **Unbound evidence**: trace evidence that cannot be associated with a current Tape request group.
- **Fact status**: a status or outcome explicitly present on one immutable fact.
- **Group status**: a renderer projection from matched facts currently loaded.
- **Online status**: current state supplied by Runtime, when a future view explicitly joins it.

## Core Invariants

1. The Tape spine contains every committed Tape row, including context rows.
2. Projection is total: `N` input Tape rows produce `N` fact records.
3. `entryId` is the only canonical Tape ordering key. Timestamps are never identity.
4. Fact keys are stable only within one Tape incarnation.
5. Context and Skill rows remain visible, but their bodies never cross Inspector IPC.
6. Request evidence never receives an `entryId` and never participates in a Tape cursor.
7. Grouping changes row visibility only. It never creates a second fact hierarchy.
8. Duration, status, and evidence binding are never inferred from adjacency or coincident
   timestamps.
9. Missing, reversed, incomplete, or unverifiable timing is explicit `unknown`.
10. List responses contain bounded metadata, not prose summaries or raw payloads.
11. All visible copy is assembled in the renderer through vue-i18n.
12. Pause affects follow only. It never pauses execution or changes durable data.
13. Clearing the visible view resets renderer state only.

The no-inference discipline applies uniformly:

- no neighboring-fact duration inference;
- no `started-without-terminal` to `running` status inference;
- no legacy trace to physical-attempt binding inference.

## Data Model

### Fact list record

The shared typed contract exposes one bounded record per Tape row:

```ts
interface TapeInspectorFactRecord {
  recordType: 'fact'
  key: `entry:${number}`
  entryId: number
  kind: DeepChatTapeEntryKind
  family:
    | 'context'
    | 'journal'
    | 'contract'
    | 'view'
    | 'attempt'
    | 'anchor'
    | 'message'
    | 'lineage'
    | 'tool'
    | 'other'
  name: string | null
  sourceType?: DeepChatTapeSourceType
  sourceId?: string
  sourceSeq?: number
  createdAt: number
  runId?: string
  messageId?: string
  requestSeq?: number
  logicalRound?: number
  physicalAttempt?: number
  providerToolCallId?: string
  childOrdinal?: number
  facts?: {
    toolName?: string
    toolSource?: 'agent' | 'mcp'
    targetServer?: string
    providerId?: string
    modelId?: string
    status?: string
    outcome?: string
    stopReason?: string
    retryDecision?: string
    errorCode?: string
    isError?: boolean
    usage?: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
    }
  }
  hashes?: {
    payloadHash?: string
    metaHash?: string
    manifestHash?: string
  }
  integrity?: 'valid' | 'invalid' | 'unverified'
  traceEvidenceCount?: number
}
```

Rules:

- `kind` retains the physical Tape kind.
- `name` remains nullable because physical rows do not all have a name.
- `family` is a UI semantic category, not the physical schema.
- Unknown names, sources, and future facts use `other`; they are never omitted.
- `tool_call` and `tool_result` use `tool` unless a recognized semantic family is more specific.
- `facts` contains only bounded typed code values and numbers.
- There is no `summary`, `duration`, payload, meta object, or raw JSON in the list record.
- `integrity` is absent when no authoritative verifier exists. Absence means not applicable.
- Context and Skill rows expose approved identity/reference fields and existing hashes only.

### Evidence list record

Trace evidence uses a separate metadata-only contract and cursor:

```ts
interface TapeInspectorEvidenceRecord {
  recordType: 'evidence'
  key: `trace:${string}`
  traceId: string
  messageId: string
  requestSeq: number
  logicalRound?: number
  physicalAttempt?: number
  providerId: string
  modelId: string
  createdAt: number
  truncated: boolean
}
```

The list record never contains endpoint, headers, body, or another payload preview.

Evidence association follows exact identities:

- `requestSeq = 0`: persisted diagnostic sentinel without request identity; keep it in the unbound
  evidence lane;
- non-null `physicalAttempt`: bind to `(messageId, requestSeq, physicalAttempt)`;
- null `physicalAttempt`: bind only to `(messageId, requestSeq)` and label
  `legacy/unattributed`;
- never coalesce null to zero;
- evidence not matching a current request group appears in a session-level unbound lane.

Within the evidence domain, order physical attempts deterministically, then use `createdAt` and
`traceId` as stable tie-breakers. These fields do not create a Tape identity or cross-domain total
order.

### Renderer-only records

Group rows are never returned by main. The renderer derives stable keys that include the current
incarnation and full composite identity:

- run: `runId`;
- request: `messageId + requestSeq`;
- attempt: `messageId + requestSeq + physicalAttempt`;
- tool operation: `runId + requestSeq + providerToolCallId + optional childOrdinal`.

An identified request is nested under a run only when a recognized fact supplies an authoritative
bridge containing both identities. Message equality, Tape position, and timestamps do not create a
run/request binding. Requests without such a bridge remain standalone groups.

Facts without sufficient identity remain at their canonical position without a synthetic parent.
Collapse hides matching fact/evidence rows; it does not move or reparent facts.

## Total Projection and Content Boundary

`traceInspectorProjection.ts` owns physical row parsing and list projection. It uses exact known
`kind + name + schemaVersion` readers where available and falls back to `other` metadata.

Projection must not use `getBySessionExcludingContext`, effective Tape views, Tape search, or
`getTapeContext` as its source. Those APIs intentionally omit or transform facts.

The projection follows this disclosure order:

1. Select fields from an exact schema allowlist.
2. Apply the existing redaction rules to allowed content.
3. Apply byte and collection bounds.

Truncation is not redaction. Unknown events and anchors return identity, source, hashes, size, and
timestamps only. They never return a truncated raw payload as a fallback.

Recognized execution journal schemas may expose their complete stored fact body because their
constructors persist identities, bounded code values, and hashes rather than raw arguments,
responses, or error messages. This permission does not apply to unknown event names or schema
versions.

## Hash and Integrity Semantics

- Generic row `payloadHash` is SHA-256 over the exact stored `payload_json` string.
- Generic row `metaHash` is SHA-256 over the exact stored `meta_json` string.
- The Inspector reuses `hashString`; it does not canonicalize or parse before hashing.
- Manifest hashes and integrity use the existing manifest verifier.
- Other artifact integrity is exposed only when an existing authoritative verifier owns it.
- No hash match is promoted into a generic integrity claim.
- Integrity checks that are expensive or require payloads run in on-demand detail, not page lists.

## Fact Status Semantics

Server filtering applies only to explicit per-fact fields:

- execution outcome `isError`;
- provider attempt `status`, retry decision, and error code;
- run terminal `outcome`;
- other recognized fact-local status codes.

Group status is renderer-only and may be incomplete while a counterpart lies outside loaded pages.
A missing terminal fact produces `open/unknown`, not `running`. Runtime online status remains a
separate authority and is not synthesized from Tape absence.

## Timing Semantics

List DTOs contain `createdAt`, never a duration. The renderer pairs exact facts:

| Span | Start | End | Identity |
| --- | --- | --- | --- |
| Run | `execution/run_started` | `execution/run_terminal` | `runId` |
| Tool operation | `execution/dispatch_committed` | `execution/tool_outcome` | Full operation identity |
| Provider attempt | No authoritative start in P1 | `provider/attempt_completed` | Attempt identity |
| Request trace | Evidence point only | None | `traceId` |

Rules:

- run and tool spans appear only after both authoritative endpoints are loaded;
- attempt and trace records render as `◆` in P1;
- an endpoint arriving in a later page upgrades the existing row by stable key;
- absent or reversed endpoints render `unknown` and never clamp to zero;
- group totals use the same matched endpoints and remain `unknown` when incomplete.

## Tape Pagination Contract

Tape pages use incarnation-scoped keyset pagination. The initial experience is tail-first.

```ts
type TapeInspectorPageMode = 'tail' | 'older' | 'newer'

type TapeInspectorCursor =
  | { sort: 'entryId'; entryId: number }
  | { sort: 'name'; direction: SortDirection; name: string | null; entryId: number; snapshotMaxEntryId: number }
  | { sort: 'kind'; direction: SortDirection; kind: DeepChatTapeEntryKind; entryId: number; snapshotMaxEntryId: number }
  | { sort: 'createdAt'; direction: SortDirection; createdAt: number; entryId: number; snapshotMaxEntryId: number }

interface ListTapeInspectorPageInput {
  sessionId: string
  expectedTapeIncarnationId?: string
  mode: TapeInspectorPageMode
  cursor?: TapeInspectorCursor
  limit?: number
  filters?: TapeInspectorFactFilters
  sort?: TapeInspectorSort
}
```

- `tail`: scan backward from the page snapshot head; `cursor` is absent.
- Canonical `older`: scan `entryId < cursor.entryId` backward.
- Canonical `newer`: scan `entryId > cursor.entryId` forward up to the page snapshot head.
- A non-canonical bootstrap returns the first page in the selected direction. `older` continues in
  that order; `newer` is rejected because live follow is canonical-only.
- A non-canonical cursor carries its direction, server sort value, `entryId` as the deterministic
  unique tie-breaker, and the bootstrap `snapshotMaxEntryId`. Continuations retain that snapshot so
  rows appended during navigation cannot enter or reorder the result set.
- Records are returned in the selected server sort order; canonical pages return ascending
  `entryId` even when the storage scan ran backward.
- `limit` has a server-owned upper bound.
- A filtered bounded scan advances using the last scanned key, not the last returned record.
- An empty result may still return a continuation cursor.

The output is a discriminated union:

```ts
type ListTapeInspectorPageOutput =
  | {
      status: 'ok'
      tapeIncarnationId: string
      snapshotMaxEntryId: number
      records: TapeInspectorFactRecord[]
      nextCursor: TapeInspectorCursor | null
    }
  | {
      status: 'reset'
      tapeIncarnationId: string
      snapshotMaxEntryId: number
    }
```

The first bootstrap request may omit `expectedTapeIncarnationId`. Every subsequent historical or
live request supplies the incarnation returned by bootstrap. A mismatch returns `reset` with no
records from the new incarnation.

Incarnation, snapshot head, page rows, and page-level evidence counts are read inside one explicit
synchronous SQLite read transaction. Relying on current single-threaded call ordering is not the
contract.

The renderer increments a local request generation on session, filter, sort, or incarnation change.
Responses from an older generation are discarded. On `reset`, it clears facts, evidence, groups,
selection, cursors, and scroll anchors before bootstrapping again.

## Evidence Pagination Contract

Session trace metadata uses an independent bounded page route and composite keyset cursor. It may
filter by `messageId`, `requestSeq`, and `physicalAttempt` for lazy group expansion. The unbound lane
uses the session-wide form.

`older` pages are ordered by `(createdAt, traceId)` descending for history expansion. `newer` pages
use a read-side append cursor backed by the trace row ID and return append order ascending. The
append cursor is not exposed on evidence records and is never an identity or cross-domain ordering
key. This split prevents a random trace ID inserted in an existing timestamp bucket from falling
behind a Live cursor. The trace store preserves the row-ID high-water mark across supported delete
paths for the lifetime of the database connection, so SQLite cannot reuse a deleted tail row ID
behind an active cursor. Cursors are not persisted across process restarts. A page returns at most
200 metadata records. When a filtered `newer` scan is exhausted, its cursor advances to the
session-wide row-ID head rather than repeatedly scanning non-matching rows. Null `physicalAttempt`
remains null in both directions.

Its cursor belongs only to `deepchat_message_traces`. It does not contain an `entryId`, does not
advance Tape history, and never returns headers/body. Existing message-level trace diagnostics
remain the payload authority for Request details.

## Filtering and Sorting

P1 canonical server filters:

- physical kind and semantic family;
- exact/prefix name;
- explicit per-fact status;
- errors only;
- message ID.

Free text initially searches only loaded metadata and labels that the scope is loaded records. P2
adds cancellable bounded page filling without sending payloads to the renderer.

Canonical sort is ascending `entryId`. Before #2154 closes, server-side composite-key keyset sorting
must support the columns that advertise sorting. Name, kind, explicit fact status, and start time may
be supported; duration and waterfall do not advertise sorting because they are renderer-derived and
may be incomplete.

Non-canonical sorting is a flat fact result mode. Correlation identities and detail navigation remain
available, but synthetic hierarchical group rows are not shown because globally sorted group members
are not necessarily contiguous. Returning to canonical order restores grouping without changing
selection.

Live incremental pulling and follow-tail operate only in canonical `entryId` order. Selecting a
non-canonical sort retains the subscription but suspends automatic insertion; returning to canonical
order catches up from the durable cursor.

Indexes are performance artifacts, not authorities. This feature adds no table migration. Pure
index migrations are allowed after representative fixtures and `EXPLAIN QUERY PLAN` demonstrate a
need. Any scan fallback must remain bounded and cancellable.

## Detail Contract

The fact list route never carries payloads. A narrow route serves a selected Tape row:

```ts
sessions.getTapeInspectorRecordDetail({
  sessionId,
  expectedTapeIncarnationId,
  entryId
})
```

It returns either `reset`, `not_found`, or a bounded detail projected from an exact schema
allowlist. The route applies allowlist, redaction, and truncation in that order and returns a
sanitized raw representation rather than the unfiltered database JSON.

| Selection | Detail capability |
| --- | --- |
| Recognized Tape fact | Inspector detail route |
| Provider evidence | Existing message trace diagnostics |
| View manifest | Existing manifest diagnostics |
| Nested execution | Existing nested execution audit |
| Message replay/export | Existing bounded ReplaySlice route |
| Message fact | Hash/metadata plus transcript navigation |
| Context/Skill | Hash and approved references only |
| Unknown/no-message fact | Identity, provenance, hash, size, and timestamp only |

The detail pane exposes Summary, Payload, Timing, Provenance, Integrity, and sanitized Raw sections
only when the selected capability supports them. Selections carrying a `messageId` can open the
existing message diagnostics, preserving an authoritative `requestSeq` when one is present. Empty
states state why content is unavailable rather than silently omitting a selected row.

## Support Export Contract

`SessionQuery` owns the bounded session-level support export because it already validates the
session and can compose the two independent read domains without creating another authority:

```ts
sessions.exportTapeInspectorSupportTrace({
  sessionId,
  expectedTapeIncarnationId
})
```

The export is a versioned diagnostic document, not a ReplaySlice and not a lossless history dump.
It contains two separate arrays and never invents a total order across them:

- at most 200 of the most recent Tape facts, returned in chronological `entryId` order;
- at most 200 of the most recent request-evidence metadata records, chronological within the
  evidence domain.

Tape fact details reuse the exact detail projection: allowlist, then redaction, then truncation.
Their combined structured `data` has a 256 KiB UTF-8 budget, with the newest facts retaining data
first. Rows over budget remain present with record, disclosure, provenance, hashes, and sizes.
Context/Skill bodies and unknown-schema payloads remain metadata-only. Evidence exports identity,
provider/model, timing point, and truncation metadata only; endpoint, headers, and body never enter
the support document.

The document reports independent `facts`, `evidence`, and `detailData` truncation flags. The Tape
fact array, incarnation, and `snapshotMaxEntryId` share one explicit read transaction. Composition
with the evidence table is a bounded best-effort diagnostic read, not a cross-table atomic snapshot;
the two arrays retain their own authorities and cursors. An incarnation mismatch returns `reset`
and produces no file.

## Live Follow

P2 uses a demand-driven read-side head watcher. Tape producers and transaction paths remain
unchanged.

Lifecycle:

1. A renderer subscribes for one session when its Inspector enables Live.
2. Main reference-counts subscriptions by session and starts one watcher per active session.
3. Each interval reads `(tapeIncarnationId, maxEntryId)` atomically.
4. A changed pair emits a typed, payload-free pulse to subscribed renderer targets.
5. The watcher stops when the final subscription or owning window is released.

The pulse contains only:

```ts
{ sessionId, tapeIncarnationId, maxEntryId }
```

The renderer then pulls `newer` pages from its last canonical cursor. A pulse never inserts a row.
Incarnation change resets the Inspector. Pause disables automatic pulls and follow-tail while
leaving the watcher subscription and execution unchanged. Resume catches up from the durable
cursor.

Provider evidence is a separate append-ordered domain, so a Tape head pulse cannot announce an
evidence-only write. While the Inspector is active and unpaused, the renderer therefore polls one
bounded `newer` evidence page per interval from its independent append cursor. Trace IDs dedupe
repeated rows. Session/filter reset discards the cursor and late responses; panel teardown stops the
timer. This refresh never changes or advances the Tape cursor and never returns request payloads.

The interval naturally coalesces bursts and always reads the current committed head. An
after-commit notifier remains a future optimization only if measured latency requires it.

## Renderer Architecture

The feature lives under `src/renderer/src/components/tape-inspector/` and owns one pure derived
snapshot consumed by the table, waterfall, search, grouping, and detail pane.

State includes:

- `Map<stableKey, factOrEvidence>`;
- canonical/sorted key arrays;
- synthetic group projection;
- selected stable key;
- collapse state;
- Tape and evidence cursors;
- request generation;
- paired timing spans;
- Live, pause, and follow-tail state;
- scroll anchor key plus pixel offset.

Rows use `RecycleScroller` with fixed fact/evidence heights and explicit synthetic group heights.
Prepending older pages captures the first visible stable key and offset, then restores it after the
upsert. New live rows follow only when the user was already at the tail. Pagination, collapse, and
timing upgrades never steal selection.

### UI layout

Before:

```text
+-- Trace -------------------------------------+
| Request / View / Entries / Budget / Execution|
| One message-level diagnostic at a time       |
+----------------------------------------------+
```

After:

```text
+-- Tape Inspector ------------------------------------------------------+
| Live  Filter...  Type  Status  Errors  Pause  Export                  |
+------------------------------------------------------------------------+
| Name / Initiator | Kind | Status | Start | Duration | Waterfall       |
| Run ...                                                               |
|   Provider attempt ...                                                |
|     Provider request evidence ...                                     |
|   Tool dispatch ...                                                   |
|   Tool outcome ...                                                    |
+------------------------------------------------------------------------+
| Summary | Payload | Timing | Provenance | Integrity | Raw             |
+------------------------------------------------------------------------+
```

The implementation provides a full-height in-session panel, sticky headers, keyboard navigation,
resizable columns, sequence plus available-actual waterfall rendering, horizontal pan/zoom, range
brushing, and timing tooltips.

All copy uses vue-i18n. The existing `traceDebugEnabled` setting gates both Inspector entry points.

## Entry Points and ACP

- The active session header opens the whole-session Inspector.
- The message toolbar always scopes the Inspector to the authoritative `messageId` available on the
  action. If an authoritative `requestSeq` is also supplied, that request is selected exactly. If
  it is absent and the loaded message scope contains exactly one request group, that group is
  selected. Multiple request groups remain visibly unselected so the user can choose; the
  Inspector never guesses latest/max from timing or provider-round metadata.
- The existing Trace dialog remains available during migration.
- ACP sessions may have a nearly empty Tape spine; this is expected.
- Session trace evidence that cannot bind to a current Tape group remains available through the
  evidence lane and its empty-state action. The renderer never synthesizes Tape facts for ACP.

## Security and Privacy

- Routes are typed and available only through the existing context-isolated bridge.
- List routes are metadata-only and bounded.
- Detail routes use exact schema allowlists; unknown payloads fail closed to hash/size metadata.
- Request evidence payloads retain existing persistence redaction and size limits.
- Context and Skill bodies never cross Inspector IPC, including details and export.
- Raw means sanitized projected JSON, not raw database JSON.
- Copying a Tape fact uses the same projected detail shown in the pane; request-detail copy retains
  the existing persisted trace redaction and size boundary.
- Support export is stricter than request detail: request evidence is metadata-only.
- No endpoint accepts a write, delete, clear, retry, or permission mutation.

## Performance Contract

- No Tape page or evidence page is unbounded.
- No initial session open scans from entry 1 to reach the tail.
- Storage queries use keyset pagination, never offset pagination.
- Renderer rows are virtualized.
- Filter fallback scans have an explicit row budget and continuation cursor.
- Trace existence is batched per page, not queried once per fact row.
- Integrity and payload parsing that are not needed for list metadata are deferred to detail.
- A representative high-entry-count fixture and query-plan assertions gate completion.

## Compatibility

- No existing Tape row, trace row, transcript row, or schema meaning changes.
- No table migration is required; index-only migrations remain allowed.
- Existing Tape search/context/effective-view behavior is unchanged.
- Existing Trace dialog routes and renderer entry point remain available.
- Provider and ACP execution behavior is unchanged.
- Unknown future facts remain visible as `other` with fail-closed details.
- Reset and resumed runs are isolated by incarnation and stable identities rather than timestamps.

## Resolved Decisions

1. Tape is the sole chronological spine; traces are evidence rows, not Tape facts.
2. Request traces appear in the correlated view as lazy evidence children or in the unbound lane.
3. Legacy traces never bind to a physical attempt without `physicalAttempt`.
4. Semantic family mapping is total and has an `other` fallback.
5. Context rows remain in the spine while their bodies are withheld.
6. Grouping is a renderer identity overlay, not a durable tree.
7. Duration is renderer-derived from exact endpoint identities and absent from list DTOs.
8. Fact, group, and Runtime statuses are distinct.
9. Tail, older, and newer reads share one incarnation-scoped page contract.
10. Page rows, incarnation, head, and evidence counts share an explicit SQLite read transaction.
11. Evidence metadata has a separate session-scoped cursor.
12. Main returns structured code values; renderer owns localized prose.
13. Detail disclosure is allowlist, then redaction, then truncation.
14. Truncation is not redaction.
15. Unknown event and anchor payloads fail closed.
16. No table migration is allowed; measured index-only migrations are allowed.
17. Non-canonical server sorting uses composite keysets and flat result presentation.
18. Tape Live uses a demand-driven committed-head watcher with no Tape write-path changes; evidence
    inserts only reserve the table's internal row-ID append token.
19. ACP's sparse Tape spine and unbound evidence are expected states.
20. The Inspector has no write or permission-authority behavior.
21. Session support export keeps Tape facts and request evidence in separately bounded arrays.
22. Cross-store support export is best-effort composition, never a claimed atomic snapshot.
23. Live evidence refresh uses its own bounded newer cursor and active-panel lifecycle.
24. Group keys include the Tape incarnation, and run/request bridges are independent of page load
    order.
25. Explicit request selection and diagnostics never fall back to another request when evidence is
    absent.
26. Message-only preselection selects a request only when the visible identity is unambiguous.

## Acceptance Criteria

- The Inspector opens for a session and from a message with the message scope selected. A request is
  preselected only when its authoritative `requestSeq` is supplied or the message has one request
  group.
- Every committed Tape kind, nullable name, and unknown fact remains represented exactly once.
- Tape facts, execution journal facts, provider attempts, view facts, and request evidence appear in
  one correlated view when available.
- Evidence never acquires a Tape identity, and legacy evidence never acquires an inferred attempt.
- Runs, attempts, and tool operations collapse without moving the scroll anchor or selection.
- Sequence is always drawable; actual spans use authoritative endpoints; unknown timing is explicit.
- Live append is deterministic, payload-free, incarnation-safe, and does not steal selection.
- Pause and resume affect automatic pulls and follow only.
- Filters apply to their documented server or loaded scope, and the UI states that scope.
- Advertised column sorts operate across paginated results.
- Detail, copy, and export honor allowlist, redaction, truncation, integrity, and size contracts.
- Correlation remains correct for equal timestamps, retries, nested tools, resets, and restarts.
- Large-session fixtures remain responsive with bounded queries and virtualized rows.
- Existing message-level Trace diagnostics remain available during migration.
- Renderer, preload, routes, and events remain typed and context-isolated.

## Open Questions

None in the Inspector architecture.

The current message action owns a `messageId` but no authoritative `requestSeq`. Closing #2154 must
either accept message-scoped, no-guess behavior for messages with multiple request groups or first
add an authoritative request identity to that upstream action. This is an acceptance-scope choice,
not permission for the Inspector to infer identity.
