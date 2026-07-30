# IM-style Steer Messages Tasks

## Status

Ready for implementation. Check an item only after its code, focused test, and relevant
documentation are complete.

## 0. Contract Review

- [ ] Confirm Queue remains a mutable bottom-lane draft until normal admission.
- [ ] Confirm one user submission always creates one visible Steer message.
- [ ] Confirm Steers accepted before one claim share the existing merged runtime payload and one
      assistant response.
- [ ] Confirm `Read` is stamped at durable claim and is irreversible.
- [ ] Confirm accepted active Steers have no recall/edit behavior.
- [ ] Confirm pre-stream input offers Queue until an authoritative assistant row exists.
- [ ] Confirm both DeepChat and ACP must use a new assistant message ID after Steer.

## 1. Shared Types and Persistence Schema

- [ ] Add `messageIds` and `assistantMessageId` to `PendingSessionInputRecord`.
- [ ] Add optional `inputReceipt` to `MessageMetadata`.
- [ ] Add `message_ids_json` to `DeepChatPendingInputRow`.
- [ ] Add `assistant_message_id` to `DeepChatPendingInputRow`.
- [ ] Add the pending-input table migration.
- [ ] Register both migrated columns in `schemaCatalog.ts`.
- [ ] Decode malformed or absent `message_ids_json` as an empty list.
- [ ] Add table and schema-catalog migration tests.

## 2. Atomic Steer Acceptance

- [ ] Let `SessionTranscript` create a user message with explicit status and receipt metadata.
- [ ] Keep user-content, file, link, search, and Tape projections inside the caller's transaction.
- [ ] Add one `SessionPendingInputs.acceptSteerMessage` operation.
- [ ] Create a new pending Steer row and first user message atomically.
- [ ] Merge another submission into an open pending Steer payload.
- [ ] Append one distinct message ID for every merged submission.
- [ ] Reject cross-session, non-Steer, blocked, claimed, or consumed merge targets.
- [ ] Publish pending-input and message events only after commit.
- [ ] Return the persisted `ChatMessageRecord` from acceptance.
- [ ] Add rollback tests proving no partial message or pending row survives.

## 3. Atomic Read Boundary

- [ ] Add one `SessionPendingInputs.claimSteerBatch` operation.
- [ ] Stamp one `claimedAt` and one `readAt` across the claimed batch.
- [ ] Create one assistant message after the last linked Steer message.
- [ ] Persist `assistantMessageId` in the same transaction.
- [ ] Prevent a claimed batch from accepting another message.
- [ ] Ensure a later Steer starts a new batch after the reserved assistant row.
- [ ] Publish the changed user messages and assistant row as one event batch.
- [ ] Add ordering and concurrent accept/claim tests.

## 4. Steer Settlement and Recovery

- [ ] Mark all linked user messages `sent` when a claimed Steer settles.
- [ ] Preserve receipt `readAt` during settlement.
- [ ] Append Tape replacement facts for the status changes.
- [ ] Consume claimed Steers on completed, aborted, and error outcomes.
- [ ] Remove `release-after-rollback` from the post-read Steer path only.
- [ ] Persist a terminal assistant error when a claimed turn fails before stream.
- [ ] Reconcile legacy pending Steers into one `Unread` user message.
- [ ] Recover legacy claimed Steers to pending before projection repair.
- [ ] Convert legacy blocked Steers back to blocked Queue.
- [ ] Keep legacy reconciliation idempotent.
- [ ] Add restart tests for pre-claim and post-claim states.

## 5. Route and Event Contracts

- [ ] Extend `chat.steerActiveTurn` output with `message`.
- [ ] Reuse `ChatMessageRecordSchema`.
- [ ] Carry the accepted message through backend handle, `SessionTurn`, `ChatService`, and route.
- [ ] Return `message: null` for attachment preparation requiring user action.
- [ ] Add `sessions.messages.changed`.
- [ ] Add `SessionClient.onMessagesChanged`.
- [ ] Publish full changed records for acceptance, claim, and settlement.
- [ ] Add contract, route, dispatcher, and renderer-client tests.

## 6. DeepChat Admission and Safe Yield

- [ ] Replace direct Steer queue writes with atomic Steer acceptance.
- [ ] Keep `activeSteerPendingInputId` as only the open batch identity.
- [ ] Remove generic active-run cancellation from DeepChat Steer.
- [ ] Keep the existing `shouldYieldForPendingInput` tool-batch boundary.
- [ ] Schedule drain after provider-only completion when Steer is waiting.
- [ ] Keep permission/question interactions as claim blockers.
- [ ] Validate that an authoritative assistant row exists before active Steer acceptance.
- [ ] Return a race-safe error without creating a message when the invariant fails.
- [ ] Add admission and safe-yield tests.

## 7. DeepChat Claimed Turn

- [ ] Make the pending-input pump call `claimSteerBatch`.
- [ ] Pass linked user message IDs and reserved assistant ID into the turn.
- [ ] Reuse all pre-created Steer user facts.
- [ ] Use the merged pending payload exactly once as `newUserContent`.
- [ ] Use the last linked user message as the turn anchor.
- [ ] Keep pending Steer user facts out of historical context.
- [ ] Reuse the reserved assistant message instead of creating another.
- [ ] Insert compaction before the first linked Steer message when required.
- [ ] Finalize the old assistant with `stopReason: 'pending_input'`.
- [ ] Prove no new stream update targets the old assistant ID.
- [ ] Add context, compaction, message-ID, Stop, and previous-error regression tests.

## 8. ACP Handoff

- [ ] Persist the Steer before requesting ACP cancellation.
- [ ] Add `user_stop | pending_input` cancellation cause.
- [ ] Settle the old ACP projection without user-cancel error copy for `pending_input`.
- [ ] Wait for the old ACP operation before claim.
- [ ] Keep the Steer `Unread` when old-operation settlement fails.
- [ ] Pass claimed linked messages and assistant ID into `AcpAgentInstance.send`.
- [ ] Reuse those facts in `AcpCompatibilityProjectionAdapter.begin`.
- [ ] Send the merged payload once.
- [ ] Stream only into the reserved assistant row.
- [ ] Add ACP ordering, cancellation-copy, failure, and duplicate-row tests.

## 9. Renderer Message State

- [ ] Expose a batched persisted-record upsert action from the message store.
- [ ] Ignore event records older than the cached `updatedAt`.
- [ ] Keep message IDs ordered by authoritative `orderSeq`.
- [ ] Increment persisted revision once per event batch.
- [ ] Subscribe to `sessions.messages.changed` with scope cleanup.
- [ ] Invalidate recent views for inactive sessions.
- [ ] Upsert the accepted route message before clearing the composer draft.
- [ ] Ignore stale-session route results without losing the durable message.
- [ ] Add active, inactive, stale-event, and session-switch store tests.

## 10. Composer and Toolbar

- [ ] Keep a non-visual per-session Steer dispatch lock.
- [ ] Remove the visible Steer spinner and `aria-busy`.
- [ ] Keep real attachment-preparation feedback.
- [ ] Clear the draft only after durable acceptance.
- [ ] Keep the complete draft after failure or user-action attachment result.
- [ ] Request one guarded scroll-to-bottom after acceptance.
- [ ] Derive `canSteerActiveMessage` from the committed authoritative assistant row.
- [ ] Keep Queue enabled during the pre-stream Steer gate.
- [ ] Add pre-stream-specific tooltip copy through vue-i18n.
- [ ] Add composer and toolbar regression tests.

## 11. Message Receipt UI

- [ ] Add the receipt field to `DisplayUserMessage`.
- [ ] Parse `MessageMetadata.inputReceipt` in `useDisplayMessages`.
- [ ] Render `Unread` in the existing `MessageInfo` line.
- [ ] Render `Read` until `readAt + 1500 ms`.
- [ ] Apply a 150 ms opacity-only fade.
- [ ] Disable the fade under reduced motion.
- [ ] Clear the receipt timeout on metadata change and unmount.
- [ ] Keep the `MessageInfo` line height stable.
- [ ] Announce only the transition to `Read` with `aria-live="polite"`.
- [ ] Treat pending Steer messages as read-only in `MessageToolbar`.
- [ ] Keep Copy available.
- [ ] Add English and Chinese receipt copy.
- [ ] Add receipt timing, restore, action, accessibility, and row-height tests.

## 12. Queue-only Pending Lane

- [ ] Remove the Steer count from `PendingInputLane`.
- [ ] Remove locked/blocked Steer rows and controls.
- [ ] Make lane visibility depend only on Queue items.
- [ ] Remove Steer props/emits that have no remaining consumer.
- [ ] Preserve Queue count, drag, edit, delete, attachment resolution, and promote-to-Steer.
- [ ] Verify promoted Queue appears as an `Unread` message only after preparation succeeds.
- [ ] Remove the renderer `steerItems` getter only if no non-visual consumer remains.
- [ ] Add Queue lane and promotion tests.

## 13. Integrated Regression Coverage

- [ ] Add deterministic DeepChat E2E coverage for `Assistant A, S1, S2, Assistant B`.
- [ ] Assert S1 and S2 are separate bubbles in one claimed batch.
- [ ] Assert both change `Unread -> Read`, then render no receipt.
- [ ] Assert Assistant A and Assistant B have different IDs.
- [ ] Assert a late Assistant A stream update is ignored.
- [ ] Assert a Steer after claim appears below Assistant B.
- [ ] Assert receipt updates do not change measured row height or force scroll.
- [ ] Add the equivalent ACP ordering smoke test.
- [ ] Verify session reload and process restart.
- [ ] Verify text, files, mentions, and active Skills.
- [ ] Verify Stop, previous-turn error, and interaction blockers.
- [ ] Verify light, dark, reduced-motion, keyboard, and screen-reader behavior.

## 14. Final Quality Gates

- [ ] Remove dead Steer loading and rail code.
- [ ] Update the current session-management architecture reference after implementation lands.
- [ ] Run `pnpm run format`.
- [ ] Run `pnpm run i18n`.
- [ ] Run `pnpm run lint`.
- [ ] Run `pnpm run typecheck`.
- [ ] Run focused main session and agent tests.
- [ ] Run focused renderer store, composer, ChatPage, and message-component tests.
- [ ] Run the deterministic DeepChat and ACP E2E scenarios.
- [ ] Record the exact commands and results in this file when implementation is complete.
