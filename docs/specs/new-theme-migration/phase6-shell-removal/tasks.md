# Phase 6 Tasks: Shell Removal

## Status Legend
- [ ] Not Started
- [~] In Progress
- [x] Completed

## Pre-requisites: 理解现有架构

在开始实现前，确保理解以下现有代码：

- [ ] 阅读 `src/renderer/shell/App.vue` - 理解 Shell 布局和 Tab 管理
- [ ] 阅读 `src/renderer/shell/stores/tabs.ts` - 理解 Tab 状态管理
- [ ] 阅读 `src/renderer/src/stores/workspace.ts` - 理解现有 workspace store
- [ ] 阅读 `src/renderer/src/App.vue` - 理解主应用入口
- [ ] 阅读 `src/renderer/src/router/index.ts` - 理解路由结构
- [ ] 阅读 `src/main/presenter/windowPresenter/index.ts` - 理解窗口加载逻辑

---

## 1. Tab State Integration

- [ ] Update `src/renderer/src/stores/workspace.ts`
  - [ ] Add `tabs` ref
  - [ ] Add `activeTabId` ref
  - [ ] Add `activeTab` computed
  - [ ] Add `createTab()` function
  - [ ] Add `closeTab()` function
  - [ ] Add `activateTab()` function
  - [ ] Add `updateTab()` function
  - [ ] Migrate tab persistence logic (if any)

## 2. Tab Types

- [ ] Create or update `src/shared/types/workspace.ts`
  - [ ] Define `TabType` type
  - [ ] Define `Tab` interface
  - [ ] Define `CreateTabOptions` interface

## 3. App.vue Refactor

- [ ] Update `src/renderer/src/App.vue`
  - [ ] Include WindowSideBar
  - [ ] Include main content area
  - [ ] Optionally include TabBar
  - [ ] Remove shell references

## 4. Router Update

- [ ] Update `src/renderer/src/router/index.ts`
  - [ ] Update route structure
  - [ ] Ensure all views work without shell

## 5. Session-Tab Sync

- [ ] Implement session-tab synchronization
  - [ ] Create tab when session is created
  - [ ] Close tab when session is deleted
  - [ ] Update tab title when session title changes

## 6. Electron Window Config

- [ ] Update `src/main/presenter/windowPresenter/index.ts`
  - [ ] Remove shell load logic
  - [ ] Load renderer directly

## 7. IPC Events Cleanup

- [ ] Update `src/main/events.ts`
  - [ ] Remove shell-specific events
  - [ ] Keep/update tab events if needed

## 8. Build Config

- [ ] Update `electron.vite.config.ts` (if needed)
  - [ ] Remove shell entry point
  - [ ] Update build targets

## 9. Remove Shell Directory

- [ ] Delete `src/renderer/shell/` directory
  - [ ] Verify all needed code is migrated
  - [ ] Delete directory

## 10. Cleanup

- [ ] Remove unused imports
- [ ] Remove unused type definitions
- [ ] Update any remaining shell references
- [ ] Run lint and typecheck

## 11. Testing

- [ ] App loads without shell
- [ ] Sidebar displays correctly
- [ ] Tab creation works
- [ ] Tab switching works
- [ ] Tab closing works
- [ ] Session-tab synchronization
- [ ] Navigation between views
- [ ] Settings opens correctly
- [ ] New thread page works
- [ ] Chat page works
- [ ] Build produces correct output
- [ ] Production build works

---

## Dependencies
- Phase 1-5 all completed

## Estimated Effort
- 2-3 days

## Risk Assessment

### High Risk
- Breaking existing window/tab functionality
- Build configuration issues

### Mitigation
- Test thoroughly before removing shell
- Keep backup of shell code initially
- Incremental migration with tests at each step

## Rollback Plan

1. Restore `shell/` directory from git
2. Revert windowPresenter changes
3. Revert App.vue changes
4. Revert workspace.ts changes
