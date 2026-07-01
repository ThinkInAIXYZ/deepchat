# Tool Call Review Status Indicator Tasks

## 0. Review Gate

- [x] Locate tool pill status ownership.
- [x] Locate tool block lifecycle mutation points.
- [x] Confirm the status should be a transient review substate, not a new terminal block status.

## 1. Runtime

- [ ] Add transient review marker helper for tool blocks.
- [ ] Mark the exact tool call before awaiting auto-approve reviewer.
- [ ] Flush renderer snapshot after marking review state.
- [ ] Clear marker on auto-allow.
- [ ] Clear marker on ask-user fallback.
- [ ] Clear marker on block/error/abort paths.
- [ ] Avoid marker changes outside `auto_approve`.

## 2. Renderer

- [ ] Extend tool block extra type with `autoApproveReviewStatus`.
- [ ] Add `reviewing` status variant in `MessageBlockToolCall.vue`.
- [ ] Render reviewing as a yellow dot/ring in the existing indicator slot.
- [ ] Keep neutral/running/success/error visuals unchanged.
- [ ] Ensure the tool pill width and text truncation do not shift.

## 3. Tests

- [ ] Add runtime test for marker emitted before reviewer promise resolves.
- [ ] Add runtime test for marker cleared after reviewer allow.
- [ ] Add runtime test for marker cleared on ask-user fallback.
- [ ] Add runtime test for marker cleared on block/error.
- [ ] Add renderer test for yellow review indicator.
- [ ] Add renderer test for terminal status precedence over stale review marker.

## 4. Verification

- [ ] Run focused agent runtime dispatch tests.
- [ ] Run focused `MessageBlockToolCall` renderer tests.
- [ ] Run `pnpm run format`.
- [ ] Run `pnpm run lint`.
