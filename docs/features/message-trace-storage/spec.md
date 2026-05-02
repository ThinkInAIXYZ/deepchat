# Message Trace 独立落库规格

## 概述

新增 Message Trace 独立存储链路：

1. 不再使用“从历史消息反推请求”的 trace 方式。
2. 改为在各 provider 发起真实请求前，直接采集最终请求数据（endpoint/headers/body）。
3. trace 按消息维度持久化，消息上 `Trace` 按钮仅在存在 trace 数据时展示。

## 背景与目标

1. 旧 preview 逻辑基于历史重建，可能与实际提交给服务端的数据不一致。
2. 需要可审计、可复现的真实请求快照，同时满足安全脱敏要求。
3. 需要把 Trace 与 MessageToolbar 主功能拆开，独立迭代、独立上线。

## 用户故事

### US-1：真实请求可追踪

作为开发/调试用户，我希望看到真正发往 provider 的请求内容，而不是推断结果。

### US-2：消息级 Trace 可见性

作为用户，我希望只有有 trace 的消息显示 Trace 按钮，避免空弹窗。

### US-3：安全可用

作为用户，我希望 trace 可调试但不泄露密钥，token 需做 mask。

## 功能需求

### A. 采集时机与来源

- [ ] 采集点位于 provider 内部“最终请求参数已构建、实际发请求之前”。
- [ ] 仅当 `traceDebugEnabled = true` 时采集并落库。
- [ ] 每次真实请求都记录一条 trace（同一消息可多条）。

### B. 数据模型

- [ ] 新增 `deepchat_message_traces`（独立表）。
- [ ] 一条 assistant 消息允许多条 trace，按 `request_seq` 递增。
- [ ] 存储字段至少包含：
  - `message_id`
  - `session_id`
  - `provider_id`
  - `model_id`
  - `request_seq`
  - `endpoint`
  - `headers_json`
  - `body_json`
  - `truncated`
  - `created_at`

### C. 脱敏与体积控制

- [ ] 仅存脱敏结果，不落明文敏感值。
- [ ] token/key 掩码策略：保留尾部 4 位（其余掩码）。
- [ ] 单条 trace 上限 512KB；超出截断并写 `truncated = true`。

### D. 查询与展示

- [ ] 新接口支持按 `messageId` 查询 trace 列表（按 `request_seq DESC`）。
- [ ] 消息列表返回 `traceCount`（或等价可判断字段）。
- [ ] Toolbar 显示规则：`traceDebugEnabled && traceCount > 0`。
- [ ] TraceDialog 默认展示最新 trace，并支持切换历史 trace。

### E. 生命周期

- [ ] 删除消息时级联删除对应 trace。
- [ ] 删除会话时级联删除该会话 trace。
- [ ] 不做历史数据回填，仅覆盖新请求。

### F. 验收标准

- [ ] 同一消息多轮请求可看到多条 trace 记录。
- [ ] Trace 内容与真实请求参数一致（不依赖历史重建）。
- [ ] 数据库存储中不存在明文 API Key/Token。
- [ ] 大 payload 被截断并带 `truncated=true`。
- [ ] 无 trace 的消息不显示 Trace 按钮。

## 非目标

1. 不回填旧历史消息 trace。
2. 不提供 trace 导出/分享能力。
3. 不改动非 trace 场景的 MessageToolbar 交互。

## 约束

1. 保持现有 Presenter + SQLite 架构。
2. 采集必须是 provider 内真实请求路径，不使用“重建推断”。
3. 性能优先：trace 关闭时不引入额外重型逻辑。

## 开放问题

无。
