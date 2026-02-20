# Phase 6 Tasks: Shell & Tab Removal (Window-Only)

## Status Legend
- [ ] Not Started
- [~] In Progress
- [x] Completed

## 0. Alignment & Freeze

- [x] Confirm final architecture: window-only, no in-window tabs
- [x] Freeze API direction for `tabId -> windowId` migration
- [x] Add migration note for MCP tools (`create_new_tab` deprecation)

---

## 1. Build & Entry Cleanup

- [ ] Update `electron.vite.config.ts`
  - [ ] Remove renderer input `shell`
  - [ ] Remove renderer input `shellTooltipOverlay`
  - [ ] Remove `@shell` alias
- [ ] Remove shell append comment in vue devtools config (if any)
- [ ] Verify renderer entry set only includes active windows (`index/settings/floating/splash`)

## 2. Remove Shell Directory

- [ ] Delete `src/renderer/shell/` directory
  - [ ] `src/renderer/shell/App.vue`
  - [ ] `src/renderer/shell/main.ts`
  - [ ] `src/renderer/shell/stores/tab.ts`
  - [ ] `src/renderer/shell/components/**`
  - [ ] `src/renderer/shell/tooltip-overlay/**`
- [ ] Clean all imports referencing `@shell/*`

## 3. Window Presenter Refactor (Main)

- [ ] Refactor `src/main/presenter/windowPresenter/index.ts`
  - [ ] Remove tab-oriented shortcut handlers (`CREATE_NEW_TAB`, `CLOSE_CURRENT_TAB`, tab switching)
  - [ ] Remove shell chrome IPC handling (`shell:chrome-height`) and tooltip overlay IPC (`shell-tooltip:*`)
  - [ ] Keep/create window-only creation APIs (`createChatWindow`, `createSettingsWindow`, `createBrowserWindow`)
- [ ] Ensure open/focus logic is by window only

## 4. Session/Thread Binding Migration (Main)

- [ ] Refactor `src/main/presenter/sessionPresenter/index.ts`
  - [ ] Replace tab-bound active conversation with window-bound mapping
  - [ ] Remove `openConversationInNewTab` path, add `openConversationInNewWindow`
  - [ ] Remove reliance on `presenter.tabPresenter` in activation/creation flows
- [ ] Remove `src/main/presenter/sessionPresenter/tab/tabManager.ts`
- [ ] Remove `src/main/presenter/sessionPresenter/tab/tabAdapter.ts`
- [ ] Remove `src/main/presenter/sessionPresenter/tab/index.ts`

## 5. TabPresenter Decommission

- [ ] Remove or heavily slim `src/main/presenter/tabPresenter.ts`
  - [ ] No app-level create/switch/close tab behavior
  - [ ] No WebContents->tab mapping maintenance
- [ ] Clean TabPresenter registration from presenter bootstrap

## 6. Shared Contract Update

- [ ] Update `src/shared/types/presenters/thread.presenter.d.ts`
  - [ ] Remove required `tabId` parameters
  - [ ] Add/replace with `windowId` semantics
- [ ] Update `src/shared/types/presenters/session.presenter.d.ts`
  - [ ] Remove tab binding methods (`bindToTab/unbindFromTab/activateSession/getActiveSession`)
  - [ ] Add window-based equivalents (if needed)
- [ ] Update `src/shared/types/presenters/legacy.presenters.d.ts` to match migration
- [ ] Update runtime usage sites in renderer composables/stores accordingly

## 7. Events & Shortcuts Cleanup

- [ ] Update `src/main/events.ts`
  - [ ] Remove obsolete tab shortcut events
  - [ ] Remove obsolete `TAB_EVENTS` items
- [ ] Update `src/renderer/src/events.ts`
  - [ ] Remove obsolete `TAB_EVENTS` listeners definitions
- [ ] Remove dead listeners in renderer (`update-window-tabs`, tab title updates, etc.)

## 8. YoBrowser Single-Window Migration

- [ ] Refactor `src/main/presenter/browser/YoBrowserPresenter.ts`
  - [ ] Remove internal tab map (`tabIds`, `viewIdToTabId`, `tabIdToBrowserTab`)
  - [ ] Keep single active page state in one browser window
  - [ ] Replace tab events with page/window events
- [ ] Update `src/shared/types/browser.ts`
  - [ ] Replace `BrowserTabInfo[]` snapshot with single-page context
- [ ] Update `src/renderer/src/stores/yoBrowser.ts`
  - [ ] Remove `tabs`, `activeTabId`, `tabCount`, `openTab`
  - [ ] Add `currentPage`/`canGoBack`/`canGoForward` style state
- [ ] Update workspace browser UI components relying on tab list

## 9. MCP Tools Compatibility

- [ ] Update tab-related MCP tools (e.g. `conversationSearchServer`)
  - [ ] Replace `create_new_tab` implementation with `create_new_window`
  - [ ] Keep backward compatibility alias (optional, with deprecation warning)
- [ ] Verify meeting/passthrough flows not relying on tab switching

## 10. Renderer Integration Validation

- [ ] Ensure `src/renderer/src/App.vue` works without shell dependencies
- [ ] Ensure chat routing still works in window-only runtime
- [ ] Ensure settings window open/focus still works
- [ ] Ensure floating window logic unaffected

## 11. Cleanup & Verification

- [ ] Global cleanup: remove unused imports/types/comments mentioning tab model
- [ ] Search and clear residual `tabId` dependencies where they are no longer valid
- [ ] Run:
  - [ ] `pnpm run format`
  - [ ] `pnpm run lint`
  - [ ] `pnpm run typecheck`
  - [ ] `pnpm run build`

## 12. Acceptance Checks

- [ ] App runs without `src/renderer/shell/`
- [ ] No in-app tab creation/switching behavior exists
- [ ] Conversation activation is window-based
- [ ] YoBrowser works as single-window single-view
- [ ] No runtime references to removed tab events

---

## Estimated Effort
- 4-6 days (cross-module migration)

## High Risk Areas
- Session activation and routing consistency
- Shared presenter type breakage between main/renderer
- MCP tool compatibility (tab-centric assumptions)

## Rollback Plan

1. Revert phase6 commit set entirely
2. Restore shell entries in `electron.vite.config.ts`
3. Restore `TabPresenter` + `sessionPresenter/tab/*`
4. Restore shared contract `tabId` signatures
