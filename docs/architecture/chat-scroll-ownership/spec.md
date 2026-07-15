# Chat Scroll Ownership Architecture

## Status

Implementation in progress as of 2026-07-15. The exclusive controller, isolated message viewport,
request attribution, geometry observer, atomic message-view commit, and bounded renderer cache are
implemented. The real Electron scenario is present but still requires an opt-in provider run for
final browser evidence and performance numbers.

GitHub issue sync was not requested and is not part of this work.

## Implemented foundation

- `useChatScrollController` is the only low-level message viewport writer. It enforces one active
  operation and at most one physical write before the next animation-frame boundary.
- Passive owners are mode-gated: restore/follow cannot run in reading mode, while measurement
  anchoring cannot run in following mode.
- Programmatic scroll events are matched by request ID and expected position rather than timeout
  windows. User gestures cancel active and pending work atomically.
- Header, message viewport, and composer use isolated shell rows. One geometry observer reports
  viewport/message-root changes to the controller; the former eight-frame restore loop is removed.
- Message session loading keeps active selection separate from the committed message view, commits
  prepared records atomically, and uses a renderer-only five-session/count-and-memory-bounded LRU.
- Pending inputs load as secondary state and no longer block first message commit. Recent parsed
  messages and message measurements remain bounded and reusable across cached switches.
- Unit, component, architecture-guard, and opt-in Electron smoke coverage protect the new contract.

## Validation record

- Review-hardening scroll, page, keyed-parent, cache, and architecture suites passed 120/120 tests.
- Full renderer suite with four workers and a 30-second per-test budget: 168 files and 1267 tests
  passed.
- Format, i18n, lint including architecture guards, Node/Web typecheck, and production build passed.
- Playwright successfully discovers the opt-in real Electron scroll scenario at
  `test/e2e/specs/31-chat-scroll-ownership.smoke.spec.ts`.
- The real Electron/provider scenario and manual macOS trackpad matrix remain outstanding; no
  claim of final physical-device validation is made yet.

## User need

Chat scrolling must feel native and remain under the user's control in short, long, restored, and
streaming conversations. Opening search, loading history, rendering Markdown, resizing the composer,
showing plans, or receiving stream updates must not flash, jump backward, or steal the scrollbar.

The redesign must preserve every current ChatPage capability and all existing user data while making
the implementation smaller, testable, and maintainable.

## Problem statement

`ChatPage.vue` currently combines page orchestration, message conversion, session restoration,
history pagination, bounded rendering, row measurement, auto-follow, search, Spotlight navigation,
plan layout, composer behavior, and direct DOM scrolling in one component of more than 3,000 lines.

The same outer element is both the page shell and message scroll container. Its scroll geometry
therefore includes the top bar, search chrome, messages, plan padding, pending lanes, status content,
and sticky composer. Those regions can change height independently of messages. Chromium may clamp
`scrollTop` when the resulting maximum changes, even when JavaScript did not explicitly request a
scroll.

At the same time, several independent code paths can write scroll position through `scrollTop` or
`scrollIntoView`. Ownership is inferred through overlapping millisecond windows rather than an
explicit transaction model. Unit tests can validate numerical writes but cannot reproduce real
Chromium layout, sticky positioning, native scroll anchoring, compositor behavior, or scroll
clamping.

## Goals

1. Make the message viewport the only element that owns chat scrolling.
2. Route every programmatic scroll through one typed controller with explicit reason and priority.
3. Give an active user gesture durable ownership until the user explicitly returns to the bottom or
   requests a navigation action.
4. Preserve current short-chat, long-chat, streaming, history, search, Spotlight, capture, plan,
   interaction, pending-input, read-only, and session-switch behavior.
5. Keep the bounded message window and logical message addressing for long-chat performance.
6. Preserve all stored sessions, messages, cursors, settings, drafts, plans, and pending inputs
   without migration.
7. Reduce ChatPage responsibilities into focused components and composables with black-box tests.
8. Add real Chromium coverage for layout-dependent scroll behavior.
9. Make first chat paint and session switching fast without trading away loaded history, search
   counts, or data correctness.

## Non-goals

- No database, IPC, presenter, session schema, or message schema changes.
- No redesign of message visuals, composer visuals, search UI, plan UI, or interaction UI.
- No replacement of the existing message store or provider/streaming pipeline.
- No third-party virtual-list dependency as the source of message identity or position.
- No change to the meaning or default of `autoScrollEnabled`.
- No GitHub issue or PR creation without separate approval.

## Required architecture

### Page geometry

The page shell must use three independent layout regions:

```text
ChatPageShell (overflow: hidden)
├── ChatHeaderRegion            fixed layout row; never scrolls with messages
├── ChatMessageViewport         minmax(0, 1fr); the only overflow-y:auto owner
│   ├── history status overlay  out of normal message flow
│   ├── search overlay          out of normal message flow
│   └── MessageList             messages and virtual spacers only
└── ChatComposerRegion          fixed layout row; outside message scroll geometry
    ├── pending input lane
    ├── plan / interaction layer
    ├── ChatInputBox
    └── ChatStatusBar
```

The shell uses `display: grid`, `grid-template-rows: auto minmax(0, 1fr) auto`, and
`overflow: hidden`. Only `ChatMessageViewport` may expose `overflow-y: auto`.

Header, composer, plan, status, pending-input, and search height changes must not add or remove
content inside the message scroll extent. Viewport size changes are reported to the controller as
geometry changes, not mistaken for user scrolls.

### Single scroll owner

All chat scroll writes must pass through `useChatScrollController`. Components and feature
composables may request navigation but may not write `scrollTop`, call `scrollTo`, or call
`scrollIntoView` on the message viewport directly.

Allowed request reasons:

```ts
type ChatScrollReason =
  | 'session-restore'
  | 'auto-follow'
  | 'submit'
  | 'history-prepend'
  | 'measurement-anchor'
  | 'search-navigation'
  | 'spotlight-navigation'
  | 'user-return-to-bottom'
```

Every request carries the active session epoch. Stale requests from an old session are discarded.
The controller commits at most one physical scroll write per animation frame.

Only one scroll operation may be active at any time, including across multiple frames. A request
cannot run concurrently with restore, follow, history, measurement, search, or Spotlight work.
Repeated requests from the same owner coalesce into the active operation. A higher-priority explicit
request replaces the active operation atomically. Lower-priority passive requests are discarded,
not queued for a delayed write that could pull the viewport back later. A user gesture cancels the
active operation and all uncommitted work in one step.

### Ownership and priority

Priority is explicit and stable:

1. Active user gesture or durable reading mode.
2. Explicit user navigation: search, Spotlight, return-to-bottom.
3. History-prepend anchor preservation.
4. Session restore before any user interruption.
5. Generation auto-follow when enabled and still owned.
6. Passive measurement refinement.

User ownership is event-driven, not timeout-driven. Wheel, touch, scrollbar pointer, and scroll
keys enter reading mode. Reading mode persists until one of these occurs:

- the user scrolls back within the bottom threshold;
- the user presses the explicit return-to-bottom action;
- the user starts an explicit search or Spotlight navigation;
- the session changes and a new session epoch begins.

Idle timers may be used to reduce measurement and rendering work, but they must never decide who
owns the scrollbar.

### Controller state

```ts
type ChatScrollMode =
  | 'restoring'
  | 'following'
  | 'reading'
  | 'navigating'
  | 'history-preserving'

type ChatScrollState = {
  sessionEpoch: number
  mode: ChatScrollMode
  userOwned: boolean
  nearBottom: boolean
  activeGesture: boolean
  lastCommittedRequestId: number
}
```

Programmatic writes use request IDs and expected targets. The following `scroll` event is matched to
the committed request instead of being classified by a time window. Unexpected position changes are
treated as native layout/clamping events and observed separately.

### Short and long conversations

- Below the existing windowing threshold, all messages remain rendered and row measurements never
  write scroll position.
- Above the threshold, the existing logical layout model continues to provide message top/bottom
  positions and bounded DOM rendering.
- Measurement batches update the logical height map once per frame.
- When reading a long conversation, one stable logical message anchor is preserved in the same
  frame as the height-map commit.
- Overscan and mounted-row bounds remain compatible with the current long-chat contract.

### Session restore

- A session begins with a new epoch and one initial bottom request.
- Late restore, resize, or message responses from an older epoch are ignored.
- The restore request is permanently cancelled by any user gesture in that epoch.
- Repeated eight-frame or broad ResizeObserver bottom writes are removed. If asynchronous content
  requires settling, the controller follows only while mode remains `restoring` or `following` and
  coalesces to one frame write.
- Resize-driven following obeys `autoScrollEnabled`; restore positioning remains allowed regardless
  of that preference, but later message-root or composer geometry changes may not bypass it.
- A layout-induced native scroll may update bottom proximity, but it may not surrender durable user
  ownership without an active user gesture.

### First load and session switching

Loading is split into critical and secondary paths:

```text
critical path
  session selection
    -> prepare latest message window
    -> atomically commit session view
    -> render latest bounded rows
    -> position once
    -> input and message viewport interactive

secondary path
  pending inputs + plans + metadata + adjacent pre-measurement + optional pre-hydration
```

- Do not clear the visible message view before the target session window is ready to commit.
- Never expose a mixed state containing the new session header and old session messages.
- Uncached switches use a fixed-geometry loading overlay inside the isolated viewport. Cached
  switches restore a renderer-only recent-session view immediately.
- Keep a bounded in-memory LRU cache of recent session view models, logical height maps, and last
  viewport anchors. The cache is ephemeral, keyed by session ID plus message revision, and never
  persisted.
- A prepared session result commits only when its session epoch is still current.
- A failed or superseded preparation does not expose the target view or enable its composer unless a
  matching cached view was already committed safely.
- Message data and the latest viewport are the critical path. Pending inputs, plan state, status
  metadata, and optional adjacent-row hydration load in parallel but do not block first message
  paint.
- Load the existing history count for compatibility, pagination, and search correctness, but mount
  only the bounded viewport plus overscan. Loaded records must not imply mounted heavy DOM rows.
- Preserve the page shell, composer instances, TipTap state, and global layout across session
  switches; replace only session-scoped view data.

### Streaming and submit behavior

- Submitting a new message explicitly transfers ownership to bottom-follow for that new turn.
- Streaming follows the bottom only when `autoScrollEnabled` is true and the user has not entered
  reading mode afterward.
- Token revisions do not independently write scroll position. They invalidate one coalesced
  auto-follow request.
- When the user scrolls away, streaming continues without changing the viewport.
- Coalesced search or Spotlight requests preserve the ownership state captured by the first active
  navigation transaction until that transaction completes.

### History pagination

- Pagination requires a full initial history window, a scrollable viewport, an upward user intent,
  and a threshold crossing owned by the controller.
- Upward intent that begins while already inside the top threshold arms pagination even when the
  browser emits no additional `scroll` event.
- Only one history request may exist per session epoch.
- The pre-request logical anchor and current user offset are captured.
- After prepend, the controller commits one anchor-preserving correction before paint.
- Loading chrome is overlay-only and does not change message origin or scroll extent.
- Touch ownership and frozen window measurements remain active through native inertial scrolling,
  ending on `scrollend` with an idle fallback.

### Search, Spotlight, and editor containment

- Search and Spotlight resolve a `messageId` through the logical layout model.
- Off-window navigation first requests the correct logical viewport, waits for the target row to
  mount, then applies highlight without a second viewport-level `scrollIntoView`.
- Same-query highlight refresh never navigates.
- TipTap selection scrolling is contained inside the editor. It must not scroll the message
  viewport or page shell.
- Cmd/Ctrl+F result counts and navigation semantics remain unchanged.

## Functional compatibility matrix

| Capability | Required result |
| --- | --- |
| Session open/switch | Latest messages appear at bottom unless the user interrupts restore |
| First application chat load | Shell and input become interactive before secondary session state |
| Cached session switch | Recent session view and anchor restore without an empty-state flash |
| Uncached session switch | Fixed viewport loading state, then one atomic target-session commit |
| Auto-scroll enabled | New generation follows bottom until user scrolls away |
| Auto-scroll disabled | Generation never steals the viewport |
| New message submit | New turn moves to bottom once, then respects later user ownership |
| Short conversations | No pagination, measurement correction, flash, or rollback |
| Long conversations | Bounded mounted rows, stable spacers, no blank gaps |
| Older-history loading | Same message and intra-message offset remain visible |
| Cmd/Ctrl+F | Full loaded-message count; next/previous works across virtual windows |
| Spotlight/trace jump | Target mounts, centers once, highlights, and clears pending navigation |
| Streaming Markdown | No full-list rebuild and no viewport movement in reading mode |
| Images/artifacts/tools | Late size changes preserve long-list anchors without short-list writes |
| Plan/interaction/pending lane | Visual behavior unchanged; no participation in message scroll extent |
| Composer resize/focus/IME | Draft and focus remain intact; message viewport is not scrolled |
| Read-only/subagent sessions | Existing display and navigation behavior remains unchanged |
| Capture/export | Full loaded-message capture behavior remains available |

## Data and compatibility guarantees

- No changes under `src/main`, `src/preload`, database schemas, encryption, import/export, or
  persisted configuration.
- No changes to message IDs, `renderKey`, ordering, pagination cursor, session identity, or message
  cache semantics.
- `autoScrollEnabled` retains its current persisted key and meaning.
- Scroll controller state is renderer-only and ephemeral. It is reset on session epoch changes and
  is never persisted.
- Existing user data requires no migration and remains readable by both pre-refactor and
  post-refactor builds.
- Rollback is a source-code rollback only; it does not require data rollback.

## Performance and experience acceptance criteria

1. During an active user gesture, no unauthorized programmatic scroll write occurs.
2. In reading mode, the selected logical anchor drifts by at most 1 CSS pixel across Markdown,
   image, tool, plan, composer, and streaming layout changes.
3. Short conversations with 1–20 messages perform zero measurement-driven scroll writes.
4. One user navigation action produces at most one viewport write plus one highlight-only DOM pass.
5. One animation frame contains at most one committed viewport scroll write.
6. Across frames, at most one scroll transaction remains active; no second owner can alternate
   writes with it.
7. Long conversations keep mounted heavy message rows bounded by the active window and overscan.
8. Continuous wheel/trackpad scrolling has no application-generated long task above 50ms and no
   repeated frame-by-frame full-list conversion.
9. Streaming scroll work is coalesced to animation frames; token frequency does not equal scroll
   write frequency.
10. Search, history, and Spotlight navigation complete without visible intermediate window swaps.
11. Existing renderer unit suites, typecheck, lint, i18n, and architecture guards pass.
12. Chromium integration scenarios show no flash, rollback, native clamp, or scrollbar theft.
13. On the agreed reference machine, warm cached session switches reach first meaningful message
    paint at p95 within 100ms, uncached local switches within 250ms, and initial chat shell
    interaction within 150ms. CI records these metrics and uses a wider non-regression budget where
    machine variance makes absolute limits unsuitable.
14. Session switching performs no full heavy-DOM mount for every loaded message and produces no
    intermediate empty or mixed-session frame.

## Maintainability acceptance criteria

- `ChatPage.vue` becomes an orchestration shell rather than a scroll implementation owner.
- Direct message viewport writes are architecture-guarded to the controller module.
- Scroll state transitions are pure and unit-testable.
- Feature composables request typed scroll intents instead of sharing mutable timers.
- Each asynchronous operation is scoped by session epoch and cancellable cleanup.
- Comments explain invariants and ownership, not timing folklore.

## Linked specifications

- `docs/architecture/chat-scroll-windowing/spec.md`
- `docs/issues/chat-history-search-scroll-coordinates/spec.md`
- `docs/features/markstream-chat-rendering-optimization/spec.md`
- `docs/issues/chat-search-highlight-flicker/spec.md`
- `docs/issues/mac-native-feel-audit/spec.md`
