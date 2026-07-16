# Chat Scroll Ownership Implementation Plan

## Architecture decisions

### 1. Separate page chrome from message geometry

Introduce a focused shell structure without changing visible UI:

- `ChatPage.vue`: session/message orchestration and feature wiring.
- `ChatPageShell.vue`: three-row header/viewport/composer layout.
- `ChatMessageViewport.vue`: the only scrollable chat element and MessageList host.
- `ChatComposerRegion.vue`: existing pending lane, plan/interaction layer, input, memory chip, and
  status bar composition.

The first implementation should move existing template blocks with the smallest possible prop/emit
surface. Business logic remains in ChatPage until the shell geometry is proven.

### 2. Introduce one typed scroll controller

Create `src/renderer/src/composables/chat/useChatScrollController.ts`.

Suggested public API:

```ts
type ChatScrollRequest = {
  id: number
  sessionEpoch: number
  reason: ChatScrollReason
  priority: number
  target:
    | { kind: 'bottom' }
    | { kind: 'absolute'; top: number }
    | { kind: 'message'; messageId: string; align: 'start' | 'center' | 'one-third' }
    | { kind: 'preserve-anchor'; anchor: LogicalViewportAnchor }
}

type UseChatScrollControllerOptions = {
  viewport: Readonly<ShallowRef<HTMLElement | null>>
  resolveMessageEntry: (messageId: string) => MessageLayoutEntry | undefined
  resolveMessageElement: (messageId: string) => HTMLElement | null
  getMessageOriginTop: () => number | null
  isAutoScrollEnabled: Readonly<Ref<boolean>>
}

type ChatScrollController = {
  state: Readonly<ShallowRef<ChatScrollState>>
  beginSession: (sessionId: string) => number
  request: (request: Omit<ChatScrollRequest, 'id'>) => number
  cancel: (requestId: number) => void
  notifyUserGestureStart: (kind: 'wheel' | 'touch' | 'pointer' | 'keyboard') => void
  notifyUserGestureEnd: () => void
  notifyViewportScroll: () => void
  notifyViewportResize: () => void
  notifyLayoutBatch: (changes: MessageMeasurementChange[]) => void
  dispose: () => void
}
```

The controller owns the only low-level functions allowed to assign viewport `scrollTop`.

An exclusive operation arbiter sits in front of the frame queue. It holds at most one active
operation until completion or cancellation. Same-reason updates coalesce; higher-priority explicit
requests replace atomically; lower-priority passive work is dropped rather than replayed later.

### 3. Replace timing attribution with request attribution

Remove `programmaticScrollUntil`, `userScrollInputUntil`, and ownership decisions based on elapsed
milliseconds.

For each committed request, record:

```ts
type CommittedScroll = {
  requestId: number
  reason: ChatScrollReason
  expectedTop: number
  committedAtFrame: number
}
```

The next viewport scroll is compared with `expectedTop` using a one-pixel tolerance. Matching events
complete the request. Non-matching changes are classified as user/native geometry events. Idle
timers remain allowed only for deferring measurement/hydration work.

### 4. Make the state machine pure

Put transition logic in a small pure module, for example
`src/renderer/src/composables/chat/chatScrollState.ts`.

Inputs include session start, gesture start/end, bottom proximity, explicit navigation, submit,
stream update, history start/end, and request completion. Outputs are state plus optional scroll
intent. Unit tests cover every transition without DOM.

Key rule: once `userOwned` becomes true, passive restore, stream, resize, and measurement events
cannot clear it.

### 5. Integrate current bounded layout model

Keep `useMessageWindow` as the logical source of message positions. Narrow its responsibility to:

- estimates and measured height cache;
- stable message entries;
- total logical height;
- bounded range calculation helpers.

It must not know about scroll modes or DOM ownership. The controller receives committed measurement
changes and decides whether to follow bottom, preserve a long-list anchor, or perform no write for a
short list.

### 6. Migrate feature paths one by one

Route paths through the controller in this order:

1. Session open and restore.
2. User gesture detection and return-to-bottom.
3. Submit and streaming auto-follow.
4. Row measurement and viewport resize.
5. History pagination compensation.
6. Search navigation.
7. Spotlight/trace navigation.
8. TipTap/editor scroll containment.

After each step, prohibit the migrated direct write through focused ownership tests.

### 7. Preserve composer and plan behavior

Move composer DOM outside the viewport without unmounting existing components. Keep the same
component instances, props, emits, refs, `v-show` behavior, IME state, TipTap draft, pending queue,
memory chip, plan, and tool interaction lifecycle.

Observe composer/header size only to report viewport geometry. In reading mode, capture a logical
message anchor before applying a viewport-size change and restore it within the ResizeObserver phase
before paint. In following mode, coalesce one bottom request.

### 8. Remove viewport-level `scrollIntoView`

Search and Spotlight use the controller's message target resolution. Once the message row is
mounted, highlights are applied with `scroll: false`. Editor commands use editor-local scrolling or
an explicitly bounded scroll container so focus cannot move ChatMessageViewport.

### 9. Add staged session view preparation

Replace clear-then-restore presentation with a renderer-only prepare/commit flow:

```ts
type PreparedChatSessionView = {
  sessionId: string
  sessionEpoch: number
  messageRevision: number
  messageIds: string[]
  messageCache: Map<string, ChatMessageRecord>
  cursor: string | null
  hasMoreHistory: boolean
  layoutSnapshot?: MessageLayoutSnapshot
  viewportAnchor?: LogicalViewportAnchor
}
```

Preparation may read through existing session client/store APIs, but it must not mutate the visible
session incrementally. Commit the prepared view atomically only if its epoch is current.

Keep a small renderer-only LRU cache, initially capped at five recent sessions or a measured memory
budget. Invalidate entries when their message revision is stale. Cache entries contain view models
and layout measurements only; they do not duplicate persisted ownership or change database data.

Initial load and uncached switching run message preparation, pending-input loading, and secondary
state loading in parallel. Message preparation alone gates first message paint. Secondary results
attach afterward only if their epoch remains current.

### 10. Use progressive rendering without reducing loaded history

Continue loading the compatibility history window used by pagination and search. Render only the
latest viewport and overscan on the critical frame. Defer adjacent row mounting, non-visible heavy
Markdown hydration, and measurement refinement until browser idle or viewport approach.

The composer and shell stay mounted through session switches. An uncached target displays a stable
overlay inside ChatMessageViewport rather than collapsing the page or showing old-session content
under a new header.

## Event flow

```text
wheel/touch/pointer/key
  -> controller userOwned=true
  -> cancel restore/follow/passive requests
  -> native scroll updates viewport metrics only

stream/message/layout update
  -> feature emits typed request or layout notification
  -> controller state machine evaluates ownership
  -> request queue coalesces by priority and session epoch
  -> one rAF commit
  -> one viewport scroll write
  -> matching scroll event completes request

search/Spotlight action
  -> explicit navigation request
  -> resolve logical message top
  -> mount bounded row if necessary
  -> one viewport commit
  -> highlight without scrollIntoView
```

## Compatibility and migration

### Data compatibility

No migration is required. The refactor remains entirely in renderer layout and ephemeral state.
No store, presenter, preload, database, import/export, encryption, or persisted setting contract is
changed.

### Source migration

Use reviewable phases rather than a single rewrite:

1. Add browser regression harness and scroll-write instrumentation against current behavior.
2. Add controller/state machine while preserving current DOM.
3. Add staged session preparation and atomic commit with performance marks.
4. Route direct writes through the controller.
5. Introduce the isolated shell/viewport geometry.
6. Add bounded recent-session caching and progressive heavy-row hydration.
7. Migrate search, Spotlight, history, measurement, and editor paths.
8. Delete legacy timers, duplicated state, and direct-write helpers.

Each phase must keep the app buildable and the existing unit suite green. Do not maintain two
production scroll implementations longer than the migration requires.

### Rollback

Because no data contracts change, any phase can be reverted at source level. During migration,
controller integration should be isolated by commits so a failed phase can be reverted without
reverting unrelated ChatPage functionality.

## Performance plan

- Use `shallowRef` for controller state snapshots and DOM refs.
- Use one rAF queue for all viewport writes.
- Use one rAF measurement batch for mounted rows.
- Keep token-level stream data out of stable historical message conversion.
- Preserve bounded rendering and overscan.
- Do not toggle page-wide effects or content-visibility during scroll.
- Avoid layout read/write alternation: collect reads, compute, then commit writes.
- Cache message ID to layout entry lookup instead of repeated full-array searches on hot paths.
- Instrument request count, committed write count, anchor drift, mounted row count, and long tasks in
  development builds.
- Add performance marks for session selection, message preparation, atomic commit, first meaningful
  message paint, input readiness, and secondary state completion.
- Bound recent-session caching by count and approximate view/layout memory, with observable LRU
  eviction that never touches persisted stores.

## Test strategy

### Pure unit tests

- State transitions and priority arbitration.
- Session epoch rejection.
- User ownership durability.
- Request coalescing and cancellation.
- Exclusive operation ownership across frames and atomic replacement.
- Bottom proximity and return-to-bottom behavior.

### Vue component tests

- Shell regions remain mounted and preserve props/emits.
- Only ChatMessageViewport has chat overflow scrolling.
- Short lists perform no measurement-driven writes.
- Long-list layout batches preserve one logical anchor.
- Existing ChatPage feature tests remain black-box compatible.

### Real Chromium integration tests

The current jsdom suite cannot validate this bug class. Add a Playwright/Electron or Vitest Browser
suite that records `scrollTop`, `scrollHeight`, `clientHeight`, anchor rect, and committed request
reason on every animation frame.

Required scenarios:

1. Four-message conversation with delayed Markdown/font/layout settling.
2. Composer growth, IME input, pending lane, plan, interaction, and status changes while reading.
3. Session restore with user wheel before and after data completion.
4. Streaming with auto-scroll enabled, then user interruption.
5. Streaming with auto-scroll disabled.
6. Threshold boundaries at 159, 160, and 161 messages.
7. Long conversation with rapid wheel scrolling and row measurements.
8. Two consecutive history pages with anchor preservation.
9. Cmd/Ctrl+F visible and off-window navigation while manually scrolling.
10. Spotlight navigation during session switch.
11. Image/tool/artifact expansion above the viewport.
12. TipTap focus, selection, newline, and attachment actions.
13. Initial application load with cold and warm renderer caches.
14. Rapid A -> B -> C session switching with B resolving last.
15. Cached return to a recent session and invalidation after message revision changes.

Assertions include zero unauthorized writes, no anchor drift above one pixel, no intermediate flash,
one write per frame maximum, no stale-session request commit, no mixed-session frame, bounded heavy
DOM rows, and recorded first-paint/session-switch latency.

## Quality gates

- Focused pure/controller tests.
- Existing ChatPage and message-window suites.
- New real Chromium scroll suite.
- Full renderer suite.
- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck:web`
- `pnpm run build`

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Composer extraction breaks TipTap/IME state | Move DOM without changing mount lifetime; add focus and draft tests |
| Search/Spotlight loses off-window targets | Preserve logical message addressing and mount-before-highlight flow |
| Long-list regressions | Keep `useMessageWindow`; migrate ownership, not the data model |
| Auto-follow feels delayed | One rAF coalescing adds at most one frame and removes duplicate writes |
| Viewport resize still clamps near bottom | Controller handles resize by mode: preserve anchor or follow bottom before paint |
| Migration creates two conflicting owners | Focused ownership tests and phase-by-phase removal of direct writes |
| Browser suite is slow | Keep a small critical Chromium suite separate from fast jsdom tests |
| Recent-session cache increases memory | Use a small LRU plus memory budget and observable eviction |
| Atomic preparation delays first paint | Gate on messages only; attach pending/plan/metadata later |
| Cached session view becomes stale | Key by message revision and invalidate on session/message events |
