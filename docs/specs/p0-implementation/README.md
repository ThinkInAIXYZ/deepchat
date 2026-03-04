# P0 Implementation Master Plan

**Date:** 2026-03-04  
**Branch:** `feat/new-arch-complete`  
**Status:** In Progress (Synced with current codebase state on 2026-03-04)

---

## 1) Goal

This P0 plan defines the **minimum complete refactor slice** to make the new agent architecture the stable mainline for daily chat usage:

1. New UI main flow uses new presenters/stores consistently.
2. Tool permission flow is safe and resumable (no silent auto-run risk).
3. Generation UX is usable (disable/stop/cancel/optimistic/list refresh/cache correctness).
4. Default model behavior is consistent across new-session entry points.

This is the implementation baseline for the larger replacement plan, not final cleanup.

---

## 2) Current Snapshot (as of 2026-03-04)

### 2.1 Feature-01 ~ Feature-07 Progress Matrix

| Feature | Current State | Notes |
|---|---|---|
| feature-01-generating-session-ids | 🟡 Partial | Generation state is tracked via `session status + messageStore.isStreaming`, not via a dedicated `generatingSessionIds` Set. |
| feature-02-input-disable-stop | ✅ Functional Complete (Implementation differs) | Input disable and stop button are closed in `ChatPage + ChatInputBox + ChatInputToolbar`; no standalone `StopButton.vue`. |
| feature-03-cancel-generating | 🟡 Partial | Cancel flow and abort controller are live; aborted message currently lands as error-style stream termination, not explicit `cancelled` status model. |
| feature-04-permission-approval | 🟡 Partial | Approval/deny + resume loop are live; remember-decision persistence and strict full-access boundary closure are still not fully closed in this P0 spec line. |
| feature-05-session-list-refresh | ✅ Mostly Complete | `SESSION_EVENTS.LIST_UPDATED` is primary and cross-window refresh works; compatibility listener retained, but old-link fallback still exists in `pageRouter`. |
| feature-06-optimistic-messages | 🟡 Partial | Optimistic user message insertion is live; temp-id → backend-id merge contract is not fully implemented (currently refresh-based reconciliation). |
| feature-07-cache-versioning | ⚪ Not Started | No explicit cache version bump/invalidation scheme per this feature spec yet. |

### 2.2 Additional Progress Already Landed (outside feature-01~07 docs)

1. Chat top bar Share/More menus are now functional in new architecture.
2. Session actions from top bar are live: pin/unpin, rename, clear messages, delete.
3. Session export from top bar is live: markdown/html/txt/nowledge-mem(json download only).
4. Sidebar now supports pinned sessions in a no-title top area outside normal groups.

### 2.3 Historical Baseline Notes (kept for context)

### 已有基础

1. `newAgentPresenter + deepchatAgentPresenter(v3 process loop)` 已存在并可跑通基本消息流。
2. 新 UI 页面与 stores 已接入主路径（`sessionStore/messageStore/agentStore/projectStore`）。
3. P0 的 7 个功能子规格（feature-01 ~ feature-07）文档已拆分完成。

### 仍未闭环的关键缺口（P0 blockers, refreshed）

1. `new_sessions` 仍无 `permission_mode` 字段（仅 `deepchat_sessions.permission_mode` 已存在）。
2. 新链路会话状态仍未对外覆盖 `paused / waiting_permission`（当前 `SessionStatus` 仍是 `idle/generating/error`）。
3. 权限流 remember 决策持久化与 full-access 工作区边界约束仍需按 P0 标准补齐。
4. `pageRouter` 仍保留 legacy `sessionPresenter` fallback；`ChatStatusBar` 仍有旧 `chatStore` 依赖。
5. optimistic merge 协议（temp id → real id）与 cache versioning 仍未完全落地。

---

## 3) P0 Scope (Must Have)

### A. Permission & Safety Closure (Highest Priority)

来源：
- [feature-04-permission-approval](./feature-04-permission-approval/)
- [agentpresenter-mvp-replacement/spec.md](../agentpresenter-mvp-replacement/spec.md)
- [permission-flow-stabilization/spec.md](../permission-flow-stabilization/spec.md)

必须完成：

1. `new_sessions` 增加 `permission_mode`（`default | full`）。
2. `deepchatAgentPresenter` 工具执行前权限检查，未批准必须暂停，不得直接执行。
3. 支持 message 级恢复幂等（resume lock），避免重复恢复/重复 loop。
4. 恢复继续生成前，工具结果与 permission block 必须先落库可见（避免重复 tool_use）。
5. 增加 `handlePermissionResponse` 新链路 IPC（approve/deny/remember）。
6. Full access 必须受 `projectDir` 边界约束。

### B. Generation UX Baseline

来源：
- [feature-01-generating-session-ids](./feature-01-generating-session-ids/)
- [feature-02-input-disable-stop](./feature-02-input-disable-stop/)
- [feature-03-cancel-generating](./feature-03-cancel-generating/)
- [feature-06-optimistic-messages](./feature-06-optimistic-messages/)

必须完成：

1. 输入禁用与 stop 按钮在新 UI 主路径闭环。
2. cancel 行为保持“保留部分内容 + 可继续后续对话”。
3. 生成态追踪与 session status 对齐（避免双状态源冲突）。
4. optimistic message 与最终落库消息可正确合并。

### C. Session/List/Event Consistency

来源：
- [feature-05-session-list-refresh](./feature-05-session-list-refresh/)
- [new-ui-page-state/spec.md](../new-ui-page-state/spec.md)
- [new-ui-session-store/spec.md](../new-ui-session-store/spec.md)

必须完成：

1. 会话列表刷新以 `SESSION_EVENTS` 为主（保留兼容监听但明确退场计划）。
2. `pageRouter` 活跃会话查询切到新链路（`newAgentPresenter`）。
3. session 状态映射覆盖等待态（至少 `paused`）。

### D. Cache/Performance Correctness

来源：
- [feature-07-cache-versioning](./feature-07-cache-versioning/)
- [permission-flow-stabilization/spec.md](../permission-flow-stabilization/spec.md)

必须完成：

1. message cache 版本控制与失效策略落地。
2. 流式 flush 策略在“权限恢复后继续生成”场景无可见性竞态。

### E. Default Model Settings Integration

来源：
- [default-model-settings/spec.md](../default-model-settings/spec.md)
- [default-model-settings/plan.md](../default-model-settings/plan.md)

必须完成：

1. `defaultModel` 作为新建会话默认模型规则的统一入口（非 ACP）。
2. `defaultVisionModel` 仅允许 vision 模型。
3. `imageServer` 移除 args 模型依赖，统一读取全局 `defaultVisionModel`。

---

## 4) Execution Order (Dependency Driven)

### Phase 0: Contract Freeze

1. 冻结新链路事件契约（`SESSION_EVENTS`/`STREAM_EVENTS` payload）与状态枚举。
2. 明确 permission batch + resume lock + flush-before-continue 的统一约束。

### Phase 1: Permission Core (A)

1. DB 字段与运行时状态扩展（`permission_mode`、`paused`）。
2. 后端 permission check / pause / resume / remember 全链路打通。
3. 前端权限响应入口接入新 presenter。

### Phase 2: Generation UX (B)

1. 输入禁用、stop、cancel、optimistic 在新页面闭环验证。
2. 补齐失败与中断路径（END/ERROR/CANCEL）一致性。

### Phase 3: Session/Event Alignment (C)

1. `pageRouter` 与 session activation 全部切到新链路。
2. 列表刷新/状态更新跨窗口一致性验证。

### Phase 4: Cache & Flush Safety (D)

1. cache versioning 落地。
2. 权限恢复后续跑场景做可见性回归测试。

### Phase 5: Default Model / Vision (E)

1. default model & vision model 完整接入。
2. imageServer 模型来源统一。

---

## 5) Explicitly Out of P0

以下内容不纳入本轮 P0，放入后续阶段：

1. 全量移除 chat mode 与搜索系统（见 [remove-chat-mode/spec.md](../remove-chat-mode/spec.md)）。
2. edit/retry/regenerate/fork 的完整产品化能力（见 [agentpresenter-mvp-replacement/spec.md](../agentpresenter-mvp-replacement/spec.md)）。
3. 大规模旧数据迁移脚本（先保证双链路兼容可运行）。

---

## 6) Quality Gates (Release Blockers)

P0 完成前必须全部满足：

1. `pnpm run format`
2. `pnpm run lint`
3. `pnpm run typecheck`
4. 新链路权限流集成测试（approve/deny/remember/full-access-boundary）
5. 新链路生成流集成测试（send/stop/cancel/error/retry-send）
6. 跨窗口 session 刷新与激活一致性测试
7. 旧链路回归冒烟（避免一次性回归爆炸）

---

## 7) Source of Truth

1. [P0 design decisions](../../../P0_DESIGN_DECISIONS.md)
2. [Architecture overview](../../ARCHITECTURE.md)
3. [new-agent/spec.md](../new-agent/spec.md)
4. [new-agent/v3-spec.md](../new-agent/v3-spec.md)
5. [new-ui-implementation/todo.md](../new-ui-implementation/todo.md)
6. [default-model-settings/spec.md](../default-model-settings/spec.md)
7. [agentpresenter-mvp-replacement/gap-analysis.md](../agentpresenter-mvp-replacement/gap-analysis.md)

---

**Last Updated:** 2026-03-04  
**Maintained By:** Development Team  
**Review Status:** Active Implementation Sync
