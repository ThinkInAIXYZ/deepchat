# IM-style Steer Messages Implementation Record

## Status

Implemented on `codex/steer-message-lifecycle`.

The feature keeps Queue as a mutable draft lane and makes Steer a durable transcript message with
one persisted read boundary:

```text
Assistant A streaming
  -> User Steer · Unread
  -> claim · Read
  -> Assistant B streaming in a new message
```

## Delivered Contracts

### Persistence and ordering

- [x] Add `messageIds` and `assistantMessageId` to the existing pending-input record.
- [x] Add optional `inputReceipt` metadata to user messages.
- [x] Migrate `deepchat_pending_inputs` without adding a table or index.
- [x] Persist each accepted Steer user message and its pending batch in one SQLite transaction.
- [x] Preserve separate user messages for rapid Steers while merging their runtime payload.
- [x] Claim the batch, stamp one `readAt`, and reserve a new assistant message atomically.
- [x] Keep pending Steer user messages out of provider history.
- [x] Mark linked user messages sent when the claimed batch settles.
- [x] Keep `Read` irreversible; claimed Steers are consumed on completion, abort, or error.
- [x] Reconcile active records from older databases before generic pending-message recovery.
- [x] Resume an unread Steer when its session pending state is restored after restart.

### Runtime handoff

- [x] Remove generic user-stop cancellation from DeepChat Steer.
- [x] Let the active DeepChat loop reach its existing safe pending-input boundary.
- [x] Reuse linked user messages and the reserved assistant message in the claimed turn.
- [x] Insert compaction before pre-created Steer facts when the context budget requires it.
- [x] Persist ACP Steer before cancellation and distinguish `pending_input` from `user_stop`.
- [x] Settle the old ACP projection without user-cancel error copy.
- [x] Wait for the old ACP operation before claim and reuse the reserved projection.
- [x] Persist the current user fact before accepting a pre-stream Steer.
- [x] End pre-stream work with `pending_input` and remove any empty assistant reservation.
- [x] Route both Queue promotion entry points through the same prepared Steer lifecycle.

### Renderer and interaction

- [x] Return the accepted persisted message from `chat.steerActiveTurn`.
- [x] Publish batched `sessions.messages.changed` records through the typed Electron boundary.
- [x] Upsert persisted records by `orderSeq` and reject older cache records.
- [x] Insert the accepted Steer before clearing the matching composer draft.
- [x] Keep failed or attachment-blocked submissions in the composer.
- [x] Remove the visible Steer spinner and `aria-busy`; retain the non-visual duplicate-submit lock.
- [x] Keep Steer available before the first assistant stream update.
- [x] Replace the optimistic source bubble when its pre-stream persisted record arrives.
- [x] Render only Queue records in `PendingInputLane`.
- [x] Preserve Queue editing, ordering, deletion, attachment resolution, promotion, and capacity.
- [x] Render `Unread` and `Read` in the existing fixed-height message-info line.
- [x] Derive receipt expiry from persisted `readAt`; fade only the removal for 150 ms.
- [x] Disable receipt fade for reduced motion.
- [x] Keep active Steer messages read-only while preserving Copy.
- [x] Reject low-level pending-input deletion for accepted Steer messages.
- [x] Add receipt copy to all 20 locales.

## Retained Regression Coverage

The retained tests cover durable product and architecture contracts rather than temporary
implementation probes:

- rapid Steers remain separate messages, share one claimed batch, and use a new assistant row;
- Queue promotion follows the same Steer admission path without cancelling the active stream;
- pre-stream Steer preserves source/Steer order and leaves no empty assistant message;
- DeepChat handoff emits no user-stop hook;
- ACP cancellation, promotion, and reserved-projection reuse;
- pending-input schema, ordering, claim, settlement, and restart behavior;
- route result and typed message-event cache updates;
- stale session/event handling and authoritative `orderSeq`;
- Queue-only pending lane and toolbar state;
- `Unread -> Read -> hidden` receipt timing and pending-message action restrictions.

No standalone test helper, temporary probe, or new test-only production API is retained.

## Automated Verification

| Command / suite | Result |
| --- | --- |
| `pnpm run format` | passed |
| `pnpm run i18n` | passed; 20 locales, no missing or invalid keys |
| `pnpm run lint` | passed |
| `pnpm run typecheck` | passed for main and renderer |
| affected DeepChat, ACP, session-data, and renderer suites | 469 passed, 9 native-SQLite tests skipped |

The skipped native-SQLite cases require the Electron ABI build of
`better-sqlite3-multiple-ciphers`; the Node test process uses a different ABI. Their migration SQL
contract and the mocked runtime integration path are covered in this environment.

## Release UI QA

The following checks require the packaged desktop runtime and remain release-level manual QA:

- [ ] DeepChat and ACP with real providers.
- [ ] Light and dark themes at narrow and resized window widths.
- [ ] Keyboard focus, screen-reader announcement, and reduced-motion OS setting.
- [ ] Real text, image/file, mention, and active-Skill Steers.
- [ ] Scroll follow behavior under long virtualized histories.
