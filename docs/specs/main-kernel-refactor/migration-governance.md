# Main Kernel Refactor Migration Governance

## Purpose

本文件定义本轮“边界稳定化”实施纪律。

它解决的不是“方案是否足够理想”，而是：

- 如何避免一边加新层，一边让旧耦合继续长大
- 如何确保每一轮迁移都真的减少复杂度

## Core Risk

最大风险不是技术写不出来，而是出现下面这种失控状态：

- 新 contract、新 client、新 service 都建了
- 旧 presenter 仍在承载同一条主路径
- bridge 没写删除时点
- 基线数字没有下降

一旦如此，项目就会同时承担两套心智模型，维护成本比现在更高。

## Operating Principles

### 1. Single Active Owner

同一条用户路径在任一时刻只能有一个主 owner。

例子：

- settings 主读写只能由新 typed boundary 或旧 presenter 之一承载
- send / stop / restore 这类 chat/session 主链路不能同时由新 orchestration 和旧 presenter 都算主入口

### 2. One-Way Bridge Only

迁移期间允许 bridge，但 bridge 只能是：

```text
old entry -> new implementation
```

禁止：

```text
new client -> legacy direct IPC
new service -> old presenter
new typed route -> presenter reflection dispatcher
```

### 3. Boundary Before Expansion

本轮新增功能如果涉及 renderer-main 能力，必须先进入 typed boundary。

不允许一边写“未来会迁移”，一边继续新增 `usePresenter()` 或 raw IPC。

### 4. One Real Slice Per Phase

每个 phase 都必须切一个真实 slice。

不合格的 phase 例子：

- 只建 route registry，不迁任何页面或 store
- 只建 service，不替换任何主路径 owner
- 只加 helper，不删任何旧桥接

### 5. Legacy Freeze For Migrated Slices

某个 slice 一旦进入迁移阶段，旧实现立即冻结。

冻结含义：

- 可以修阻塞性 bug
- 可以做最小限度转发
- 不允许继续长新主逻辑
- 不允许继续扩张 API surface

### 6. Net Reduction Over Net Addition

阶段是否完成，要看 legacy 指标是否净下降。

至少观察：

- `renderer.usePresenter.count`
- `renderer.windowElectron.count`
- `renderer.windowApi.count`
- hot path direct dependency 数量
- `bridge.active.count`

如果这些数字没有下降，通常说明只是多加了一层新实现。

## Hard Rules

### Red Lines

以下行为在本轮实施期间视为红线：

1. 在 renderer 新增 `usePresenter()`
2. 在 renderer 新增 `window.electron.ipcRenderer.*`
3. 在 migrated path 新增 raw channel 字符串
4. 新 orchestration 反向依赖旧 presenter
5. 同一条用户路径长期保持双 owner

### Phase Hard Stops

出现以下任一情况时，该 phase 不得标记为完成：

1. 该 phase 没切真实 slice
2. 新增 bridge 没写 `deleteByPhase`
3. smoke 或自动化验证未通过
4. legacy 指标没有下降或明显反弹
5. 超期 bridge 仍存在

## Bridge Register

所有临时 bridge 都必须登记。每条 bridge 至少包含：

| Field | Meaning |
| --- | --- |
| `id` | bridge 唯一标识 |
| `owner` | 负责人 |
| `legacyEntry` | 旧入口 |
| `newTarget` | 新目标 |
| `introducedIn` | 引入 PR / 提交 |
| `deleteByPhase` | 最晚删除阶段 |
| `notes` | 限制和风险 |

默认规则：

- bridge 最多存活 1 个 phase
- bridge 只允许单向转发
- bridge 不承载新增业务逻辑

## PR Policy

实施期间优先允许三类 PR：

1. `guardrail PR`
2. `boundary foundation + immediate slice PR`
3. `slice cutover + legacy cleanup PR`

每个 PR 应明确回答：

- 这次切的是哪条真实路径？
- 谁是新的 active owner？
- 删掉了什么旧入口或旧桥接？

如果答案全部是“没有”，通常不应合并。

## Review Checklist

每个迁移 PR 至少检查以下问题：

1. 这条路径现在谁是唯一 active owner？
2. renderer 是否仍直接感知 presenter 或 raw IPC？
3. 新代码是否反向依赖旧 presenter？
4. 有没有新增 bridge？是否写明 `deleteByPhase`？
5. 这次是否真的降低了 hot path 耦合？
6. cleanup / cancel / timeout 的 owner 是否清楚？
7. 对应测试和 smoke 是否覆盖了切换点？

## Migration Scoreboard

每个 phase 结束时至少追踪：

| Metric | Meaning |
| --- | --- |
| `renderer.usePresenter.count` | renderer 直接依赖 presenter 的数量 |
| `renderer.windowElectron.count` | renderer 对旧 Electron bridge 的依赖 |
| `renderer.windowApi.count` | renderer 对旧 preload 多入口的依赖 |
| `hotpath.presenterEdge.count` | hot path presenter 直接依赖数量 |
| `runtime.rawTimer.count` | raw timer 数量 |
| `bridge.active.count` | 当前存活 bridge 数量 |
| `bridge.expired.count` | 已超期未删 bridge 数量 |

Scoreboard 目标不是绝对精确，而是持续证明：

- 旧耦合在收缩
- 双轨没有扩散
- bridge 没有失控

## Completion Rule

本轮完成标准不是“新框架搭好了”，而是：

- migrated path 的 owner 已切清楚
- renderer 边界稳定了
- hot path 耦合净下降
- bridge register 对本轮范围归零
