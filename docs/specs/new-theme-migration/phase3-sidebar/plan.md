# Phase 3 Plan: WindowSideBar Refactor

## Status: ✅ Completed

## Summary

Phase 3 重构了 WindowSideBar 组件，实现了：
1. Agent 列表显示真实数据
2. Session 列表显示真实数据
3. Session 分组逻辑（按项目/按时间）
4. Agent/Session 数据源绑定

## Implementation Details

### Files Created
- `src/renderer/src/stores/agent.ts` - Agent 状态管理
- `src/renderer/src/composables/useSessionList.ts` - Session 列表逻辑

### Files Modified
- `src/renderer/src/components/WindowSideBar.vue` - 使用真实数据
- `src/renderer/src/i18n/*/common.json` - 添加 sidebar i18n keys

## Completed Tasks

- [x] 创建 useAgentStore
- [x] 创建 useSessionList composable
- [x] 更新 WindowSideBar.vue 使用真实数据
- [x] Agent 选择联动 Session 列表
- [x] Session 分组 (project/time)
- [x] 添加 i18n keys

## Remaining Tasks

- [ ] 测试用例编写
