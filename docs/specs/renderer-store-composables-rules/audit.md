# Renderer Store & Composables Audit

**Status**: Draft  
**Created**: 2026-01-20  
**Owner**: Eric

## 目标
通过“重复性与必要性审计”确定权威入口，合并或移除重复职责，避免并行执行链。

## 审计结论（当前批次）
### 已合并/移除
- `useMessageRetry`（未被引用）已移除，权威入口为 `chatStore.retryFromUserMessage`。

### 已设定权威入口
- 通知：系统通知 -> `useNotificationAdapter.showSystemNotification`；UI Toast -> `useNotificationToasts.showErrorToast`。

### 仍需处理（下一批次）
- `useCleanDialog`：UI 与流程耦合，建议拆为 UI Composable + App Composable。
- `useSearchResultState`：混合 UI 状态与流程编排，建议拆分并明确权威入口。

## 权威入口清单（快照）
- Chat retry: `chatStore.retryFromUserMessage`
- Notifications: `useNotificationAdapter` / `useNotificationToasts`
