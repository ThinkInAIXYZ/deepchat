# Chat Scroll Ownership Tasks

## Phase 0: Baseline and browser evidence

- [ ] Add development-only scroll instrumentation with reason, request ID, session epoch, expected
  top, actual top, scroll height, client height, and anchor ID.
- [x] Add a real Chromium test harness capable of exercising ChatPage layout and native scrolling.
- [ ] Reproduce and record the four-message rollback before changing architecture.
- [ ] Add baseline scenarios for restore, streaming, composer resize, plans, search, Spotlight,
  history, editor focus, and long-window measurement.

## Phase 1: Pure ownership model

- [x] Add typed scroll reasons, targets, requests, state, and session epochs.
- [x] Implement the pure scroll state machine.
- [x] Test priority, durable user ownership, explicit navigation, restore cancellation, auto-follow,
  and stale epoch rejection.
- [x] Implement a one-write-per-frame request queue.
- [x] Implement an exclusive operation arbiter with one active owner across frames.
- [x] Test that passive restore/follow/measurement operations cannot alternate viewport writes.

## Phase 2: Session preparation and performance baseline

- [x] Add performance marks for selection, preparation, commit, first message paint, input
  readiness, and secondary state completion.
- [x] Add an immutable prepared-session-view type with stale-epoch rejection.
- [x] Replace visible clear-then-load behavior with one atomic target-session commit.
- [x] Allow message readiness to unblock paint before pending inputs, plans, and metadata.
- [x] Add a bounded renderer-only LRU for recent session views, measurements, and anchors.
- [x] Add cache revision invalidation and memory/count eviction tests.
- [x] Add cold initial load, cached switch, uncached switch, and rapid A/B/C race tests.

## Phase 3: Controller integration on current DOM

- [x] Add `useChatScrollController` around the current viewport.
- [x] Route session restore through the controller.
- [x] Route submit and streaming auto-follow through the controller.
- [x] Route history compensation and measurement anchoring through the controller.
- [x] Route search and Spotlight navigation through the controller.
- [x] Match programmatic scroll events by request ID/expected target instead of time windows.
- [x] Add an architecture guard preventing new direct viewport writes outside the controller.

## Phase 4: Isolated page geometry

- [ ] Add `ChatPageShell.vue` with header, viewport, and composer regions.
- [ ] Add `ChatMessageViewport.vue` as the only chat overflow owner.
- [ ] Add `ChatComposerRegion.vue` without changing child mount lifetimes or public behavior.
- [x] Move search and history status to overlays outside message flow.
- [x] Remove top bar, plan padding, pending lane, status, and composer from message scroll extent.
- [x] Preserve viewport anchors across header/composer ResizeObserver changes by controller mode.

## Phase 5: Feature compatibility

- [ ] Preserve session open/switch bottom behavior and user interruption.
- [ ] Preserve `autoScrollEnabled` semantics.
- [ ] Preserve pending assistant and generating placeholder transitions.
- [ ] Preserve rate-limit, plan, tool interaction, memory, queue, and read-only behavior.
- [ ] Preserve two-page history loading and current cursor/store behavior.
- [ ] Preserve full loaded-message Cmd/Ctrl+F counts and navigation.
- [ ] Preserve Spotlight/trace navigation and highlighting.
- [ ] Contain TipTap scrolling inside the editor/composer region.
- [ ] Preserve capture/export access to all loaded messages.
- [ ] Preserve loaded history/search counts while progressively mounting only bounded heavy rows.
- [ ] Preserve shell, composer, TipTap, and input readiness across session switches.

## Phase 6: Performance and cleanup

- [x] Keep short lists fully rendered with zero measurement scroll writes.
- [x] Keep long-list mounted rows bounded and optimize message entry lookup.
- [x] Batch layout reads, measurements, and one viewport write per frame.
- [x] Remove legacy scroll timers, duplicated booleans, direct-write helpers, and stale comments.
- [ ] Reduce ChatPage to orchestration and extract focused feature composables where ownership is
  clear.
- [ ] Verify no scroll-state CSS mutation causes large repaint or compositor churn.
- [ ] Meet initial shell, cached-switch, and uncached-switch latency budgets on the reference
  machine.
- [ ] Verify recent-session cache memory stays within its configured budget.

## Phase 7: Validation and handoff

- [x] Pass all pure state/controller tests.
- [x] Pass ChatPage and message-window component tests.
- [ ] Pass the real Chromium scroll matrix with anchor drift at or below one pixel.
- [x] Pass the full renderer suite.
- [x] Run format, i18n, lint, Web typecheck, and build.
- [ ] Manually verify trackpad and mouse-wheel behavior on macOS in short and long conversations.
- [ ] Record before/after performance and scroll-write metrics.
- [ ] Record cold first-load, warm cached-switch, uncached-switch, and rapid-switch race metrics.
- [ ] Update the retained chat windowing and issue specifications with final implementation results.

## Phase 8: Review hardening

- [x] Make request queue epoch ordering monotonic and preserve newer pending work on stale takes.
- [x] Expire the immediate-write frame guard at the next frame boundary.
- [x] Preserve user ownership across native layout scrolls and coalesced explicit navigation.
- [x] Gate resize-driven auto-follow on `autoScrollEnabled` without blocking initial restore.
- [x] Keep failed or superseded session preparation behind the safe committed-view boundary.
- [x] Keep touch ownership active through inertial scrolling and arm top pagination without relying
  on a follow-up `scroll` event.
- [x] Persist recent measurement snapshots across the keyed `ChatPage` remount lifecycle.
- [x] Replace timing-only Electron search assertions with observable completion state.
- [x] Add regressions for every review-hardening invariant and rerun the full quality gates.
- [x] Make committed message readiness store-owned and fence same-session refreshes against live
  message mutations.
- [x] Fence stream terminal identity, pending-input writes, history overlap, submit continuations,
  and A-B-A session hydration.
