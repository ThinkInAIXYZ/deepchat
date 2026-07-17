# Agent Browser Surfaces and Picture-in-Picture Tasks

## Status

Planning only. No implementation task is approved or started.

## Completed Discovery

- [x] Trace current YoBrowser page, native view, CDP, overlay, panel, and session lifecycles.
- [x] Identify the unconditional Agent `browser.open.requested` panel-opening behavior.
- [x] Confirm the current model is one page per session with no user/Agent ownership.
- [x] Locate stable `LoopRun.runId` ownership and the missing tool-context propagation.
- [x] Verify Electron View/WebContentsView reparenting and child-window platform constraints.
- [x] Define the single-parent invariant, eligibility predicate, interaction matrix, and failure
      behavior.
- [x] Diagnose the current 420-520 px panel constraints, fixed Browser toolbar, native viewport
      behavior, and stale hard-coded Chromium user-agent version.
- [x] Write the proposal, implementation plan, feasibility assessment, and acceptance criteria.

## Product Decisions Required Before Implementation

- [x] Automatically switch an already open Workspace surface to Browser for each new Agent browser
      action, without pinning Browser afterward.
- [ ] Confirm PiP **Close** dismisses only the current run and never closes the Agent tab.
- [ ] Confirm one primary Agent tab is retained per session and reused across loops.
- [ ] Confirm PiP remains eligible while the run waits for permission or a question.
- [x] Use a compact Agent-browser activity strip instead of a webpage below the usable PiP size.
- [ ] Confirm Responsive default, explicit Fit desktop, and Browser Expand as the page-adaptation
      model.
- [x] Confirm undersized chats use a compact Agent activity strip instead of an unusable page card.
- [ ] Supply the referenced screenshot or approve a visual baseline for radius, shadow, toolbar,
      sizing, and placement.

## Phase 1: Run Identity and Workspace Foundation

- [ ] Add `runId` to internal tool execution options.
- [ ] Thread `runId` through immediate, batch, resumed, and deferred tool paths.
- [ ] Pass `runId` through `AgentToolManager` into `YoBrowserToolHandler`.
- [ ] Add an idempotent browser run-finalization port for every terminal outcome.
- [ ] Replace per-session single-page state with workspace/tab state.
- [ ] Add explicit user/Agent tab ownership and last-touched run identity.
- [ ] Reuse one primary Agent tab per session and define popup inheritance.
- [ ] Expand shared browser status/events/routes for tabs and placement.
- [ ] Add pure and runtime tests for ownership, run transitions, and finalization.

## Phase 2: Placement Ownership and Panel Tabs

- [ ] Add a versioned renderer layout report for conversation and panel bounds.
- [ ] Validate layout sender, host window, and active session in main.
- [ ] Add one serialized placement controller per workspace.
- [ ] Enforce panel/PiP/detached single-parent invariants.
- [ ] Remove direct competing attach/detach ownership from `BrowserPanel.vue`.
- [ ] Add browser tab create/select/close operations.
- [ ] Add a compact panel tab strip and Agent marker using existing UI primitives.
- [ ] Add container-responsive wide, compact, and narrow Browser chrome.
- [ ] Keep the address bar usable and every hidden command keyboard-accessible at 420 px.
- [ ] Generalize the existing Workspace fullscreen shell behavior into Browser Expand/Restore.
- [ ] Derive the YoBrowser desktop user-agent Chromium version from the runtime.
- [ ] Route user navigation to user tabs and Agent tools to the Agent tab.
- [ ] Stop destroying a completed Agent page merely because the session becomes inactive.
- [ ] Remove the compatibility single-page status/routes after all callers migrate.
- [ ] Add main/renderer tests for tab and placement races.

## Phase 3: Page Presentation, PiP Surface, and Interaction

- [ ] Build representative responsive/fixed-width website fixtures.
- [ ] Compare device emulation and controlled zoom for per-tab Fit desktop.
- [ ] Verify user input, CDP input, DOM, screenshot, iframe, fixed/sticky, and reset coordinates.
- [ ] Ship Fit desktop only if one path passes the complete coordinate proof.
- [ ] Add per-tab Responsive/Fit presentation state without restart persistence.
- [ ] Add a lazy in-window Electron View PiP container.
- [ ] Add trusted local chrome with isolated preload and narrow IPC.
- [ ] Render sanitized host/title, Agent activity, **Open in panel**, and **Close**.
- [ ] Implement the complete eligibility predicate.
- [ ] Remove the unconditional Agent-triggered `sidepanelStore.openBrowser()` behavior.
- [ ] Implement default responsive bounds and small-region fallback.
- [ ] Implement compact Agent activity-strip fallback below usable page size.
- [ ] Implement pointer drag, throttling, main-process clamping, and resize re-clamping.
- [ ] Implement current-run dismissal without tab/tool interruption.
- [ ] Implement stable-bounds panel handoff with no reload or duplicate display.
- [ ] Move Agent page to PiP when Browser surface hides during an eligible run.
- [ ] Integrate activity overlay bounds for panel and PiP.
- [ ] Add accessible labels, focus behavior, and i18n strings.
- [ ] Add interaction and security tests for every command.

## Phase 4: Lifecycle and Cross-Platform Validation

- [ ] Test loop complete, fail, abort, supersede, and teardown cleanup.
- [ ] Test permission/question pause behavior.
- [ ] Test session switch, route change, multi-window activation, and stale events.
- [ ] Test focus/blur, show/hide, minimize/restore, resize, maximize, and display scale.
- [ ] Test tab close and page/chrome/host crash recovery.
- [ ] Test concurrent user commands and Agent tool activity.
- [ ] Test page input, chat focus, native z-order, and activity overlay on macOS.
- [ ] Test Browser chrome at every container breakpoint and at non-integer display scales.
- [ ] Test Responsive, Fit desktop if approved, Expand, and Restore without page reload/state loss.
- [ ] Repeat packaged focus/z-order/drag tests on Windows and Linux.
- [ ] Verify the exact page WebContents/CDP identity survives every placement move.
- [ ] Verify no inactive-session content appears, including transient frames.
- [ ] Profile retained Agent-tab memory before considering eviction.
- [ ] Run `pnpm run format`.
- [ ] Run `pnpm run i18n`.
- [ ] Run `pnpm run lint`.
- [ ] Run typecheck and focused main/renderer test suites.
- [ ] Capture BEFORE/AFTER screenshots or GIFs and include the ASCII layouts in the PR.

## Deferred Work

- [ ] Persist PiP position/size only if users demonstrate a need.
- [ ] Add a measured idle Agent-tab eviction policy only if memory profiling requires it.
- [ ] Add keyboard PiP movement if accessibility review requires it.
- [ ] Generalize Agent tools to explicit tab IDs only when multi-tab automation is requested.
- [ ] Share architecture with standalone browser windows only after a separate convergence design.
