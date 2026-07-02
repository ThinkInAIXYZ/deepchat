# Harness Reliability Issues 1841-1849 — Plan

## Renderer Working Brief

Target
- User-visible behavior: long chats/search/remote settings stay responsive; tests reflect current UI.
- Current rendering component: `ChatPage` -> `MessageList` -> `MessageListRow`.
- Logical owner: `ChatPage` owns scroll/search window coordination; `MessageList` renders rows.
- Route/layout/shell owner: chat route scroll container and settings route remote page.
- Trigger path: message load/stream/search, remote status timers, backup/sync actions.
- Existing similar implementation: `useMessageWindow`, chat scroll anchor logic, DeepChat events.

Context Map
- Vue owner chain: `ChatPage` composes `MessageList`; settings `RemoteSettings` owns channel controls.
- DOM/render chain: scroll container -> search root -> row DOM with `data-message-id`.
- State source: message store, local chat search refs, remote IPC client, sync presenter.
- Derived state: display messages, message layout entries, search results, remote status summaries.
- Events: scroll/wheel/key, backup events, remote status refresh timers.
- Side effects: DOM search highlight mutation, IPC calls, filesystem archive reads/writes.
- Styling/layout constraints: sticky search/input, variable message heights, preserved scroll anchors.
- Performance-sensitive areas: message rows, markdown blocks, streaming, search, remote polling, zip.
- Accessibility concerns: search keyboard behavior and visible controls stay unchanged.
- Electron boundary: remote and sync calls cross renderer/preload/main; backup work stays in main.
- Existing project patterns: Composition API, typed clients, DeepChat event catalog, presenter methods.

Diagnosis
- Root cause: multiple hot paths scale with total history or block the main process; tests drifted.
- Correct ownership layer: fix tests in test owners, chat windowing/search in `ChatPage`, heavy zip in
  `SyncPresenter`, remote polling at renderer owners.
- Affected consumers: chat page, search bar, sidebar remote status, settings remote page, cloud sync.
- Constraints: no broad virtual scroller, no IPC contract churn, no new dependencies.
- Existing pattern to reuse: `useMessageWindow`, existing DeepChat backup status events, route tests.

Decision
- Selected approach: bounded message window with spacers, data-driven search match list, async
  `fflate` zip/unzip wrappers, timer gates/backoff, contract test updates.
- Files to edit: chat page/list/search utilities/tests, sync presenter/tests, remote components,
  route/settings tests, SDD docs.
- State impact: local scroll/search state only; no persisted schema changes.
- DOM/layout impact: `MessageList` receives visible rows and spacer heights.
- Render/update impact: mounted message rows are bounded; highlight DOM mutation is visible-window only.
- IPC/main-process impact: fewer remote IPC loops; backup compression/extraction no longer uses sync
  `zipSync`/`unzipSync`.
- Verification plan: targeted Vitest first, then format/i18n/lint and broader tests if time permits.

## Implementation Slices

1. Fix known test drift and replace the misleading perf test.
2. Bound chat row rendering with the existing message layout model.
3. Scope chat search highlighting to rendered rows while keeping full loaded-message match counts.
4. Convert sync backup archive creation/extraction to async zip/unzip and async file IO.
5. Gate remote polling by visibility/enabled state and add simple backoff.
6. Record #1848's state-map/design-freeze step instead of mixing a large refactor into this fix.

## Compatibility

- Message store and IPC payloads are unchanged.
- Backup file format and manifest remain unchanged.
- Search UI API remains `activeMatch` and `totalMatches`.
- Remote status display still uses the same status payload types.

## Test Strategy

- Main: deeplink/settings navigation/sync presenter tests.
- Renderer: ChatPage, MessageList, chat search utility, remote settings, model provider settings.
- Performance: report-only production-path tests using generated realistic message fixtures.
- Required project checks: `pnpm run format`, `pnpm run i18n`, `pnpm run lint`.
