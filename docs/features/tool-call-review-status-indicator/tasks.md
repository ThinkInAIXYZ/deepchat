# Tool Call Review Status Indicator Tasks

## 0. Review Gate

- [x] Locate tool pill status ownership.
- [x] Locate tool block lifecycle mutation points.
- [x] Confirm the status should be a transient review substate, not a new terminal block status.

## 1. Runtime

- [x] Add transient review marker helper for tool blocks.
- [x] Mark the exact tool call before awaiting auto-approve reviewer.
- [x] Flush renderer snapshot after marking review state.
- [x] Clear marker on auto-allow.
- [x] Clear marker on ask-user fallback.
- [x] Clear marker on block/error/abort paths.
- [x] Avoid marker changes outside `auto_approve`.

## 2. Renderer

- [x] Extend tool block extra type with `autoApproveReviewStatus`.
- [x] Add `reviewing` status variant in `MessageBlockToolCall.vue`.
- [x] Render reviewing as a yellow dot/ring in the existing indicator slot.
- [x] Keep neutral/running/success/error visuals unchanged.
- [x] Ensure the tool pill width and text truncation do not shift.

## 3. Tests

- [x] Add runtime test for marker emitted before reviewer promise resolves.
- [x] Add runtime test for marker cleared after reviewer allow.
- [x] Add runtime test for marker cleared on ask-user fallback.
- [x] Add runtime test for marker cleared on block/error.
- [x] Add renderer test for yellow review indicator.
- [x] Add renderer test for terminal status precedence over stale review marker.

## 4. Verification

- [x] Run focused agent runtime dispatch tests.
- [x] Run focused `MessageBlockToolCall` renderer tests.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run lint`.
