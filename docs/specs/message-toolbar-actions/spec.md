# MessageToolbar 功能补齐规格（不含 Trace 落库）

## 概述

本规格定义新架构会话页（`ChatPage + stores/ui/* + agentSessionPresenter`）下的 `MessageToolbar` 功能补齐范围，目标是让按钮行为与产品语义一致，避免“可见但不可用/行为不一致”。

本规格**不包含 Trace 数据落库设计**，Trace 由独立规格处理：`docs/specs/message-trace-storage/`。

## 背景与目标

1. 新 UI 主链路已迁移到 `agentSessionPresenter + agentRuntimePresenter`，但 `MessageToolbar` 仍大量依赖旧 `chatStore/sessionPresenter` 语义。
2. 当前按钮存在“新旧链路行为不一致”与“有 UI 无闭环”的问题。
3. 需要明确分阶段交付：先修前端行为与禁用策略，再补后端消息操作 API。

## 用户故事

### US-1：用户消息可编辑并重生

作为用户，我希望编辑历史用户消息后，系统从该点重建后续回答，保证上下文一致。

### US-2：用户/助手重试一致

作为用户，我希望重试是“截断后重生成”，而不是 variants 或纯追加。

### US-3：删除是可预期的硬删除

作为用户，我希望删除仅影响当前消息本身，界面直接移除，不出现“已删除占位”。

### US-4：分支语义稳定

作为用户，我希望 Fork 从当前 assistant 消息（含本条）切分，并自动切换到新会话继续。

### US-5：运行中安全操作约束

作为用户，我希望生成中只能做安全操作（复制/截图），高风险操作自动禁用，避免状态混乱。

## 功能需求

### A. 架构范围

- [ ] 新会话页链路仅使用 `stores/ui/session.ts`、`stores/ui/message.ts`、`agentSessionPresenter`。
- [ ] 不再依赖旧 `chatStore` 作为新页面消息操作入口。
- [ ] 旧页面链路可保留兼容，但不作为新页面实现基线。

### B. 按钮与行为矩阵

#### 用户消息

- [ ] `copy`：复制当前用户消息文本。
- [ ] `edit/save/cancel`：进入编辑、保存、取消。
- [ ] `retry`：从该用户消息截断后重生成。
- [ ] `delete`：仅删除当前消息（硬删除）。

#### Assistant 消息

- [ ] `copy`：复制 assistant 文本（含既有 CoT 开关策略）。
- [ ] `copy image`：
  - 短按：当前消息组截图。
  - 长按：从顶部到当前消息截图。
- [ ] `retry`：从该 assistant 对应上下文截断后重生成。
- [ ] `fork`：包含当前 assistant 消息并切换到新会话。
- [ ] `delete`：仅删除当前消息（硬删除）。

### C. 语义约束

- [ ] variants 在新架构下线：不显示上一版/下一版按钮，不维护 selectedVariants。
- [ ] 生成中或待交互中，禁用高风险动作：`edit/retry/delete/fork`。
- [ ] 生成中保留低风险动作：`copy/copy image`。

### D. 分阶段交付

- [ ] Phase 1（前端先行）：
  - 补齐新页面 toolbar 事件接线。
  - 做可见性/禁用/降级策略，确保无空操作。
- [ ] Phase 2（前后端闭环）：
  - 新增消息操作 IPC/API（编辑、重试、删除、fork）。
  - 新页面动作切换到新 API。

### E. 验收标准

- [ ] 新页面中不出现 variants UI。
- [ ] 用户编辑保存后，后续消息按规则截断并自动重生成。
- [ ] 用户/助手重试都执行“截断后重生”而非 variants。
- [ ] 删除仅移除当前消息，不保留占位文案。
- [ ] Fork 从当前 assistant（含本条）创建新会话并自动切换。
- [ ] 生成中禁用高风险动作，复制和截图仍可用。

## 非目标

1. 本规格不定义 Trace 数据结构与 provider 采集实现。
2. 本规格不恢复 variants 机制。
3. 本规格不做 Message UI 视觉重设计。

## 约束

1. 维持 Presenter 架构，避免新链路反向依赖旧 `chatStore`。
2. 用户可见文案必须走 i18n。
3. 对话语义修改需保证历史数据兼容（不破坏既有消息读取）。

## 开放问题

无。
