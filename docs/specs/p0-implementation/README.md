# P0 Implementation Master Plan

**Date:** 2026-02-28  
**Branch:** `feat/new-arch-complete`  
**Status:** Draft v2 (Scope Aligned Across New-Agent / New-UI / Default-Model Specs)

---

## 1) Goal

This P0 plan defines the **minimum complete refactor slice** to make the new agent architecture the stable mainline for daily chat usage:

1. New UI main flow uses new presenters/stores consistently.
2. Tool permission flow is safe and resumable (no silent auto-run risk).
3. Generation UX is usable (disable/stop/cancel/optimistic/list refresh/cache correctness).
4. Default model behavior is consistent across new-session entry points.

This is the implementation baseline for the larger replacement plan, not final cleanup.

---

## 2) Current Baseline (as of 2026-02-28)

### 已有基础

1. `newAgentPresenter + deepchatAgentPresenter(v3 process loop)` 已存在并可跑通基本消息流。
2. 新 UI 页面与 stores 已接入主路径（`sessionStore/messageStore/agentStore/projectStore`）。
3. P0 的 7 个功能子规格（feature-01 ~ feature-07）文档已拆分完成。

### 仍未闭环的关键缺口（P0 blocker）

1. 新链路缺少完整 permission gating（工具执行前权限门闩、暂停/恢复、remember 白名单）。
2. 会话权限模式未落库（`new_sessions` 无 `permission_mode`）。
3. 新链路 session 状态未覆盖 `paused` 等等待态。
4. 部分 UI 仍依赖旧链路状态源（如 `ChatStatusBar` 读 `useChatStore`，`pageRouter` 读 `sessionPresenter`）。
5. default-model/default-vision-model 方案与 imageServer 全局视觉模型链路尚未纳入本 README 的重构主线。

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

**Last Updated:** 2026-02-28  
**Maintained By:** Development Team  
**Review Status:** Ready for Implementation Breakdown
