# Main Kernel Refactor Migration Governance

## Purpose

本文件定义 main kernel 重构实施过程中的执行纪律。它解决的不是“技术方案对不对”，而是
“如何避免半新半旧结构长期共存”。

执行目标只有一个：

- 每一轮迁移都让旧路径实质性收缩，而不是在旧路径外再包一层新框架

## Core Risk

最大风险不是实现能力不足，而是阶段边界失控，导致：

- 新架构已经引入
- 旧架构仍在承载主路径
- 临时 bridge 没有删除时点
- PR 持续合入但 legacy 指标不下降

一旦进入这种状态，项目会同时承担两套心智模型，维护成本会比重构前更高。

## Operating Principles

### 1. Single Active Owner

同一条用户路径在任一时刻只能有一个主 owner。

例子：

- “发送消息”主路径只能由 `ChatService` 或旧 runtime 之一承担，不能两边都算主入口
- “设置读写”主路径只能由 `SettingsService` 或旧 presenter 之一承担

旧入口一旦不再是主 owner，就只能做单向转发，不能继续长业务逻辑。

### 2. One-Way Bridge Only

迁移期间允许 bridge，但 bridge 只能是：

```text
old entry -> new implementation
```

禁止：

```text
new service -> old presenter
new route -> old runtime owner
renderer client -> legacy direct IPC
```

也就是说，新架构不能反向依赖旧架构。

### 3. One Phase, One Real Slice

每个 phase 必须包含一个真实用户路径的切换，而不仅仅是基础设施搭建。

一个合格的 phase 至少包含：

- 新边界建立
- 一个真实 slice 切过去
- 删除该 slice 的旧入口或旧 bridge

不合格的 phase 例子：

- 只加 container，不切任何主路径
- 只加 route registry，不迁任何 renderer 调用
- 只加 service，不删除任何旧入口

### 4. Bridge Has Expiration

任何临时 bridge 都必须有明确寿命，默认最多存活 **1 个 phase**。

如果 bridge 在下一个 phase 结束时仍未删除，则：

- 该 bridge 视为超期
- 相关 phase 不能宣告完成
- 后续 PR 需要优先处理 bridge 删除，而不是继续扩展新功能

### 5. Legacy Freeze

某个领域一旦进入迁移阶段，旧实现立即冻结。

冻结含义：

- 旧实现允许修复阻塞性 bug
- 旧实现允许做最小限度转发适配
- 不允许继续增加新业务分支
- 不允许继续扩展新 API
- 不允许继续增加新的事件耦合和 timer 兜底

### 6. Net Reduction Over Net Addition

阶段完成标准必须看 legacy 指标是否净下降，而不是只看“新代码已经存在”。

必须优先观察：

- `usePresenter()` 命中是否下降
- `window.electron` / `window.api` 命中是否下降
- 裸 channel 字符串是否下降
- 裸 timer 是否下降
- 目标领域的 legacy owner/入口是否下降

如果指标没有下降，通常说明只是增加了第二套实现。

## Hard Rules

### Red Lines

以下行为在实施期间视为红线：

1. 在 renderer 新增 `usePresenter()`、`window.electron`、裸 channel 字符串
2. 在 `window.deepchat` 暴露 presenter、repository、sqlite 等内部实现名
3. 让新 `app/service` 反向依赖旧 presenter
4. 在旧 presenter 上继续新增主业务逻辑
5. 让同一条用户路径同时保持新旧双 owner

### Phase Hard Stops

出现以下任一情况时，该 phase 不得标记为完成：

1. 该 phase 对应 slice 没有完成真实切换
2. 该 phase 新增的 bridge 没有登记删除时点
3. 该 phase 结束时 legacy 指标没有实质性下降
4. 该 phase 对应的 smoke 和自动化验证未通过
5. 超过寿命的 bridge 仍然存在

## Bridge Register

所有临时 bridge 必须登记，建议维护在每个阶段 PR 描述或阶段记录中。每条 bridge 至少包含：

| Field | Meaning |
| --- | --- |
| `id` | bridge 唯一标识 |
| `owner` | 负责人 |
| `legacyEntry` | 旧入口 |
| `newTarget` | 新目标 |
| `introducedIn` | 引入 PR / 提交 |
| `deleteByPhase` | 最晚删除阶段 |
| `removalCondition` | 何种条件满足后删除 |
| `notes` | 特殊风险或限制 |

模板：

```md
| id | owner | legacyEntry | newTarget | introducedIn | deleteByPhase | removalCondition | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| settings-presenter-forwarder | @owner | configPresenter.getSetting | SettingsService.get | PR-123 | P3 | settings page and stores fully use SettingsClient | read-only bridge only |
```

## PR Policy

### Allowed PR Types

实施期间只鼓励三类 PR：

1. `guardrail PR`
2. `foundation + immediate slice PR`
3. `slice cutover + legacy cleanup PR`

### Foundation PR Limit

纯基础设施 PR 的连续数量必须受控。

建议规则：

- 最多允许 1 个纯 foundation PR 连续存在
- 下一 PR 必须切一个真实 slice

否则就会出现“框架越搭越多，主路径一条没切”的失控状态。

### PR Must Explain Deletion

除明确的首个 guardrail/foundation PR 外，每个迁移 PR 都必须回答：

- 这次删掉了哪条旧路径？
- 哪个 legacy owner 不再是主 owner？
- 哪条 bridge 被删除了？

如果答案全部是“没有”，通常不应合并。

## Review Checklist

每个迁移 PR 在 review 时至少检查以下问题：

1. 这条用户路径现在谁是唯一 active owner？
2. 新代码是否反向依赖了旧 presenter？
3. 有没有新增临时 bridge？是否写明 `deleteByPhase`？
4. 这次有没有减少 legacy 指标？
5. renderer 是否新增了直接 bridge 细节耦合？
6. `window.deepchat` 是否泄漏了内部实现名？
7. 该 slice 的 smoke 和自动化测试是否覆盖了切换点？

## Migration Scoreboard

每个 phase 结束时都要更新一份 migration scoreboard。推荐至少追踪以下数字：

| Metric | Meaning |
| --- | --- |
| `renderer.usePresenter.count` | renderer 对 presenter 的直接依赖 |
| `renderer.windowElectron.count` | renderer 对旧 Electron bridge 的依赖 |
| `renderer.windowApi.count` | renderer 对旧 preload 多入口的依赖 |
| `ipc.rawChannel.count` | 裸 channel 字符串使用量 |
| `runtime.rawTimer.count` | 裸 `setTimeout` / `setInterval` 使用量 |
| `legacy.owner.count` | 仍承担主路径 owner 的 legacy 模块数 |
| `bridge.active.count` | 当前存活的临时 bridge 数量 |
| `bridge.expired.count` | 已超期未删的 bridge 数量 |

Scoreboard 的目标不是绝对精确，而是持续证明：

- 旧路径在收缩
- 双轨没有扩散
- bridge 没有失控

## Slice Exit Checklist

一个 slice 只有在以下条件同时满足时，才算真正切换完成：

1. renderer 入口已改到 `renderer/api` client
2. main 路由已改到 shared route registry + 新 handler
3. 主业务逻辑由新 service/use case 承担
4. 旧 owner 不再承载主路径
5. 相关 bridge 已删除，或已登记且未超期
6. smoke 测试通过
7. baseline / scoreboard 已更新

## Recommended Cadence

建议执行节奏：

1. 先立 guardrail
2. 每次只迁一个 vertical slice
3. slice 切完立刻删旧入口
4. 每周复盘一次 scoreboard 和 bridge register

不建议的节奏：

1. 同时推进多个高耦合 slice
2. 长时间只搭框架不切路径
3. 把 bridge 删除放到“最后统一收尾”

## Completion Rule

最终完成标准不是“新结构都建好了”，而是：

- 主路径 owner 已切到新架构
- 旧入口不再参与运行时
- bridge register 归零
- scoreboard 显示 legacy 指标持续下降并最终归零或接近归零
