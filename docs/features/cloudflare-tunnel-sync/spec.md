# Cloudflare Tunnel Device Sync

## Goal and scope

Paired devices automatically exchange durable data in both directions. Changes become eligible after
15 seconds without another relevant write, with at least 60 seconds between automatic sync starts.
Conflicts use last-write-wins (LWW) by modification timestamp. There is no field merge, conflict
selection dialog, CRDT or whole-database replacement in automatic sync.

Settings → Data places Device sync beside R2 and S3-compatible storage. Cloudflare Tunnel provides
connectivity; it is not a hosted data store. One profile exposes a tunnel endpoint and connected
profiles initiate outbound connections. Both sides can edit, upload and receive. The host also relays
accepted changes to its other paired devices. Only the host needs cloudflared; peers can edit offline
and exchange pending changes when it returns. A receiving profile connects to one host; mesh routing
and multiple upstream hosts are outside scope.

This document specifies the automatic sync contract. Implementation completion and executable
validation evidence are tracked in [plan.md](./plan.md). The backup-transfer path remains available
for explicitly requested restore and compatibility; it is not the automatic merge engine.

## Ownership and reuse

- `src/main/sync/host` owns pairing, the public endpoint, connector lifecycle and peer notifications.
- `src/main/sync/peer` owns the outbound connection, staged transfer, acknowledgements and retries.
- Shared sync logic owns scheduling, LWW comparison, the durable change index and batch construction.
  Host and peer use the same comparator and application rules.
- Domain persistence owners record successful writes and apply validated sync units. Session runtime
  admission coordinates safe application; the sync layer cannot cancel a run to make progress.
- ToolchainService owns bundled, managed, system and custom cloudflared executables.
- Settings uses typed preload/IPC clients and its own store, without chat-app imports. Main-process
  scheduling continues when settings is closed; status changes use typed events.

Reuse pairing protection, bounded transport, private staging, integrity verification and resumable
transfer. `SyncService.importBackupFile` and application-wide database maintenance stay exclusive to
manual restore. Automatic sync must not call their close/reopen or suspend-all-sessions workflow.

## Conflict model and data units

Each synchronized unit has a stable `(kind, id)` and a stamp `(modifiedAt, originDeviceId)`.
`modifiedAt` is an integer UTC millisecond write timestamp, not export, arrival or import time.
`originDeviceId` is a persistent random installation identity, separate from a host-issued pairing
record ID. Compare timestamps first and, on equality, compare device IDs lexicographically using a
fixed byte ordering. Every device makes the same choice, independent of delivery order.

New local writes receive a timestamp greater than the last locally issued stamp and the unit's
current stamp, using the wall clock when it is ahead. Persist the clock floor. Remote application
preserves the original stamp; it never calls the local timestamp allocator. Equal stamps are
idempotent. Different payloads with the same stamp are a protocol error, not another overwrite.
A successful import must not manufacture another edit and bounce it back indefinitely.

Timestamp ordering assumes reasonably synchronized device clocks; it cannot discover the real order
of disconnected edits made with incorrect clocks. Compare clocks on connection and surface a clock
error if the difference exceeds five minutes; pause automatic exchange rather than silently adjust
remote timestamps. Reject malformed or implausibly future-dated stamps before advancing a cursor.
The five-minute bound is an internal guard, not a user-configurable conflict policy.

Conflict units follow domain consistency boundaries rather than arbitrary SQLite rows:

| Data | Unit and overwrite rule |
| --- | --- |
| Conversation | One session bundle: portable metadata, ordered messages, dependent content and canonical history. The newer complete bundle wins atomically. |
| Agent, provider and MCP definitions | One stable definition, with its dependent portable settings. Different definition IDs coexist. |
| Portable application settings | One allowlisted setting key; never replace the entire settings document. |
| Custom/system prompts | One prompt ID, including removal; a file timestamp cannot stand in for every prompt's modification time. |
| Memory | One canonical memory record plus its domain deletion identity; honor existing memory tombstone semantics. Derived vectors and indexes remain local. |

A session bundle is deliberately the LWW unit because editing, truncation, ordering and execution
history are related. Concurrent edits to different sessions survive independently; concurrent edits
to the same session choose one complete history. The losing device's divergent content is overwritten,
including locally added messages in that session. Do not claim message-level collaborative merging.
Opening a session or changing transient selection must not update its sync stamp.

The domain mapping must enumerate canonical tables, fields, dependencies and local-only fields before
implementation. Do not serialize all SQLite tables generically. Local tape sequence IDs require
mapping through the session owner; imported historical tool runs are data and never execute again.
Runtime handles, pending executions/approvals, scheduler jobs and deliveries, machine paths, toolchain
choices, caches, derived projections, credentials for sync itself and local UI state are excluded.
File attachments and external resources retain the existing backup boundary: this feature does not
promise transfer of arbitrary files referenced by an absolute path.

## Deletion and initialization

A deletion produces a tombstone with the same identity and comparison stamp as an update. Keep its
metadata after removing the payload. The newer update or deletion wins. An older offline copy cannot
resurrect a deleted unit; a genuinely newer edit may supersede the tombstone under the chosen LWW
policy. Session deletion is one unit, so child rows cannot resurrect it independently.

Retain tombstones without time-based collection in this implementation. Payloads can be reclaimed;
removing deletion metadata requires a separate peer-expiry/rebootstrap protocol. Never infer a
deletion from an absent record in a filtered batch.

On first enrollment, index existing portable data once. Preserve valid stored modification times;
use a deterministic baseline timestamp of zero where no trustworthy timestamp exists, rather than
stamping the entire database with the enrollment time. Explain that conflicting legacy records
without timestamps use the device-ID tie-breaker. Local changes after enrollment receive real stamps.
Both sides exchange existing units and merge; the host is not authoritative. New replica identities,
including profiles restored from a backup, must not clone another device's identity or acknowledgements.

## Durable changes and scheduling

Maintain a compact index of each unit's latest stamp, deletion state and monotonically increasing
local revision. Revisions are local delivery cursors, not cross-device conflict timestamps. Index the
revision column so incremental preparation does not scan all messages. Keep the latest winning state
per unit; an unbounded log containing every streamed token is unnecessary.

For SQLite data, persist unit metadata/revision in the same transaction as the canonical mutation.
A rolled-back write must not generate a change. Cover UI, CLI, agent completion and background writer
paths through the persistence owner, not renderer events. File-backed prompts/settings need a durable
write-intent before replacement, an atomic file write and metadata finalization; startup reconciles
only unfinished intents. A post-save in-memory event alone cannot provide crash recovery.

After commit, notify the scheduler. The notification performs no export, hash or network work. Streamed
message persistence may coalesce the same unit's pending revision, but an active session is not
exported as a completed conversation. UI repaint, reads, sync progress, last-sync time, downloaded
cache updates and derived-index maintenance do not trigger a local edit.

Use a one-shot timer driven by pending work:

```text
quietDeadline = lastRelevantWriteAt + 15 seconds
forcedDeadline = firstPendingWriteAt + 120 seconds
rateDeadline = lastAutomaticStartAt + 60 seconds
nextAttemptAt = max(min(quietDeadline, forcedDeadline), rateDeadline)
```

The 120-second maximum wait prevents continuous edits from starving eligible pending work. It never
bypasses runtime admission, the 60-second minimum or an in-flight operation. Ineligible active session
bundles wait for the corresponding idle event; unrelated eligible data may proceed. There is at most
one local sync cycle at a time, and timer state uses monotonic elapsed time while the process runs.
Persist pending revisions and the last start so restart cannot forget work or reset the rate limit.

Capture an upper revision from a consistent read view when a cycle starts. Export and acknowledge
only that view. Writes arriving during export retain higher revisions and remain pending afterward.
Multiple edits to the same unit before preparation collapse into its latest complete state. Incoming
newer units get a local delivery revision for onward propagation but keep their originating stamp;
identical or losing units create no new revision.

No changes means no preparation, no repeated filesystem/database scans and no recurring status
requests. An explicit Sync now flushes the quiet window, but cannot overlap work, bypass runtime
admission or repeatedly bypass the 60-second limit. Initial enrollment can start immediately.
Network reconnection, heartbeat and continuation of an interrupted batch are not new export cycles.

## Exchange and notification protocol

Negotiate automatic sync on an explicit `/sync/v2` protocol surface, with a schema version for unit
payloads. Keep `/sync/v1` unchanged: its strict capability parser must not receive unknown capability
values. A v2 client may offer manual v1 transfer when v2 is absent; it must never label that connection
as automatic bidirectional sync.

The authenticated v2 surface consists of handshake/status, an SSE notification stream, bounded change
batch upload/download and acknowledgements. Status includes replica identity, protocol/schema
compatibility, current revision and clock information. Do not send arbitrary SQL or trust incoming
table names. Only the negotiated domain unit schema is accepted.

- The connecting device maintains one authenticated SSE connection. Events announce available
  revisions, committed batches and state changes, not full data or secrets. Heartbeats keep the
  connection observable; disconnect/reconnect uses bounded backoff and jitter.
- Establish the subscription and read its initial current revision without a gap. Reconnect compares
  durable cursors once, so a missed event does not lose data. SSE retention is not the delivery log.
- Either local pending changes or a remote revision announcement requests one coalesced exchange.
  The client uploads its pending units and downloads the host's pending units. Host-local edits and
  accepted peer edits notify other devices through the same revision mechanism.
- Build immutable batches from consistent data views. Each manifest identifies source replica,
  cursor range, schema and content digest. Split large payloads into parts within the existing
  32 MiB push-part bound; stream compression and transfer with bounded memory. Reuse verified parts
  and immutable identity for resume. A lost part must not cause a fresh full-database export.
- Acknowledgement means durable application or an idempotent LWW no-op, never just receipt. Compare
  the stamp again inside the apply transaction. Persist application and receive-cursor progress
  atomically; a crash before acknowledgement can safely replay the same data.
- A cursor advances only across fully accounted-for units. A busy unit is staged durably and must not
  be skipped by moving the cursor past it. Do not hold its transaction open while waiting for idle.
- Retain immutable batches needed for active resumable transfers; bound abandoned staging by size and
  expiry. Pruning batch files cannot delete the current indexed state or tombstones needed by an
  offline peer. If a delivery cursor cannot be continued, re-enumerate current units and tombstones.

The notification stream replaces automatic prepare-status polling. Legacy manual v1 transfer can
retain its existing bounded status queries. Settings status comes from main-process typed events;
closing the UI does not tear down automatic sync.

## Safe application and performance

Use domain application operations on the live database in short transactions. Do not close/reopen
the database, suspend all sessions, stop schedulers/hooks or run the generic restore importer during
automatic sync. Reserve runtime admission for affected units before comparison and commit; a simple
"check idle, then await" sequence is insufficient because a new run could start in between.

When a session is generating, executing tools or has admitted pending input, stage its incoming
bundle and wait. Retry on runtime-idle/admission events. Never cancel work or clear pending inputs to
apply remote data. After the wait, compare against the latest local stamp: a local edit made while
downloading may now win. Deleting or updating definitions used by an active run follows the same rule.

Apply dependent records atomically, validate references, preserve machine-local fields and rebuild
only affected projections. Imported historical runtime records cannot enqueue tool calls, cron runs
or remote commands. Refresh affected open views after commit; keep drafts and other windows intact.
Batch limits must bound main-thread work, and serialization/compression must not perform whole-database
synchronous reads. Measure large sessions as well as many small sessions before choosing batch sizes.

Normal cycles transfer changed units only. First enrollment may transfer all selected data, and a
changed large session still transfers its full bundle. Debouncing does not make this cost disappear;
sub-session deltas are a measured follow-up if session bundle size is the bottleneck.

## Tunnel, trust and compatibility

Preserve the integrated setup: temporary address, guided custom domain with protected tunnel token,
and external tunnel mode. Bind only the configured `127.0.0.1` port and fail visibly on conflict.
Toolchains provides built-in, managed-download, system and custom sources. Official pinned assets
are verified; Windows ARM64 has no native official artifact for the current pin. Connector startup,
shutdown and identity-checked stale-process cleanup stay owned by the host service.

Automatic sync and peer write permission require explicit enrollment on both sides. Legacy host
consent and read-only device tokens do not silently gain write access. Persist consent version and
capability grants in machine-local state; re-pair or explicitly upgrade permissions before v2 writes.
Opting into automatic sync must explain that paired devices may modify/delete synchronized data and
that the later timestamp wins, including whole-session conflicts.

Protect bearer and tunnel tokens with safeStorage, exclude them from renderer DTOs/logs/arguments,
check HTTPS origins and paired identity, reject redirects and bound all untrusted input. Revocation
closes the device's event stream, cancels queued uncommitted writes and rejects future requests.
It cannot reverse a transaction already committed. Disabling automatic sync prevents new automatic
exchanges and keeps dirty state; disabling sharing also closes the listener and app-owned connector.

Portable provider credentials remain within the consented sync data. Cloudflare terminates HTTPS;
payloads are not additionally end-to-end encrypted. Encrypted database transfer remains unsupported
until a separate explicit contract supports it; the delta path must not silently bypass that policy
by exporting plaintext from an encrypted profile. Local/cloud backup formats and manual overwrite
confirmation remain unchanged. New sync metadata must be excluded or sanitized in backup/restore
paths so importing a backup cannot enable sync, clone identity or advance peer cursors.

## UI behavior

Use compact connection status, one automatic-sync switch and Sync now. Surface waiting, transferring,
waiting-for-local-work, offline, clock error and last successfully applied time. Do not expose dirty
bits, cursors or batch preparation as user actions. Turning automatic sync off does not disconnect a
paired device. Connection loss preserves pairing and pending changes; it is not reported as success.
All user-facing copy uses i18n and existing settings primitives.

```text
BEFORE                                  AFTER
Device sync                             Device sync
  cloudflared status [Manage]              cloudflared status [Manage]
  Share this device [Enable]               Share this device [Enable]
  Connected device [Sync now]              Connected device
                                          Automatic sync          [On]
                                          Up to date · Last synced 14:32
                                          [Sync now] [More]
```

## Acceptance criteria

- A burst of committed writes produces one eligible cycle after 15 quiet seconds; automatic starts
  stay at least 60 seconds apart. Continuous writes do not starve eligible work beyond the maximum
  wait and runtime/rate constraints. Idle data produces no scans or status polling.
- Edits on either side propagate, including through the host to a second peer. Restart/offline writes,
  missed events, interrupted uploads and lost acknowledgements converge without losing pending work.
- Delivery order, duplicate batches and equal timestamps produce the same LWW outcome. Remote
  application preserves stamps and does not produce an endless notification/export loop.
- Deletions propagate and stale offline data cannot resurrect them. Different sessions coexist;
  concurrent changes to the same session select one consistent bundle with explicit user semantics.
- Active generation and tool execution continue untouched during background transfer. Application
  waits for safe admission and rechecks newer local writes without using global database maintenance.
- First enrollment merges both datasets, preserves local-only state and does not execute imported
  work. Unknown schemas, integrity failures, revoked permissions and clock errors cannot acknowledge
  uncommitted data or silently fall back to overwrite.
- Ordinary cycles transfer changed units with bounded memory and measured main-thread time. Large
  sessions, slow links, many changes and multiple peers are included in performance validation.
- Legacy peers retain manual transfer with explicit limitations. No background write permission is
  granted through migration alone. UI remains compact, keyboard accessible and usable at narrow widths.

## Non-goals

Mesh replication, offline relay services, CRDT/field merges, conflict dialogs, sub-session patch
transfers, arbitrary external-file mirroring, end-to-end payload encryption and Cloudflare Access
service-token setup are outside this implementation.

Tunnel guidance follows the [official setup guide](https://developers.cloudflare.com/tunnel/get-started/)
and [run parameters](https://developers.cloudflare.com/tunnel/reference/run-parameters/).
