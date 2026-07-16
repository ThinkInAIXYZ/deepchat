# Chat history and search scroll coordinates

## Current status

Superseded by the in-progress `docs/architecture/chat-scroll-ownership/` implementation. The
exclusive controller, isolated viewport, request attribution, and removal of repeated restore
settling are implemented and covered by focused tests. This issue remains historical root-cause
evidence until the new opt-in Electron scenario and manual trackpad matrix are completed.

## Issue

Long conversations can jump or appear to roll back while older history is prepended. Inline
`Cmd/Ctrl+F` search can also land away from the selected match or accidentally trigger another
history request.

The failures share two underlying problems: message-window layout coordinates, rendered DOM
coordinates, and the chat scroll container lacked one explicit conversion contract; after that
static drift was corrected, ChatPage still had multiple asynchronous scroll writers forming
feedback loops.

## Impact

- Loading older history interrupts upward reading with a visible reverse jump.
- Coordinate error grows with message count, making long conversations worse.
- Search navigation can center the wrong area before the target row mounts.
- A search-driven `scrollIntoView` can be treated as user scrolling and request older history.

## Root cause

1. `MessageList.vue` uses `space-y-1` (4px) between rendered children, while
   `useMessageWindow.ts` only sums row heights. Virtual entry positions and spacer heights omit a
   cumulative 4px per message.
2. `ChatPage.vue` writes `MessageLayoutEntry.top` directly to the chat container's `scrollTop`.
   `entry.top` is relative to the message-list layout origin, not the outer container; the chat top
   bar and list padding are omitted.
3. The already-rendered search path calls `scrollIntoView` before entering manual/programmatic
   scroll mode. Its scroll events can therefore be classified as user intent and reach the history
   loading threshold.
4. Search navigation defaults to smooth scrolling even though the maintained macOS native-feel
   contract requires immediate/default search and message jumps. Smooth scroll frames race virtual
   window updates and active-highlight refresh.
5. The first restore count was only 40 while normal restore/history pages use 100. This made the
   first trigger unusually early but was not the coordinate bug. The restored count remains 100.
6. `watch([visibleDisplayMessages, chatSearchResults])` schedules
   `refreshChatSearchHighlights()`, which always calls `revealChatSearchResult()`. A virtual-window
   change therefore navigates again, writes scroll position, and causes another window change.
7. History compensation writes `scrollTop` without first taking programmatic-scroll ownership.
   Its browser `scroll` event can reuse the preceding wheel-intent time window, enter anchored
   reading, and clear the programmatic guard.
8. Row measurements resume around 160ms after scrolling while user-away intent lasts 300ms.
   Measurements still mutate spacer geometry, but anchor restoration is discarded during that
   interval. Later measurement batches can restore the old anchor, producing the visible
   "shift, flash, return" sequence.
9. Measurements are applied in batches of 12 across multiple animation frames. Each batch can
   recompute the virtual range and mount another row set, producing a measurement/remount loop.
10. The history loading label is conditionally inserted above `MessageList` in normal document
    flow. Starting and finishing a request therefore moves the message-window origin independently
    of both virtual-layout compensation and row measurement.
11. Measurement anchoring is DOM-based and deferred to a later animation frame. Vue can commit the
    changed spacer/window geometry and Chromium can paint it before the corrective `scrollTop`
    write, which makes an otherwise numerically correct correction visibly flash and roll back.
12. Reaching the top from any `scroll` event can start pagination. A layout-origin change or other
    browser-generated scroll can therefore be treated as a new history gesture even when no upward
    user intent preceded it.
13. Measurement anchoring still runs for short conversations below the windowing threshold. With
    only a few fully rendered rows, a delayed Markdown/ResizeObserver measurement above the
    viewport can therefore write `scrollTop` even though no spacer or virtual range exists.
14. Entering and leaving `.dc-list-scrolling` changes page-wide blur CSS variables. Every wheel idle
    boundary repaints sticky and glass surfaces, which presents as an additional visual flicker even
    when the numerical scroll position is stable.
15. Session-restore bottom settling is armed only after the asynchronous restore resolves. A user
    can begin scrolling before its wheel/touch/pointer cancellation listeners exist; the later
    restore then starts an eight-frame plus ResizeObserver bottom loop and repeatedly pulls the
    short conversation back while Markdown layout settles.

## Existing SDD contracts

- `docs/architecture/chat-scroll-windowing/spec.md`: bounded rendering must keep logical positions
  addressable by message ID and preserve line of sight while loading history.
- Historical #1841/#1844 harness reliability work: keep the bounded spacer window and data-driven
  full loaded-message search counts; do not return to full heavy DOM rendering.
- `docs/features/markstream-chat-rendering-optimization/spec.md`: search keeps Markdown DOM
  available for the active rendered window.
- `docs/issues/mac-native-feel-audit/spec.md`: explicit chat search/message jumps are immediate.
- `docs/issues/chat-search-highlight-flicker/spec.md`: same-query highlighting remains incremental.

## Coordinate contract

- A virtual entry's `top` and `bottom` include the visual 4px space reserved after its row.
- Measured row height includes that same visual spacing; estimates and measurements use identical
  units.
- `MessageList` exposes a stable DOM layout origin immediately before the virtual before-spacer.
- A message layout position is converted to container scroll space as:
  `origin content position + entry.top - desired viewport offset`.
- Search and spotlight jumps submit typed navigation requests to the exclusive controller before
  any highlight pass.
- Search next/previous jumps use immediate/default behavior.
- Virtual-window changes while search is open only refresh and reactivate marks without scrolling.
- All row measurements observed in one frame commit as one layout batch and schedule at most one
  anchor restoration.
- Each programmatic write records its request ID and expected top. A real wheel/touch/pointer/key
  gesture atomically cancels the active operation and every uncommitted request.
- History loading UI is overlay-only and never changes the message-window layout origin.
- Measurement batches preserve a virtual entry's logical top synchronously in the same frame;
  they do not wait for a later DOM query and corrective scroll.
- Top pagination requires upward user intent that existed before the triggering scroll event.

## Architecture resolution

- `ChatPage` contains one `overflow-y-auto` message viewport; top bar and composer geometry are
  outside its scroll extent.
- `useChatScrollController` contains the only message viewport `scrollTop` assignment and commits
  at most one physical write before the next frame boundary.
- Following, reading, navigating, history-preserving, and restoring modes reject conflicting
  passive owners, so measurement and bottom-follow cannot alternate across frames.
- The old programmatic/user millisecond windows and eight-frame/600ms restore loop are removed.
- Short conversations remain fully rendered and never perform measurement-anchor writes.
- Cmd/Ctrl+F and Spotlight resolve logical message coordinates through the controller, then apply
  highlights without a second viewport-level `scrollIntoView`.

## Fix plan

1. Move message spacing from container child margins into measured row padding and remove
   `space-y-1` from the virtualized child container.
2. Add the 4px row spacing to unmeasured message estimates.
3. Add a stable message-window origin marker and a single ChatPage coordinate conversion helper.
4. Use the conversion helper for search and spotlight virtual jumps.
5. Mark both rendered and virtual search jumps as manual/programmatic before scrolling.
6. Restore immediate search navigation required by the native-feel regression contract.
7. Keep history prepend compensation anchored to stable virtual entries after the layout units are
   corrected.
8. Split search highlight refresh from explicit search navigation.
9. Mark history compensation as programmatic before DOM/window changes and clear stale input-time
   attribution when any programmatic operation begins.
10. Batch all pending row measurements into one animation-frame commit and preserve one viewport
    anchor for the batch.
11. Do not suppress post-idle measurement anchoring merely because the last upward gesture is less
    than 300ms old; active gesture state remains the write barrier.
12. Remove the history loading indicator from normal flow so request state cannot move messages.
13. Replace next-frame DOM anchor restoration with same-frame logical-entry compensation after the
    batched height map is committed.
14. Require pre-existing upward wheel/touch/pointer/keyboard intent before top pagination.
15. Never apply measurement-driven scroll compensation below the windowing threshold.
16. Keep visual blur tokens stable across scroll start/idle transitions.
17. Persist user interruption against the session-restore request itself, including gestures that
    occur before bottom settling is installed.

## Task checklist

- [x] Make rendered row measurement and virtual estimates include the same 4px spacing.
- [x] Add and test the message-window origin contract.
- [x] Convert search and spotlight entry positions into container coordinates.
- [x] Prevent search navigation from triggering history pagination.
- [x] Restore immediate/default search jump behavior.
- [x] Add regression coverage for cumulative virtual layout spacing and off-window search jumps.
- [x] Run focused tests, format, i18n, lint, and Web typecheck.
- [x] Stop virtual-window search refresh from navigating or writing scroll position.
- [x] Give history compensation programmatic-scroll ownership.
- [x] Batch row measurements and restore one anchor per committed batch.
- [x] Cover the feedback-loop timing paths with regression tests.
- [x] Re-run focused and full renderer validation after the feedback-loop fix.
- [x] Keep the message-window origin stable while history loading state toggles.
- [x] Commit measurement heights and logical-anchor compensation in the same frame.
- [x] Prevent layout-only top scroll events from starting history pagination.
- [x] Add regressions for origin stability, same-frame compensation, and pagination intent.
- [x] Re-run focused validation and quality gates for the revised fix.
- [x] Prevent measurement-driven scroll writes for short conversations.
- [x] Remove scroll-state blur token mutations.
- [x] Add a four-message measurement regression and retain long-window compensation coverage.
- [x] Re-run focused validation and quality gates for the short-conversation fix.
- [x] Make session-restore interruption request-scoped and race-proof.
- [x] Cover user scrolling before asynchronous restore completion.
- [x] Re-run focused validation and quality gates for the restore race fix.

## Acceptance criteria

- Prepending history preserves the same reading anchor without a second reverse correction.
- Virtual entry positions stay aligned after hundreds of rows; spacing does not accumulate as
  untracked error.
- `Cmd/Ctrl+F` navigation mounts and activates an off-window result, then centers the selected mark.
- Search navigation near the top does not call `loadOlderMessages`.
- Scrolling while search is open does not recenter the active result.
- A post-scroll measurement batch does not first drift and later restore across multiple frames.
- Existing auto-follow, manual reading, spotlight jumps, and session-switch race guards remain
  intact.

## Validation

- `test/renderer/composables/useMessageWindow.test.ts`
- `test/renderer/components/MessageList.test.ts`
- `test/renderer/components/MessageListRow.test.ts`
- `test/renderer/components/ChatPage.test.ts`
- Automated result: 79 focused renderer tests passed across the four suites above.
- Full renderer result: all 167 test files completed; 1269 tests passed, while two unrelated UI
  tests timed out under full-suite load. Both timed-out files passed in isolation (20/20 tests),
  including the exact timed-out cases.
- Quality gates passed: format, i18n, lint (including architecture guards), and Web typecheck.
- Revised short-conversation and same-frame-anchor validation: 66 ChatPage tests and 16 related
  message-window tests passed.
- Final short-list measurement validation: 67 ChatPage tests and 16 related message-window tests
  passed, including separate four-message and long-window anchoring cases.
- Restore-race validation: 68 ChatPage tests and 16 related message-window tests passed; the new
  pre-completion user-scroll case fails before the request-level interruption fix and passes after.
- Manual verification in a conversation with more than 160 messages:
  - repeated upward wheel/trackpad scrolling across at least two history pages
  - `Cmd/Ctrl+F` next/previous navigation between visible and off-window matches
- Real-world manual verification after the incremental fixes: failed; visible rollback remains.
- Architecture follow-up: `docs/architecture/chat-scroll-ownership/`.
- Architecture implementation validation: focused scroll/page/window/store suites passed, the
  stabilized full renderer run passed all 167 files and 1252 tests, and production build passed.
- The opt-in Electron scroll ownership scenario is implemented and Playwright-discoverable; it
  still requires provider-backed execution and manual macOS trackpad verification before this
  historical issue can be considered physically validated.

## Linked GitHub issue

Not synced. GitHub issue creation requires explicit developer approval.
