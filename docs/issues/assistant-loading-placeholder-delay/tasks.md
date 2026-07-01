# Assistant Loading Placeholder Delay Tasks

## 0. Review Gate

- [x] Locate send path, stream path, and message rendering ownership.
- [x] Confirm root cause is renderer waiting for backend stream state.
- [x] Confirm no backend contract change is needed for the first increment.

## 1. Renderer Implementation

- [ ] Add local pending assistant placeholder state in `ChatPage.vue`.
- [ ] Reuse existing empty pending assistant rendering for the loading row.
- [ ] Clear composer and scroll immediately after local optimistic state is set.
- [ ] Hide/clear placeholder when real streaming starts.
- [ ] Clear placeholder on send failure before streaming.
- [ ] Clear placeholder on session id change.
- [ ] Keep queued-input submit path unchanged.

## 2. Tests

- [ ] Add renderer test: submit shows assistant loading row before stream update.
- [ ] Add renderer test: stream update removes/hides placeholder and uses real stream row.
- [ ] Add renderer test: active-generation queued submit does not create placeholder.
- [ ] Add renderer test: send rejection clears placeholder.
- [ ] Add renderer test: session switch clears placeholder.

## 3. Verification

- [ ] Run focused `ChatPage` renderer test.
- [ ] Run focused message store streaming test if store helper changes.
- [ ] Run `pnpm run format`.
- [ ] Run `pnpm run lint`.
