# Main Process Structured Logging

## Background

DeepChat previously routed Main-process `console.*` calls through `electron-log` and persisted them as
free-form text in `logs/main.log`. That persistence boundary accepted arbitrary arguments, so it could
not enforce stable event identities, correlation fields, record-size bounds, or content privacy.
Important Agent failures lost their error classification, while high-frequency protocol and process
logs could persist payload-shaped data that had little operational value.

The Main process needs one local, queryable diagnostic stream that answers operational questions
without becoming telemetry, an audit history, or a second source of execution truth.

## Decision

DeepChat will replace the Main text log with a single structured JSON Lines stream:

```text
<userData>/logs/main.jsonl
<userData>/logs/main.old.jsonl
```

The cutover is atomic from a released-product perspective. A new version writes `main.jsonl` only;
it does not dual-write a new `main.log`. An old `main.log` left by a previous version is neither read,
migrated, appended, nor deleted.

Only an explicit, typed Main logger may persist records. Native `console.*` remains available for
non-persistent compatibility and development output but is not intercepted or redirected to the
JSONL file. A dedicated synchronous persistence adapter owns validated appends directly; no shared
logging singleton or business module may write the file. This architecture does not certify
arbitrary legacy console arguments as content-safe; their removal or sanitization remains a separate
subsystem concern.

## Goals

1. Persist every Main log record as one independently parseable, versioned JSON object per physical
   line.
2. Keep persisted event volume low by recording actionable lifecycle boundaries, state transitions,
   degradations, terminal outcomes, integrity failures, and bounded timing summaries.
3. Reject content-shaped logging by construction: no prompt, transcript, Tape payload, tool
   input/output, provider body, protocol payload, terminal stream, secret, SQL parameter, command, or
   arbitrary object may enter `main.jsonl`.
4. Preserve useful failure classification without serializing arbitrary `Error` fields or sensitive
   error messages.
5. Correlate Agent Run, Session, Delegation, Turn, and admission events with identifiers that exist at
   each lifecycle stage.
6. Record admission queue wait and active permit hold intervals without changing fairness, abort,
   suspend/resume, or release behavior.
7. Honor the existing logging setting, profile path, rotation bound, and open-log-folder behavior.
8. Keep logger failures fail-open and bounded: diagnostics must never alter application behavior.
9. Keep persistence local. Do not add analytics, an external exporter, a collector, an SDK, or a
   network request.

## Log Value Policy

Every existing Main log call that previously reached the file through interception must be
classified for its persistent disposition before the cutover.

| Classification | Persistent behavior | Examples |
| --- | --- | --- |
| Required | Typed event in `main.jsonl` | startup terminal, database migration failure, process crash, Run terminal, delegation settlement, queue-full admission |
| Console-only | No file output | legacy diagnostics that remain outside the persistent contract |
| Aggregate or rate-limit | Typed summary or transition event | repeated provider fallback, watcher restart, embedding retry, tool catalog degradation |
| Exclude | No persistent output | stream chunks, PTY/stdout/stderr text, prompt/messages, tool payloads, full URLs, SQL/params, environment dumps |
| Add | New typed event or bounded metric | Agent admission wait/hold, Run start/terminal, delegation child bind/suspend/resume/terminal |

An event is valuable only when it can change a diagnosis or an operational action. A log that merely
proves a function ran, repeats an unchanged state, or emits one record per stream/protocol chunk is not
a persisted operational event.

## JSONL Record Contract

Every persisted line has this envelope:

```ts
interface MainLogRecordV1 {
  v: 1
  ts: string
  seq: number
  level: 'error' | 'warn' | 'info'
  event: MainLogEventName
  process: 'main'
  processInstanceId: string
  appVersion: string
  context: MainLogEventContext
}
```

Required invariants:

- `ts` is an ISO-8601 wall-clock timestamp.
- `seq` increases monotonically within one `processInstanceId`, including buffered startup records.
- `event` comes from the closed Main event catalog.
- Severity is owned by the event definition, not chosen independently at each call site.
- Each event has an event-specific context type and runtime projector. Unknown fields are never
  copied into the persisted record.
- The maximum physical record size is 16 KiB, including its trailing LF delimiter. Optional fields
  are omitted before serialization; serialized JSON bytes are never cut in the middle.
- Newlines and control characters inside accepted strings are escaped by JSON serialization, so one
  event always occupies one physical line.
- No free-form persisted `message`, `args`, or `metadata` escape hatch exists.
- Invalid or oversized events that reach projection are dropped. Production emits one rate-limited,
  payload-free native console warning; development and focused tests may surface the contract
  violation. A fully disabled logger with no console sink does no projection, sequence allocation,
  serialization, or warning work.

The console renderer may produce a fixed human-readable description from the event name and safe
projected context. Console rendering is not a second persisted log.

## Event Catalog Rules

The V1 catalog is deliberately limited to these low-frequency operational boundaries:

- `app.startup`, `app.shutdown`, `app.update`, and `process`;
- database initialization and fixed startup-component degradation;
- `agent.run` and `agent.admission`;
- `orchestration.delegation`;
- durable Run diagnostics and delegation reconciliation terminal outcomes or failures; normal
  resumed recovery is not a terminal event.

`app.shutdown.terminal` reports the shared teardown outcome before the claimed terminal action runs,
because relaunch, exit, and installer handoff may terminate the process before a later append.
`app.shutdown.action.failed` records the uncommon case where that claimed action returns an error;
there is no action-success event.

The catalog must not contain events for individual provider stream chunks, ACP protocol messages,
PTY chunks, window focus changes, normal queue mutations, or normal refresh loops.

## Privacy Contract

Persisted event contexts use allowlisted primitives, enums, bounded counts, durations, and explicit
correlation identifiers. They never accept arbitrary objects.

Finite non-negative durations are rounded to microsecond precision and clamped at 30 days. The cap
keeps the V1 numeric contract bounded without dropping long-lived process or permit diagnostics.
Terminal events omit an optional duration instead of inventing zero when a safe monotonic start or
end reading is unavailable; diagnostic clock failures must not change application behavior.

The following content is prohibited from every persisted event, including error and debug paths:

- user, system, assistant, task, delegation, or handoff text;
- message content, prompt assembly, transcript, or Tape payload/meta;
- tool arguments, results, output previews, terminal output, stdout, or stderr;
- provider headers, request/response bodies, stream chunks, or raw provider errors;
- tokens, API keys, credentials, cookies, OAuth code/state, complete URLs, or URL query/fragment;
- SQL text with values, bound parameters, database passwords, or database row content;
- command text or arguments, environment values, complete `PATH`, or process option dumps;
- absolute paths, user-controlled filenames, Electron/native objects, or arbitrary object graphs;
- arbitrary `Error.message`, stack, cause, or enumerable Error properties.

Paths are represented as controlled logical categories when required. URLs are represented only by
an allowlisted provider/channel identity or a normalized host when the event explicitly permits it.
Counts and byte lengths are preferred to hashes; content hashes are not a general privacy boundary.
Opaque Session and Message correlation IDs that do not satisfy the bounded identifier grammar are
projected as deterministic SHA-256 fingerprints. This narrow correlation fallback does not change
durable business IDs and never persists the raw foreign representation.

## Error Contract

Persisted errors use a safe classification owned by the failing operation:

```ts
interface SafeLogError {
  category:
    | 'aborted'
    | 'timeout'
    | 'queue_full'
    | 'closed'
    | 'permission'
    | 'provider'
    | 'persistence'
    | 'protocol'
    | 'integrity'
    | 'configuration'
    | 'resource'
    | 'unknown'
  retryable?: boolean
}
```

An event projector may derive this structure from a known typed error, but it may not serialize the
source object. Event-specific classifications may add a closed enum field, but the shared error
shape accepts no free-form code. `process.uncaught_exception` and `process.unhandled_rejection`
persist category only; V1 does not persist stack frames.

## Correlation Contract

Correlation fields are event-specific because identities appear at different lifecycle stages:

- delegation/admission events require `parentSessionId`, `delegationId`, and `turnId`;
- child-bound events add `childSessionId`;
- Loop Run events require `runId`, `sessionId`, and `messageId`;
- provider attempt events may add `requestSeq` and `physicalAttempt`;
- fields that do not yet exist are omitted rather than invented or assigned an ambiguous value.

Permit queue events must not require a `runId`: admission occurs before child Session and Loop Run
creation. A generic `sessionId` must not be used when parent and child ownership could be confused.

## Run Diagnostics

`agent.run.started` and `agent.run.terminal` are emitted only after the matching Execution Journal
commit returns a newly-created receipt. A failed or conflicting Journal commit produces no matching
diagnostic event. Loop terminal events include logical-round and tool-call counts for that Run;
resumed Runs subtract the message-level accounting present before the Run. Loop and deferred-tool
terminal events include monotonic duration only when both safe clock readings are available.

The internal observer receives identities, kind, outcome, the durable stop reason, optional
duration, and counts. It never receives Journal payloads, prompts, tool input/output, or terminal
error text. The Main logging adapter maps unknown durable stop reasons to the explicit `unknown`
diagnostic value before persistence rather than attributing them to a known subsystem. Observation
and diagnostic clock failures cannot change the durable Run lifecycle.

## Admission Diagnostics

`AgentInvocationAdmission` records both low-volume lifecycle events and bounded in-memory
distributions:

- `agent.admission.queued`;
- `agent.admission.granted` with measured `waitMs`, acquisition sequence, active/pending counts;
- `agent.admission.released` with measured active `holdMs` and release reason;
- `agent.admission.rejected` with `queue_full`, `aborted`, or `closed`;
- `agent.admission.closed` with terminal counts, dropped-observation count, and p50/p95/max
  summaries.

Timing uses a monotonic clock. Each resume starts a new wait interval; each grant starts a new hold
interval; suspend/release ends the current hold interval. Suspended time is not hold time. Observer
and metric failures are swallowed and cannot change admission accounting. Wait summaries include
both granted waits and queued waits abandoned by abort or close, so long rejected waits do not
artificially lower the distribution. The `closed` event is a close-time snapshot; active permits may
release afterward. Observations leave the permit critical path through a bounded, ordered queue;
teardown drains that queue before later infrastructure is closed.

When either monotonic endpoint is unavailable or moves backward, the individual `waitMs` or
`holdMs` field is omitted and the interval is excluded from distributions. An acquisition rejected
before entering the queue retains a known `waitMs: 0` without consulting the clock.

When neither JSONL persistence nor the development console is active, admission and delegation
metrics may continue bounded in-memory accounting but skip observation queue insertion and
`setImmediate` scheduling. Re-enabling an output affects subsequent observations only; disabled-time
payloads are never replayed.

Recent wait and hold distributions retain at most 256 samples. They are process-local diagnostics,
reset on restart, and are not recovery or accounting facts. The admission implementation owns its
collector instead of coupling to the Memory diagnostics lifecycle.

Delegation lifecycle observations use a bounded ordered queue. If that queue overflows, one
`orchestration.delegation.observations.dropped` warning reports the coalesced loss count after the
surviving backlog is dispatched. Teardown dispatches that warning before resolving, but does not
wait for asynchronous logging work. A turn terminal event includes `durationMs` only when the
current process observed that turn's monotonic start. Recovery does not relabel time since process
startup as the complete turn duration; when the pre-restart monotonic baseline is unavailable, the
field is omitted.

## Logging Setting And Startup

Persistence has three states: `unknown`, `enabled`, and `disabled`.

- The file transport starts disabled and does not create a log file or directory.
- While the authoritative persisted setting is unknown, validated typed records enter an
  in-memory buffer bounded to 64 records and 64 KiB.
- When either bound is exceeded, the oldest buffered records are removed until both bounds hold. The
  logger retains only a dropped-record count; sequence numbers are not reused, so a later file may
  contain an explainable sequence gap.
- When enabled, the logger resolves the effective Electron `userData` path, enables persistence, and
  flushes surviving buffered records synchronously in sequence order. It then writes one fixed
  `logging.startup_buffer.dropped` event when the dropped-record count is non-zero.
- When disabled, the buffer is discarded and persistence remains off.
- After the initial decision, disabled logging does not buffer.
- A crash before the authoritative setting is known is not persisted. It may still reach the native
  console. This intentionally preserves the default-off privacy contract.
- A runtime setting change gates persistence immediately after the setting is stored; the existing
  application restart may remain for compatibility.

## File, Rotation, And Failure Semantics

- Active file: `logs/main.jsonl`.
- Retained archive: `logs/main.old.jsonl`.
- On POSIX, the validated log directory is forced to `0700` and each validated active file to
  `0600`; an archive inherits the active file mode through rename. Windows relies on the effective
  user-data profile ACLs rather than emulating POSIX modes.
- Soft active-file limit: 10 MiB.
- Maximum record: 16 KiB.
- Writes remain synchronous after event selection keeps volume low. This preserves ordering and
  crash-tail reliability without an async flush lifecycle.
- The adapter reuses one validated append descriptor and its observed file size between records.
  Disablement, adapter failure, and rotation close that descriptor; rotation validates and opens the
  new active file before its first append. Ordinary writes use one syscall; a legal short write is
  completed with bounded forward-progress checks.
- Before any read or tail truncation, and after opening an append descriptor, the adapter revalidates
  the log directory and active path and requires its exact 64-bit filesystem identity to match the
  opened descriptor with exactly one hard link. Long-lived append descriptors repeat that identity
  check every 64 records, bounding writes to an unlinked or replaced file without adding a metadata
  syscall to every low-volume event. A mismatch disables persistence without mutating the new path.
  Rotation validates before rename and validates the archive against the same retained descriptor
  afterward. This also preserves the boundary on platforms where `O_NOFOLLOW` is unavailable.
- Rotation asks the filesystem to replace the previous archive by renaming the complete active file
  over it, without an application-level pre-delete. It never crops a byte range, truncates the active
  file to satisfy the cap, appends a human-readable crop marker, adds a suffix or writes a non-JSON
  marker.
- An ordinary replacement failure before mutation leaves the active file and existing archive
  intact. One immediate retry handles a transient `EACCES`, `EBUSY`, or `EPERM`; a second failure or
  storage-level I/O failure may leave filesystem state indeterminate. In either case, persistence is
  disabled for the rest of the process and one payload-free native console warning is emitted.
- Before the first enabled append, an incomplete final line from an interrupted prior write is
  removed without changing complete preceding records. Tail repair scans at most one maximum-sized
  record plus its delimiter. Because the physical limit includes LF, an unterminated tail of 16 KiB
  or more cannot be a partial valid record; the complete damaged active file is retained as the one
  archive and a clean active stream resumes. An archive/recovery I/O failure disables persistence
  instead of blocking Main with an unbounded scan.
- A record rejected by the persistence contract is dropped in isolation. The logger continues with
  later records and emits one payload-free `logging.record.dropped` event identifying the rejected
  sequence and fixed reason. Only storage, descriptor, or file-identity failures disable persistence
  for the rest of the process.
- Adapter, projection, serialization, repair, and rotation failures never affect application
  behavior.
- JSONL is best-effort local diagnostics, not an audit log, transaction journal, or power-loss-safe
  store.

## Source Boundaries

- Main and shared runtime code do not import `electron-log`.
- Main business modules emit typed events through the event catalog.
- Native `console.*` is never persisted automatically.
- Utility processes and workers do not write `main.jsonl` directly. Any diagnostic selected for
  persistence must reach Main as a bounded typed event for validation; legacy worker/utility error
  IPC and console output remain outside the persistent contract.
- Renderer/preload console output is outside this architecture. Existing renderer performance
  NDJSON and CLI audit JSONL retain their own schemas, gates, and retention behavior.

## Compatibility

- The existing `loggingEnabled` setting and settings IPC shape remain unchanged.
- The log-folder action continues opening `<userData>/logs`.
- Existing `main.log` files remain untouched but are no longer appended.
- `renderer-performance.ndjson` and `audit.jsonl` remain separate streams.
- No database migration, external service, renderer UI, or preload capability is introduced.
- Existing Console development behavior remains available without persistence redirection.

## Acceptance Criteria

1. An enabled process creates `logs/main.jsonl` under the effective profile and never appends a new
   `main.log`.
2. Every non-empty line in the active file and a normal-rotation archive parses as one
   `MainLogRecordV1`. A damaged-tail recovery archive preserves all preceding valid records and may
   retain one final opaque unterminated tail that readers must ignore.
3. Disabled logging creates neither the Main JSONL file nor its directory solely because the logger
   loaded; unknown-state buffering is bounded and discarded when disabled.
4. Console output remains human-readable and is not duplicated into a text file.
5. No Main business module imports `electron-log`, uses a persistent variadic logger, or can attach
   arbitrary metadata to a persisted event.
6. Tests prove prohibited sentinel values cannot enter a record through typed contexts, errors,
   unknown fields, oversized values, rotation failures, or startup buffering.
7. Rotation preserves complete JSON lines and never invokes crop behavior.
8. Existing high-risk payload logs cannot reach the persistent transport after cutover; required
   diagnostics are represented by safe typed summaries.
9. High-frequency success/protocol/stream logs do not persist; required lifecycle and terminal
   events remain available.
10. Run, Delegation, Turn, child binding, suspend/resume, and terminal events carry the identities
    available at their lifecycle stage without payload text.
11. Admission tests cover immediate/queued grant, queue full, abort race, suspend/resume, duplicate
    release, close, wait/hold timing, bounded distributions, and observer failure isolation.
12. Logging and observation failures do not change Main startup, shutdown, provider, tool, Tape,
    delegation, or admission behavior.
13. Targeted tests, format, i18n, lint, node/web typecheck, and relevant Main suites pass, except for
    environment-gated coverage whose blocker and skipped tests are documented explicitly.
14. Every implementation commit is reviewed for hidden side effects, compatibility, edge cases,
    performance, security, naming, tests, and maintenance cost before commit.
15. No remote Git operation is performed.

## Constraints

- Use pnpm and existing dependencies only.
- Do not introduce OTel, an analytics SDK, a metrics daemon, a telemetry endpoint, or a network
  exporter.
- Keep logs local, setting-gated, bounded, and content-free.
- Prefer stable enums, counts, and durations over arbitrary strings.
- Do not use JSONL as a recovery fact source or copy durable Tape/Journal facts into content fields.
- Preserve context isolation and existing typed IPC boundaries.

## Non-Goals

- Distributed tracing, remote observability, product analytics, or crash reporting.
- A log viewer, dashboard, search UI, or renderer/preload log collection.
- Persistent metric history beyond the bounded Main JSONL stream.
- Replacing CLI audit or renderer performance diagnostics.
- Migrating, parsing, rewriting, or deleting historical `main.log` files.
- Repository-wide removal or sanitization of legacy native-console diagnostics; they remain outside
  the persistent transport and are not certified by this file-format privacy contract.
- Logging every function, request, protocol message, provider chunk, or state mutation.

## Open Questions

None. The persistence format, ownership, privacy model, event-selection policy, setting behavior,
rotation semantics, and Agent diagnostic scope are fixed by this specification.
