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

- [x] Update `electron.vite.config.ts`
  - [x] Remove renderer input `shell`
  - [x] Remove renderer input `shellTooltipOverlay`
  - [x] Remove `@shell` alias
- [x] Remove shell append comment in vue devtools config (if any)
- [x] Verify renderer entry set only includes active windows (`index/settings/floating/splash`)

## 2. Remove Shell Directory

- [x] Delete `src/renderer/shell/` directory
  - [x] `src/renderer/shell/App.vue`
  - [x] `src/renderer/shell/main.ts`
  - [x] `src/renderer/shell/stores/tab.ts`
  - [x] `src/renderer/shell/components/**`
  - [x] `src/renderer/shell/tooltip-overlay/**`
- [x] Clean all imports referencing `@shell/*`

## 3. Window Presenter Refactor (Main)

- [x] Refactor `src/main/presenter/windowPresenter/index.ts`
  - [x] Remove tab-oriented shortcut handlers (`CREATE_NEW_TAB`, `CLOSE_CURRENT_TAB`, tab switching)
  - [x] Remove shell chrome IPC handling (`shell:chrome-height`) and tooltip overlay IPC (`shell-tooltip:*`)
  - [x] Keep/create window-only creation APIs (`createChatWindow`, `createSettingsWindow`, `createBrowserWindow`)
- [x] Ensure open/focus logic is by window only

## 4. Session/Thread Binding Migration (Main)

- [x] Refactor `src/main/presenter/sessionPresenter/index.ts`
  - [x] Replace tab-bound active conversation with window-bound mapping
  - [x] Remove `openConversationInNewTab` path, add `openConversationInNewWindow`
  - [x] Remove reliance on `presenter.tabPresenter` in activation/creation flows
- [x] Remove `src/main/presenter/sessionPresenter/tab/tabManager.ts`
- [x] Remove `src/main/presenter/sessionPresenter/tab/tabAdapter.ts`
- [x] Remove `src/main/presenter/sessionPresenter/tab/index.ts`

## 5. TabPresenter Decommission

- [x] Remove or heavily slim `src/main/presenter/tabPresenter.ts`
  - [x] No app-level create/switch/close tab behavior
  - [x] No WebContents->tab mapping maintenance
- [x] Clean TabPresenter registration from presenter bootstrap

## 6. Shared Contract Update

- [x] Update `src/shared/types/presenters/thread.presenter.d.ts`
  - [x] Remove required `tabId` parameters
  - [x] Add/replace with `windowId` semantics
- [x] Update `src/shared/types/presenters/session.presenter.d.ts`
  - [x] Remove tab binding methods (`bindToTab/unbindFromTab/activateSession/getActiveSession`)
  - [x] Add window-based equivalents (if needed)
- [x] Update `src/shared/types/presenters/legacy.presenters.d.ts` to match migration
- [x] Update runtime usage sites in renderer composables/stores accordingly

## 7. Events & Shortcuts Cleanup

- [x] Update `src/main/events.ts`
  - [x] Remove obsolete tab shortcut events
  - [x] Remove obsolete `TAB_EVENTS` items
- [x] Update `src/renderer/src/events.ts`
  - [x] Remove obsolete `TAB_EVENTS` listeners definitions
- [x] Remove dead listeners in renderer (`update-window-tabs`, tab title updates, etc.)

## 8. YoBrowser Single-Window Migration

- [x] Refactor `src/main/presenter/browser/YoBrowserPresenter.ts`
  - [x] Remove internal tab map (`tabIds`, `viewIdToTabId`, `tabIdToBrowserTab`)
  - [x] Keep single active page state in one browser window
  - [x] Replace tab events with page/window events
- [x] Update `src/shared/types/browser.ts`
  - [x] Replace `BrowserTabInfo[]` snapshot with single-page context
- [x] Update `src/renderer/src/stores/yoBrowser.ts`
  - [x] Remove `tabs`, `activeTabId`, `tabCount`, `openTab`
  - [x] Add `currentPage`/`canGoBack`/`canGoForward` style state
- [x] Update workspace browser UI components relying on tab list

## 9. MCP Tools Compatibility

- [x] Update tab-related MCP tools (e.g. `conversationSearchServer`)
  - [x] Replace `create_new_tab` implementation with `create_new_window`
  - [x] Keep backward compatibility alias (optional, with deprecation warning)
- [x] Verify meeting/passthrough flows not relying on tab switching

## 10. Renderer Integration Validation

- [x] Ensure `src/renderer/src/App.vue` works without shell dependencies
- [x] Ensure chat routing still works in window-only runtime
- [x] Ensure settings window open/focus still works
- [x] Ensure floating window logic unaffected

## 11. Cleanup & Verification

- [x] Global cleanup: remove unused imports/types/comments mentioning tab model
- [x] Search and clear residual `tabId` dependencies where they are no longer valid
- [x] Run:
  - [x] `pnpm run format`
  - [x] `pnpm run lint`
  - [x] `pnpm run typecheck`
  - [x] `pnpm run build`

## 12. Acceptance Checks

- [x] App runs without `src/renderer/shell/`
- [x] No in-app tab creation/switching behavior exists
- [x] Conversation activation is window-based
- [x] YoBrowser works as single-window single-view
- [x] No runtime references to removed tab events

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
