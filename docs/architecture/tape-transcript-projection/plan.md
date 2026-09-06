# Tape Transcript Projection Implementation Plan

Spec: [spec.md](./spec.md). One branch, one PR; each slice below is one reviewable commit that
leaves `pnpm typecheck` and the session/tape suites green on its own.

## Slice 1: Make idempotent message appends observable

- [x] In `factPersistence.ts` `appendMessageRecordToTape`, compare the returned row's
      `payload.record` with the record when the provenance key was derived; warn once with session
      id, message id, source and differing field names (`content`, `status`, `orderSeq`,
      `metadata`). Skip the comparison when the stored `payload_json` equals the serialized payload.
- [x] Guard test: identical re-append logs nothing; a re-append with different content logs one
      warning naming `content`.

Completion: the warning exists and fires only on divergence. No behavior change for callers.

## Slice 2a: Canonical record on shared table mappings

- [x] Move the persist and read field mappings for user files and assistant blocks into
      `src/main/session/data/messageContent.ts`; `deepchat_assistant_blocks.replaceForMessage`,
      `persistUserContent` and `materializeContent` use them.
- [x] Add `canonicalizeMessageContent(role, rawContent, updatedAt)` on top of those mappings.
- [x] Round-trip guard test against real SQLite: the canonical string equals what the tables return
      after persisting the raw content, for user content with files, links, active skills and inline
      items, and for assistant blocks covering reasoning, tool call, image, action and error shapes
      including a block without a timestamp. The test runs in the native Tape storage CI step.

Completion: one mapping per direction; the canonical form is pinned to the tables' behavior.

## Slice 2b + 3: Fact-first terminal writes through one applier

Landed as one commit: routing the terminal writes through the applier while keeping the old order
would have meant a temporary read-back path and a second rewrite of every table double.

- [x] `TranscriptProjectionApplier` (`transcriptProjection.ts`) with `applyRecord` and
      `applyRetractions`; the table-writing bodies, search document and usage-stats writes live
      there. `deepchat_messages` gains `upsert` and `deleteByIds`.
- [x] Every method in the spec's write-direction table builds the canonical record in memory,
      appends its fact, then applies it. `appendLiveTapeFacts` and the read-back are gone.
- [x] Fork appends a live `message/<role>` fact per copied row in one transaction;
      `recoverPendingMessages` appends a revision fact per recovered row, one transaction each;
      legacy import calls `importMessageRow`, which replaces the importer's direct insert.
- [x] `restoreUserMessage` replaces the retry path's `updateMessageStatus('sent')`;
      `updateMessageStatus` accepts only `'pending'`.
- [x] Compaction shift keeps its single `incrementOrderSeqFrom` UPDATE, now stamped with the same
      `updatedAt` the order replacement facts carry; range deletes keep their table-level statement.
- [x] Tests: the transcript double returns appended rows; assertions follow `upsert`; fork,
      retry-restore and import pin fact and row from the same record.

Completion: no transcript terminal write happens without its fact in the same transaction.

## Slice 4: Projection cursor, replay and head-comparison readiness

- [x] `deepchat_transcript_projection_meta` table (`tables/deepchatTranscriptProjectionMeta.ts`),
      registered in the schema catalog and `SessionDatabase`; `deleteBySession` drops the row inside
      the `clearMessages` transaction.
- [x] Every fact-first write moves an established cursor to the Tape head (`getProjectionHead`);
      a Session without a cursor for the current incarnation waits for reconciliation to backfill.
- [x] `TranscriptProjectionApplier.applyTapeEntries` replays message facts and retractions in entry
      order; compaction indicators are skipped. `getEffectiveMessageInputRowsAfter` reads the range.
- [x] `TapeReconcilerService.ensureSessionTapeReady` compares cursor and head in one store
      transaction: absent or foreign-incarnation cursor backfills the transcript once, a cursor
      behind the head replays the increment. The `reconciled` map and `digestTranscript` are gone.
- [x] Tests: cursor suite in `tapeReconciler.test.ts`; real-SQLite `transcriptProjection.test.ts`
      (cursor established by readiness and moved by writes, direct Tape facts materialized,
      pre-projection rows backfilled without deletion, reset rebuilds the cursor) in the native CI
      step; harness doubles gain the meta table and drop the cursor where they install history
      behind the projection's back.

Completion: `ensureSessionTapeReady` is O(delta) and the transcript digest is gone.

## Slice 5: Documentation and test alignment

- [x] `docs/architecture/tape-system.md`: the transcript is described as the derived projection and
      UI read model of Context Tape message facts; the transaction-boundary and "Message projection
      与 Context facts" sections state the fact-first order, the cursor rule and the one-time
      backfill; the test map names the new suites.
- [x] `tapeReconciler.test.ts` cases that asserted transcript-bypass backfill became projection
      cursor cases; tool-revision and legacy-summary cases stay.
- [x] `tapeTestHarness.ts` gained `createTranscriptProjectionMock` and the range read;
      `tapeTableMockContract.test.ts` pins the range read against the real store.

Completion: docs match code; no test asserts the removed backfill direction.

## Whole-change review and gates

- [x] Review against the spec for hidden side effects, compatibility, failure behavior,
      performance, security, naming and maintenance cost before each commit.
- [x] `pnpm run format`, `pnpm run lint`, `pnpm run typecheck` (no user copy changed, so `i18n`
      was not needed).
- [x] `test/main/session`, `test/main/tape`, `test/main/agent`, `test/main/app`, `test/main/data`,
      `test/main/memory` under the Electron ABI: 4268 passed; the 17 failures are pre-existing
      local environment failures (`acpTerminalAuthRunner` PTY timeout,
      `sessionDataMigrations.sqlite`, `mainDatabase`, `deepchatPendingInputsTable`) verified on
      the base commit.
- [ ] Manual: new chat, resume, edit, delete, steer, manual compaction, fork, legacy import; compare
      Inspector rows with the UI.
