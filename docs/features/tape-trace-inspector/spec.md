# Tape Trace Inspector

## Status

Core implementation is complete. The renderer presentation is being refined for scanability and
adaptive side-panel widths. This specification is the normative contract for the session-level
Tape Trace Inspector requested by [#2154](https://github.com/ThinkInAIXYZ/deepchat/issues/2154).

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
- Keep the Inspector understandable without horizontal scrolling at the side panel's supported
  widths.
- Separate session orientation, event scanning, and evidence inspection into an overview timeline,
  semantic ledger, and on-demand detail surface.

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
- **Request-scoped evidence**: trace evidence lacking `physicalAttempt`; it belongs to a request
  group but not to a physical attempt.
- **Diagnostic evidence**: the `requestSeq = 0` sentinel that intentionally has no request identity.
- **Context-unloaded model request**: trace evidence whose corresponding Tape request or attempt
  group is not in the loaded window. The trace remains a valid time-stamped model request; this
  state does not claim that its durable parent is absent.
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
9. Missing, reversed, incomplete, or unverifiable timing for a row that owns an authoritative span
   is explicit and never clamped to zero. Point facts and rows without a timing contract are
   `not-applicable`, not `unknown`.
10. List responses contain bounded metadata, not prose summaries or raw payloads.
11. All visible copy is assembled in the renderer through vue-i18n.
12. Pause affects follow only. It never pauses execution or changes durable data.
13. Clearing the visible view resets renderer state only.

The no-inference discipline applies uniformly:

- no neighboring-fact duration inference;
- no `started-without-terminal` to `running` status inference;
- no request-scoped trace to physical-attempt binding inference.

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

- `requestSeq = 0`: persisted diagnostic sentinel without request identity; keep it in a dedicated,
  default-collapsed diagnostics lane;
- non-null `physicalAttempt`: bind to `(messageId, requestSeq, physicalAttempt)`;
- null `physicalAttempt`: bind only to `(messageId, requestSeq)` and present it neutrally as
  request-scoped evidence; the UI never claims that every such record is legacy;
- never coalesce null to zero;
- evidence not matching a currently loaded request group appears in a session-level model-request
  collection ordered by `(createdAt, traceId)`. Its row may quietly state that execution context is
  not loaded, but it is never labeled unknown, pending association, or invalid.

Diagnostic records remain a separate presentation category. They retain their individual trace
identities and on-demand detail, but the ledger summarizes them behind one collapsed lane so
repeated diagnostics do not dominate the chronological facts. Ordinary model requests remain
visible in actual-time order whether or not the matching Tape group is in the current page window.

Physical attempts remain separated by exact parent identity. Within one parent or the session-level
model-request collection, use `createdAt` and `traceId` as stable evidence-domain ordering keys.
These fields do not create a Tape identity or cross-domain total order.

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
A missing terminal fact produces an unresolved historical group, not `running`. Runtime online
status remains a separate authority and is not synthesized from Tape absence.

Status presentation distinguishes three cases:

- an explicit fact or authoritative group outcome displays its code;
- a fact, evidence row, or synthetic lane without a status contract displays a quiet
  not-applicable mark;
- a status-bearing group whose authoritative fact is not loaded remains unresolved without being
  presented as online or running.

`execution/tool_outcome` maps explicit `isError = false` to success and `isError = true` to error.
Request and attempt groups derive status from their provider-attempt facts, not from a vocabulary
mix of unrelated child facts.

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
- absent or reversed endpoints on run and tool groups render an explicit unresolved pairing state
  and never clamp to zero;
- request groups, attempt groups, individual facts, and evidence rows do not own a duration and
  render a quiet not-applicable mark in the Duration column;
- run and tool totals use the same matched endpoints and remain unresolved when incomplete;
- authoritative duration belongs to the synthetic run or tool group only. Start and end fact rows
  remain point facts and do not duplicate the group duration.

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
filter by `messageId`, `requestSeq`, and `physicalAttempt` for lazy group expansion. Diagnostics and
the session model-request collection use the session-wide form.

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
be supported; duration and overview position do not advertise sorting because they are
renderer-derived and may be incomplete.

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
snapshot consumed by the ledger, overview timeline, search, grouping, and detail pane.

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
| Filter...  Live  Pause  Refresh  Export  Maximize                     |
+------------------------------------------------------------------------+
| Session  |  Model  |  Tools     synchronized overview timeline       |
+------------------------------------------------------------------------+
| Event / bounded summary      | Kind | Status | Start | Duration       |
| Run completed, 12 facts                                              |
|   Provider/model, completed, bounded usage                            |
|   Tool name, target, success, 11 ms                                   |
+--------------------------------------+---------------------------------+
| Virtualized chronological ledger    | on-demand selected detail       |
+--------------------------------------+---------------------------------+
```

The overview timeline is above the ledger rather than repeated as a wide per-row column. It uses
three stable semantic lanes: session, model, and tools. Actual-time mode plots `createdAt` points and
only authoritative run/tool spans; sequence mode plots canonical `entryId` positions. The modes are
explicit and never overlay two coordinate systems in one glyph. Missing duration remains a point,
not a zero-width inferred span.

The overview and ledger are synchronized:

- hover describes the semantic record, local time, and authoritative duration when available;
- clicking an item selects and reveals its ledger row;
- range brushing focuses the visible time window without deleting or reordering ledger records;
- zoom and pan preserve selection;
- filters affect both surfaces, while collapse only changes ledger row visibility;
- an earlier-history boundary states when the overview covers only the loaded window.

The ledger keeps fixed-height virtual rows and renderer-local prose assembled from existing bounded
`facts`. Raw event names and physical kinds remain available as secondary metadata and in detail;
tool name, provider/model, target, explicit outcome, retry decision, error code, and bounded usage
may be promoted into the primary one-line summary. Context/Skill bodies, request payloads, tool
arguments/results, and unknown-schema payloads never enter these summaries.

User and assistant message facts may add a one-line preview from the active session's existing
Transcript cache. A model request row instead shows the latest visible Transcript activity whose
block timestamp is strictly earlier than that trace's `createdAt`. This is a renderer-only context
hint, not a binding claim or provider-body reconstruction. It prevents every request for one final
assistant message from repeating that same final message. Tool activities expose the tool/server
name but not arguments or results. The request detail may show up to eight preceding visible
activities in reverse order so the latest context is first.

The renderer bounds row previews to 220 characters and detail activity text to 4096 characters.
Reasoning, error text, tool arguments/results, and future blocks are excluded from the derived
activity preview. The first request may fall back to the preceding cached user message when no
assistant block predates it. A message outside the committed session or outside the current cache has
no preview; the Inspector does not fetch or copy transcript payloads through its list routes.

For newly recorded AI SDK requests, persisted evidence includes the normalized request inputs passed
to the SDK, including instructions, messages, tool definitions, and provider options when present.
This is a semantic SDK request snapshot, not a claim to be the adapter's final wire encoding. Older
evidence remains readable without synthetic backfill.

The layout responds to the Inspector and remaining ledger container widths, not the window
viewport:

- at 840 px and wider, the unselected ledger exposes Event, Kind, Status, Start, and Duration
  columns, and a selected detail pane may share the width on the right;
- from 560 px through 839 px, Kind and Start collapse into secondary row metadata;
- below 560 px, each row becomes one semantic event cell with compact inline status and timing;
- toolbar actions adopt a deterministic second row and compact icon treatment rather than causing
  horizontal overflow;
- the detail pane does not reserve space without a selection and becomes an in-panel overlay below
  840 px;
- when a wide side detail reduces the remaining ledger below a row breakpoint, the ledger adopts
  that compact row mode rather than retaining hidden or overflowing tracks;
- a maximize action is an optional inspection aid, never a substitute for narrow-width support.

Wide-mode columns remain resizable. Hidden compact-mode columns do not reserve grid tracks or
produce a horizontal scrollbar. Numeric time, duration, and count values use tabular alignment.
Empty status and duration cells use a quiet not-applicable mark rather than repeating `unknown`.
Only incomplete run or tool spans show an unresolved pairing label. Numeric Start and Duration
columns are right-aligned. The diagnostics lane is collapsed by default; expanding it is an
explicit request to inspect the individual evidence rows.

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
- A model request whose Tape group is not currently loaded remains visible in the model-request
  collection and actual-time overview. The renderer never synthesizes Tape facts for ACP.

## Security and Privacy

- Routes are typed and available only through the existing context-isolated bridge.
- List routes are metadata-only and bounded.
- Detail routes use exact schema allowlists; unknown payloads fail closed to hash/size metadata.
- Request evidence payloads retain existing persistence redaction and size limits.
- Credential redaction is exact and recursive. It covers the authentication and API-key headers used
  by current provider traces and the explicit `api_key`/`apiKey` body field. Provider credentials
  used only during provider construction or authentication are not speculative body rules. The
  normalized media URL path also removes URL basic-auth credentials and explicit `apiKey` query
  values while preserving the rest of the URL. The redactor does not use broad `token`, `key`,
  `secret`, or `signature` substring rules. Ordinary diagnostics and tool values such as
  input/output/reasoning token counts, provider replay signatures, usage values, stop reasons, and
  fields merely named `token` or `secret` remain visible. Free-form prompt text is not classified as
  a credential and may contain user-sensitive content; recording is therefore still explicitly gated
  by `traceDebugEnabled`.
- Tape context and Skill entry bodies never cross Inspector IPC as row details or export payloads.
  Content already assembled into an explicitly recorded provider request may appear in that request's
  on-demand evidence detail; support export remains metadata-only for request evidence.
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
- The overview timeline uses bounded pixel buckets or an equivalent bounded render projection; the
  number of timeline DOM nodes must not grow linearly with every loaded point.
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
2. Request traces appear as exact evidence children when their Tape group is loaded; otherwise they
   remain time-ordered model requests with a quiet context-unloaded note. Diagnostic sentinels stay
   in a separate diagnostics lane.
3. Request-scoped traces never bind to a physical attempt without `physicalAttempt`.
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
19. ACP's sparse Tape spine and context-unloaded model requests are expected states.
20. The Inspector has no write or permission-authority behavior.
21. Session support export keeps Tape facts and request evidence in separately bounded arrays.
22. Cross-store support export is best-effort composition, never a claimed atomic snapshot.
23. Live evidence refresh uses its own bounded newer cursor and active-panel lifecycle.
24. Group keys include the Tape incarnation, and run/request bridges are independent of page load
    order.
25. Explicit request selection and diagnostics never fall back to another request when evidence is
    absent.
26. Message-only preselection selects a request only when the visible identity is unambiguous.
27. The waterfall is a synchronized overview above the ledger, not a width-reserving per-row
    column.
28. Actual time and canonical sequence are explicit mutually exclusive display modes.
29. Semantic row summaries use only bounded list metadata already approved for renderer IPC.
30. Responsive behavior follows Inspector container width and never requires maximize to become
    usable.
31. Detail is on demand: wide containers use a side pane, compact containers use an in-panel
    overlay, and closing it restores ledger context.
32. Not-applicable status or duration is distinct from an unresolved authoritative state.
33. Diagnostic evidence is default-collapsed and never presented as a legacy provider request.
34. Message previews are bounded renderer derivations from the active Transcript cache, never new
    Inspector list payloads. Request rows select the latest visible block strictly before the trace,
    not the final aggregate assistant message.
35. Request activity hints do not infer provider input or association; request detail retains the
    independently persisted evidence as the authoritative request snapshot.
36. Credential redaction protects reusable authentication material without masking token accounting
    or other ordinary diagnostics.

## Acceptance Criteria

- The Inspector opens for a session and from a message with the message scope selected. A request is
  preselected only when its authoritative `requestSeq` is supplied or the message has one request
  group.
- Every committed Tape kind, nullable name, and unknown fact remains represented exactly once.
- Tape facts, execution journal facts, provider attempts, view facts, and request evidence appear in
  one correlated view when available.
- Model requests without a loaded Tape parent remain ordered by actual time and are not presented as
  unknown or pending association.
- Loaded user and assistant messages can be understood from bounded inline previews without opening
  detail. Consecutive model requests show their latest preceding visible activity, while reasoning,
  error text, and tool payloads stay excluded from ledger summaries.
- Request detail shows a bounded latest-first context tail. Newly recorded AI SDK request evidence
  includes normalized instructions, messages, tools, and provider options when present; credential
  fields remain masked while token accounting remains visible.
- Evidence never acquires a Tape identity, and request-scoped evidence never acquires an inferred
  attempt.
- Runs, attempts, and tool operations collapse without moving the scroll anchor or selection.
- The synchronized overview supports sequence and actual-time modes, pan/zoom, range brushing,
  selection linkage, explicit points, and unresolved authoritative spans.
- The supported 360, 520, 760, and 960 px Inspector widths do not require horizontal ledger
  scrolling, and localized summaries retain their primary identity.
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
