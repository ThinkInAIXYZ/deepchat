# Tape Transcript Projection Specification

## Background

The message transcript (`deepchat_messages` and its five structured side tables) is the UI read
model for a Session. The Context Tape holds the `message/*` facts that context assembly, recall,
replay, Memory ingestion and the Inspector read. Today the transcript produces those facts: every
terminal write in `SessionTranscript` updates the tables first, reads the row back, and appends a
copy of the materialized record as a Tape fact (`transcript.ts` `appendLiveTapeFacts`).

Since a7967db34 the main terminal paths perform both writes in one SQLite transaction, so a
crashed process cannot leave a transcript row without its fact. The remaining consistency gap is
structural rather than transactional:

- Four transcript writes bypass Tape and rely on the reconciler to backfill later: fork
  (`cloneSentMessagesToSession`), startup recovery (`recoverPendingMessages`), legacy chat import
  (`backfillMessageRow`), and the retry path that restores a failed user prompt to `sent`
  (`transcriptMutations.ts` `prepareRetryMessage`). Nothing stops the next such path from being
  added.
- A `sent` record's live fact uses a provenance key derived from the message id only. The store
  returns the existing entry on a key hit without comparing payloads, so a transcript row whose
  content changed without a replacement fact leaves Tape silently stale. No path does this today;
  the guarantee rests on convention.
- `ensureSessionTapeReady` reads the whole transcript on every call to compute a digest and reads
  every Tape message row to return `historyRecords`. Any transcript change, which every user turn
  causes, re-runs an idempotent backfill over all N records. Phase 0 page-cache tuning made this
  cheap per row, but it stays linear in Session length on the main thread.

The Tape model DeepChat follows (tape.systems; `docs/architecture/tape-system.md`) states that
derivatives never replace original facts. With the transcript as the producer, the Tape copy is the
derivative while also serving as the fact source for provider context. This specification reverses
the direction for terminal message state: the fact is appended first and the transcript tables are
derived from it in the same transaction.

## Goals

1. Make the appended `message/*` fact the only producer of terminal transcript state. Every
   terminal transcript write goes through one materialization component whose input is the record
   carried by the fact.
2. Remove the transcript-to-Tape backfill from the per-call reconciler path. Readiness becomes a
   head comparison between the Tape and a transcript projection cursor, with replay of missing
   facts when the projection is behind.
3. Close the four bypass paths by routing them through the same fact-first component.
4. Make a silent fact/transcript divergence observable: an idempotent message append whose stored
   payload differs from the record being appended logs a bounded warning.
5. Keep the persisted Tape format, fact names, provenance keys, hashes, effective-view semantics,
   ViewManifest and replay contracts unchanged. Existing Tapes read identically before and after.

## Non-Goals

- Storing only a content hash in message facts (option "a" from the analysis). Tape keeps the full
  record so recall, replay, Memory and provider context stay self-sufficient.
- Recording streaming intermediate state (`createAssistantMessage` shells, per-chunk
  `updateAssistantContent`, `updateAssistantMetadata`, `updateMessageStatus('pending')`) in Tape.
- Changing `execution/*`, `contract/*`, `context` kind, ViewManifest, Journal, search projection or
  Memory ingestion projection behavior.
- Replacing the N per-message `revisionKind: 'order'` replacement facts written by compaction shift
  with a new fact type.
- Deriving `deepchat_message_traces` or `deepchat_message_search_results` from Tape. They remain
  runtime sidecars keyed by message id; their delete cascade is unchanged.
- Any archive-on-reset behavior. `resetSessionTape` stays a lifecycle exception.

## Design

### Data families after the change

| Family | Role | Producer |
| --- | --- | --- |
| Tape `message/*` facts, `message/retracted` and `message/compaction_indicator` events | Terminal message facts | `TapeMessageFactWriter` called by transcript terminal writes |
| Transcript terminal rows (`deepchat_messages` with status `sent`/`error`, `deepchat_user_messages`, `_files`, `_links`, `deepchat_assistant_blocks`, `deepchat_search_documents`) | UI read model, derived | `TranscriptProjectionApplier` |
| `deepchat_usage_stats` message rows | Provider call accounting | Assistant terminal writes and the pending-region metadata update, as today |
| Transcript pending region (`deepchat_messages` status `pending` and its block rows) | Live streaming buffer | `SessionTranscript` directly, as today |
| Sidecars (`deepchat_message_traces`, `deepchat_message_search_results`) | Runtime evidence | Runtime, as today |

### Canonical record

The fact payload carries `ChatMessageRecord` with `content` in the materialized form the transcript
returns from `getMessage`: user content is the JSON of `{ text, files, links, search, think,
activeSkills?, inlineItems? }` with each file normalized through the same field mapping the tables
use; assistant content is the JSON block array normalized the same way `toAssistantBlock` reads a
block row. Today that form is obtained by writing the tables and reading back. A pure
`canonicalizeMessageContent(role, rawContent, updatedAt)` produces the same string without table
access by applying the persist mapping and the read mapping in memory. Blocks without a
`timestamp` receive `updatedAt`; today they report the block row's own write time, which is the
same instant within the same transaction.

Invariant: for every record `r` produced by the canonicalizer,
`materialize(persist(r)) === r.content`. A guard test pins this for user content with files, links,
active skills and inline items, and for assistant content covering every block type the renderer
persists. Any new persisted field must be added to both mappings or the guard fails. Fields the
tables do not persist today (`artifact`, the `maximum_tool_calls_reached` action type) are dropped
by the canonical form exactly as the read path drops them; the fact carries what the UI can show.

### TranscriptProjectionApplier

Owned by `src/main/session/data/`. It is the only code that writes terminal state into the
transcript tables.

- `applyRecord(record)`: UPSERT `deepchat_messages` (id, session, order, role, content, status,
  is_context_edge, metadata, created_at, updated_at), replace the role tables from `content`, and
  upsert the search document (user rows always, assistant rows once terminal). Compaction marker
  rows (`metadata.messageType === 'compaction'`) are applied with the same UPSERT. Usage stats are
  not part of the projection: they count provider calls, and the same record reaches the applier
  again on fork, import, recovery and replay without a call having happened. The assistant
  terminal writes (`finalizeAssistantMessage`, `setMessageError` with metadata) record usage
  themselves, as the pending-region metadata update already does.
- `applyRetractions(messageIds)`: delete the eight message-scoped rows exactly as
  `deleteMessageWithReason` does today, including the two sidecars, in chunks of 500 ids so a range
  delete over a whole Session stays below SQLite's bound-variable floor on every table.
- `applyTapeEntries(rows)`: the reconciler reads the effective message input rows with `entry_id`
  past the cursor and hands them over in entry order; message facts go through
  `applyRecord(payload.record)` and `message/retracted` events through `applyRetractions`. It never
  deletes a transcript row that Tape has not retracted and never touches a `pending` row that has
  no fact. `message/compaction_indicator` events are skipped; compaction marker recovery stays with
  `reconcileCompactionMessages`, which already decides marker state from the reconstruction anchor.

### Write direction for terminal state

Every terminal transcript method builds the canonical record in memory, appends its fact through
`TapeMessageFactWriter`, then calls `applyRecord`, all inside the existing
`runInDatabaseTransaction`. The table write no longer precedes the fact; the read-back before the
fact append disappears.

| Transcript method | Fact | Applier call |
| --- | --- | --- |
| `createUserMessage` | `appendMessageRecord` | `applyRecord` |
| `finalizeAssistantMessage`, `setMessageError` | `appendMessageRecord` (pending shell becomes terminal) | `applyRecord` |
| `insertCompactionMessageRecord`, `updateCompactionMessage` | `appendMessageRecord` (compaction indicator event) | `applyRecord` |
| compaction shift (`shiftMessagesFrom`) | per-message `appendMessageReplacement('order')` | none: one `incrementOrderSeqFrom` UPDATE stamped with the facts' `updatedAt`; content is unchanged so re-materializing N rows would only add writes |
| `markSteerMessagesRead`, `settleSteerMessages`, `failPendingSteerMessages` | `appendMessageReplacement('record')` | `applyRecord` |
| `updateMessageContent` | `appendMessageReplacement('record')` | `applyRecord` |
| `deleteMessageWithReason`, `deleteFromOrderSeq` | `appendMessageRetraction` | `applyRetractions` |
| `restoreUserMessage` (retry of a failed prompt, called from `prepareRetryMessage`) | `appendMessageReplacement('record', reason 'retry_restored_prompt')` | `applyRecord` |
| `cloneSentMessagesToSession` (fork) | `appendMessageRecord` per copied row, in the fork Session's Tape | `applyRecord` |
| `recoverPendingMessages` | `appendMessageRecord` (revision key, status `error`) | `applyRecord` |
| legacy import `importMessageRow` | `appendMessageRecord` | `applyRecord` (replaces the importer's direct insert) |

Fork does not introduce a `fork/*` fact name or a new fact source; `tape-system.md` records that
Tape has no fork writer. The copied rows are ordinary live `message/<role>` facts of the fork
Session, created at fork time. Their origin is the fork Session's own metadata, not the fact.

`updateMessageStatus` narrows to the pending region (`'pending'` only). The steer methods keep
relying on the caller's `runInTransaction`, as today; `recoverPendingMessages` and fork run inside
one transaction of their own.

### Projection cursor and readiness

A new table `deepchat_transcript_projection_meta(session_id PRIMARY KEY, tape_incarnation_id,
max_entry_id, projection_version, updated_at)` follows the `deepchat_memory_ingestion_projection_meta`
pattern. Every fact-first write moves an established row to the Tape head after its append, in the
same transaction. A write does not create the row: a Session without a cursor for the current
incarnation may still hold transcript rows the Tape never saw (rows written before the projection
existed, or before a Tape reset), and only readiness step 2 below may declare the two aligned.
`clearMessages` deletes the row inside its existing transaction, next to the transcript delete and
the Tape reset; the legacy import overwrite clears it with the other legacy-owned tables.

`ensureSessionTapeReady(sessionId)` becomes:

1. Read `(tape incarnation, tape max entry id)` and the meta row in one query.
2. If the meta row is absent: run the existing legacy backfill (transcript to Tape, idempotent,
   `source: 'backfill'`), then project the other way any effective Tape message whose id the
   transcript does not hold, append the `migration/backfill` event as today, and write the meta row.
   The backfill is the upgrade path for Sessions whose Tape fell behind before this change (a fork,
   import or recovery that was never followed by a turn) and keeps the applier from replaying an
   empty Tape over a populated transcript; the reverse projection keeps the cursor honest for a fact
   that entered the Tape without going through the transcript, which no path produces today.
   This step only adds. A transcript row whose Tape fact was retracted is kept and the retraction is
   not applied: with no cursor, the transcript is the record the user has been looking at, and a
   Session without a cursor is exactly the one whose Tape may be stale. Deleting a row here would
   trust the stale side. No path produces that state either (delete removes the row and appends the
   retraction in one transaction); once a cursor exists, the incremental replay in step 4 applies
   retractions as they arrive.
3. If the meta row exists but its incarnation differs from the Tape's: the Tape was reset under the
   transcript. Treat the row as absent and run step 2, which overwrites it.
4. If `max_entry_id` is behind the Tape head: `replay(sessionId, max_entry_id)`, then advance the
   row to the head. Non-message appends (manifests, journal, anchors) advance the cursor with an
   empty replay.
5. Return `historyRecords` from the effective Tape view as today.

Steps 1–4 run in one store transaction. The in-process `reconciled` map and the transcript digest
are removed. The result type `TapeBackfillResult` keeps its shape; `messageCount` and `maxOrderSeq`
derive from the Tape records and `appendedFactCount` counts facts appended by step 2.

The Tape side of this contract is `TapeTranscriptProjection` in `ports/capabilities.ts`
(`getMessages`, `readProjectionCursor`, `writeProjectionCursor`, `applyTapeEntries`), implemented by
`SessionTranscript`; the reconciler never imports session code. The transcript reads the head it
records through `TapeProjectionHeadReader.getProjectionHead`.

### Idempotent payload guard

`appendMessageRecordToTape` compares the row the store returned with the record it tried to
append whenever the provenance key was derived and the append is live (a `sent` record written by
the transcript, including fork, import and recovery). If `content`, `status`, `orderSeq`,
`metadata` or `isContextEdge` differ, it logs one warning with the session id, message id and the
names of the differing fields. `sessionId` and `id` are not compared: the derived key is scoped to
both, so a hit already proves they match. Payload text is never logged. Backfill appends do not report: a backfill of an
old Session compares today's materialized content with a fact written by an earlier version, and
that is format history, not a bypassed write. The append result is unchanged; the guard only makes
a divergence visible.

### Ownership and layering

| Component | Location |
| --- | --- |
| `canonicalizeMessageContent` and the persist/read field mappings | `src/main/session/data/messageContent.ts` (pure) |
| `TranscriptProjectionApplier` | `src/main/session/data/transcriptProjection.ts` |
| `deepchat_transcript_projection_meta` table | `src/main/session/data/tables/deepchatTranscriptProjectionMeta.ts` |
| Reconciler head comparison and migration backfill | `src/main/tape/application/reconcilerService.ts` |
| Payload guard | `src/main/tape/application/factPersistence.ts` |

The applier reads Tape rows through the existing `TapeTranscriptReader`-style port direction: Tape
exposes effective message input rows; session data derives tables from them. Tape code does not
import the applier.

## Compatibility

- No Tape schema, fact name, provenance key, hash version or payload field changes. Records written
  fact-first serialize to the same `payload.record` shape as records read back from the tables did.
  `traceCount` is pinned to `0`; the previous read-back carried a snapshot that could be above zero
  when request tracing was enabled. No reader takes `traceCount` from a Tape record.
- Rollback is a code revert. The meta table is ignored by earlier code; the earlier reconciler's
  backfill finds every fact already present through provenance keys and appends nothing.
- `SessionTranscript`'s public method signatures are unchanged. `TapeBackfillResult` is unchanged.
- The order in which `deepchat_search_documents` and `deepchat_usage_stats` rows are written inside
  a terminal transaction changes; both are read only after commit.
- `deepchat_messages.created_at` for fact-first rows comes from the record instead of the insert
  default. Both were `Date.now()` at the same point.

## Invariants Preserved

1. Tape entries are append-only. Replay writes tables from facts; nothing writes Tape from tables
   except the one-time migration backfill in readiness step 2.
2. Corrections stay appended: edit, delete, steer state and compaction shift remain replacement or
   retraction facts.
3. `context` kind rows never reach the transcript, search or Memory. The applier reads only
   `message` rows and `message/retracted` events.
4. `execution/*` and `contract/*` are untouched; the transcript projection does not join their
   transactions.
5. Replay output (entry order, role, tool pairing, anchor cursor, policy and builder versions,
   synthetic provenance) is unchanged because no fact changes.
6. A Context Tape write failure inside a terminal transaction rolls back the transcript write with
   it, as it does today; a completed reply is never left hanging.

## Acceptance Criteria

- After any terminal transcript write, `getMessage(id)` deep-equals the `payload.record` of the
  latest effective message fact for that id, except `traceCount`.
- Fork, startup recovery, legacy import and retry-restore leave no transcript row without a
  corresponding effective fact, without a later reconciler pass.
- `ensureSessionTapeReady` on an unchanged Session performs no transcript read and appends nothing.
- A Session whose meta row is absent and whose transcript has rows gets a full backfill exactly once,
  and no transcript row is deleted by that call.
- Deleting the meta row and appending a message fact directly to Tape, then calling
  `ensureSessionTapeReady`, materializes the message into the transcript tables.
- A `sent` live append whose derived key already exists with a different `content` logs one warning
  naming the field; identical payloads log nothing.
- `test/main/session/data`, `test/main/tape`, `test/main/agent/deepchat` and the real-SQLite
  contract suites pass. Manual: new chat, resume, edit, delete, steer, manual compaction, fork and
  legacy import show the same rows in the Inspector and the UI.

## Open Questions

None. Decisions that were open in the preceding analysis (`provider/attempt_completed` exclusion,
compaction shift fact shape, sidecar ownership) are settled above or in `tape-system.md`.
