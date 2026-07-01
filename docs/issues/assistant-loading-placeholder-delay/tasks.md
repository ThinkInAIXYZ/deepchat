# Assistant Loading Placeholder Delay Tasks

## 0. Review Gate

- [x] Locate send path, stream path, and message rendering ownership.
- [x] Confirm root cause is renderer waiting for backend stream state.
- [x] Confirm no backend contract change is needed for the first increment.

## 1. Renderer Implementation

- [x] Add local pending assistant placeholder state in `ChatPage.vue`.
- [x] Reuse existing empty pending assistant rendering for the loading row.
- [x] Clear composer and scroll immediately after local optimistic state is set.
- [x] Hide/clear placeholder when real streaming starts.
- [x] Clear placeholder on send failure before streaming.
- [x] Clear placeholder on session id change.
- [x] Keep queued-input submit path unchanged.

## 2. Tests

- [x] Add renderer test: submit shows assistant loading row before stream update.
- [x] Add renderer test: stream update removes/hides placeholder and uses real stream row.
- [x] Add renderer test: active-generation queued submit does not create placeholder.
- [x] Add renderer test: send rejection clears placeholder.
- [x] Add renderer test: session switch clears placeholder.

## 3. Verification

- [x] Run focused `ChatPage` renderer test.
- [x] Run focused message store streaming test if store helper changes.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run lint`.
