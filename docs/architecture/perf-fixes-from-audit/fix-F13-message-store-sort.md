# 修复 F13：message store 排序优化 + cache LRU

## 目标
- 将新增消息的主路径从“push 后全量 `sort`”收敛为“有序时二分插入，乱序时回退全量排序”，降低长会话下 `messageIds` 维护成本。
- 保持 `loadMessages()` 当前的一次性重建模式，不把批量加载退化回逐条 upsert + 重复排序。
- 为 `parsedMessageCache` 增加固定容量 LRU，避免单次超长会话内缓存持续膨胀。
- 将 `assistantBlockPayloadEqual()` 的热路径从多次 `JSON.stringify()` 深比较调整为更轻量、可控的比较方式。

## 定位
- `messageIds` / `messageCache` 定义：[`src/renderer/src/stores/ui/message.ts#L48-L49`](../../../src/renderer/src/stores/ui/message.ts#L48-L49)
- 当前排序逻辑：[`src/renderer/src/stores/ui/message.ts#L71-L94`](../../../src/renderer/src/stores/ui/message.ts#L71-L94)
- `parsedMessageCache` 定义：[`src/renderer/src/stores/ui/message.ts#L55`](../../../src/renderer/src/stores/ui/message.ts#L55)
- `loadMessages()` 一次性重建：[`src/renderer/src/stores/ui/message.ts#L353-L364`](../../../src/renderer/src/stores/ui/message.ts#L353-L364)
- `parsedMessageCache` / streaming 占位清理：[`src/renderer/src/stores/ui/message.ts#L360-L363`](../../../src/renderer/src/stores/ui/message.ts#L360-L363)、[`src/renderer/src/stores/ui/message.ts#L472-L483`](../../../src/renderer/src/stores/ui/message.ts#L472-L483)
- `assistantBlockPayloadEqual()` 的 `JSON.stringify()` 热路径：[`src/renderer/src/stores/ui/message.ts#L128-L175`](../../../src/renderer/src/stores/ui/message.ts#L128-L175)
- 历史页前插：[`src/renderer/src/stores/ui/message.ts#L396-L401`](../../../src/renderer/src/stores/ui/message.ts#L396-L401)
- optimistic 用户消息直接 `push`：[`src/renderer/src/stores/ui/message.ts#L433-L463`](../../../src/renderer/src/stores/ui/message.ts#L433-L463)
- optimistic `orderSeq = messageIds.length + 1`：[`src/renderer/src/stores/ui/message.ts#L443`](../../../src/renderer/src/stores/ui/message.ts#L443)
- streaming 补入新 id：[`src/renderer/src/stores/ui/message.ts#L523-L535`](../../../src/renderer/src/stores/ui/message.ts#L523-L535)
- streaming `orderSeq = messageIds.length + 1`：[`src/renderer/src/stores/ui/message.ts#L526`](../../../src/renderer/src/stores/ui/message.ts#L526)

现状结论：
- `upsertMessageRecord()` 在“新 id”或 `orderSeq` 变化时都会执行 `sortMessageIdsByOrderSeq()`，热点在全量排序，不在 `Map.set()`。
- `loadMessages()` 目前是正确的一次性重建，不是逐条 upsert；这一点应保留。
- `parsedMessageCache` 当前只在 `loadMessages()` 与 `clear()` 时整体清空，能避免跨会话残留，但无法限制单会话长时间增长。
- `messageIds` 的全局有序前提并不天然成立，因为当前代码存在三条会破坏“严格按真实历史序列递增追加”假设的路径：
  1. optimistic 消息直接尾插；
  2. 历史消息分页前插；
  3. streaming 首次落入本地缓存时补入新 id。

## 修复方案

### 3.1 新 id 插入改为“有序检测 + 二分插入 + fallback 排序”
新增消息时不再默认全量 `sort`，而是执行下面的可执行规则：

1. `hasMessageId === true`：
   - 只更新 `messageCache`；
   - 仅当 `cachedRecord.orderSeq !== record.orderSeq` 时，执行一次全量 `sortMessageIdsByOrderSeq()`，因为已有元素的排序键变化会影响全局顺序。
2. `hasMessageId === false`：
   - 若 `record.orderSeq` 不是有限数字，直接 `push` 后 fallback 到 `sortMessageIdsByOrderSeq()`。
   - 若 `record.orderSeq` 是有限数字，先检测当前 `messageIds` 是否“按当前缓存中的 `orderSeq` 非降序排列，且同 `orderSeq` 时按 id 字典序非降序排列”。只有检测通过，才允许二分插入；否则 fallback 到全量 `sortMessageIdsByOrderSeq()`。

建议新增两个帮助函数：

```ts
function compareMessageIds(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function isMessageIdsSortedByOrderSeq(): boolean {
  let previousSeq = Number.NEGATIVE_INFINITY
  let previousId = ''

  for (const id of messageIds.value) {
    const seq = messageCache.value.get(id)?.orderSeq
    if (!Number.isFinite(seq)) return false

    if (seq! < previousSeq) return false
    if (seq === previousSeq && compareMessageIds(previousId, id) > 0) return false

    previousSeq = seq
    previousId = id
  }

  return true
}

function findInsertIndexByOrderSeq(orderSeq: number, id: string): number {
  let left = 0
  let right = messageIds.value.length

  while (left < right) {
    const mid = (left + right) >> 1
    const midId = messageIds.value[mid]
    const midSeq = messageCache.value.get(midId)?.orderSeq ?? Number.MAX_SAFE_INTEGER

    if (midSeq < orderSeq) {
      left = mid + 1
      continue
    }
    if (midSeq > orderSeq) {
      right = mid
      continue
    }

    if (compareMessageIds(midId, id) <= 0) {
      left = mid + 1
    } else {
      right = mid
    }
  }

  return left
}
```

插入规则：
- `messageCache.value.set(record.id, record)` 之后，若 `isMessageIdsSortedByOrderSeq()` 为真，则用 `findInsertIndexByOrderSeq()` + `splice()`；
- 若检测失败，则先 `push()`，再执行一次 `sortMessageIdsByOrderSeq()` 进行纠偏。

这样把“能二分”的前提写成了代码层面的显式条件，而不是依赖隐含假设。

### 3.2 保持 `loadMessages()` 一次性重建
[`loadMessages()`](../../../src/renderer/src/stores/ui/message.ts#L353-L364) 现在是：
- 遍历 `restored.messages` 构建 `nextMessageCache`；
- 同步构建 `nextMessageIds`；
- 最后一次性替换 `messageCache.value` 与 `messageIds.value`。

这已经符合 F13 对“批量加载不要逐条 upsert”的要求，应明确保留，不做回退。若未来有人想复用 `upsertMessageRecord()` 重写该逻辑，文档应禁止这种回归，要求批量路径继续维持“一次性收集、一次性赋值、至多一次排序”。

### 3.3 `parsedMessageCache` 改为固定容量 LRU
将 `parsedMessageCache` 从无界 `Map` 改为固定容量 LRU，阈值明确设为 **1024**。

选择 1024 的依据：
- 当前消息窗口默认加载量是 100，恢复窗口会按需扩展，但单次活动会话常见规模通常落在数百条到约千条；
- 1024 足以覆盖典型长会话中“当前窗口 + 最近滚动/重解析热点”的命中需求；
- 同时又能把缓存上限控制在稳定、可预测的数量级，避免单会话持续增长。

建议规则：
- 常量：`const PARSED_MESSAGE_CACHE_MAX_SIZE = 1024`
- 命中缓存时，删除旧 key 后重新 `set()`，刷新最近使用顺序；
- 写入新条目后，若 `size > 1024`，删除 `Map.keys().next().value` 对应的最旧 key；
- `loadMessages()`、`clear()`、会话切换相关重建仍保留整表清空。

### 3.4 block payload 比较降温
[`assistantBlockPayloadEqual()`](../../../src/renderer/src/stores/ui/message.ts#L128-L175) 当前对 `extra`、`tool_call`、`artifact`、`image_data`、`reasoning_time` 都走 `JSON.stringify()`。该逻辑应改为：
- 优先比较影响 UI 的稳定字段；
- 仅在确实需要比较复杂对象且无法拆字段时，才考虑预计算 hash；
- 不在热路径里反复序列化整个 payload。

## 验证
除现有回归外，需新增三类顺序专项验证，证明“二分插入”和当前几条特殊路径可以共存：

1. **optimistic 路径回归**
   - 先插入若干已持久化消息；
   - 调用 `addOptimisticUserMessage()` 产生 `orderSeq = messageIds.length + 1` 的本地消息；
   - 再插入/加载真实历史消息，验证：
     - 若当前 `messageIds` 仍满足排序检测，则新增消息走二分插入；
     - 若 optimistic 记录导致全局顺序前提不可信，则命中 fallback，全量排序后顺序正确。

2. **历史前插回归**
   - 构造 `loadOlderMessages()` 前插旧页的场景；
   - 在前插后继续插入新消息，验证排序检测不会错误假设数组始终可二分；
   - 确认 fallback 后最终顺序与 `sortMessageIdsByOrderSeq()` 一致。

3. **streaming 补 id 回归**
   - 构造 `applyStreamingBlocksToMessage()` 首次为 assistant 消息补 id 的场景；
   - 其初始 `orderSeq` 同样来自 `messageIds.length + 1`；
   - 验证后续真实消息到达、`loadMessages()` 重建或 `orderSeq` 校正时，不会因为此前二分插入假设而破坏顺序。

此外补充：
- `parsedMessageCache` 的 LRU 淘汰测试；
- `assistantBlockPayloadEqual()` 轻量比较的等价性测试；
- 基础质量检查仍应覆盖 `pnpm run format`、`pnpm run i18n`、`pnpm run lint`，必要时加 `pnpm run typecheck`。

## 风险
- **核心风险必须明确**：[`addOptimisticUserMessage()`](../../../src/renderer/src/stores/ui/message.ts#L443) 与 [`applyStreamingBlocksToMessage()`](../../../src/renderer/src/stores/ui/message.ts#L526) 都用 `messageIds.value.length + 1` 生成 `orderSeq`。这个值只代表“当前内存数组长度上的尾序号”，**不等价于真实历史消息序列**。因此二分插入不能把它当作稳定的全局顺序来源；这正是“插入前先检测有序性、失败就 fallback 排序”的核心原因。
- `loadOlderMessages()` 的前插会让数组结构发生非尾部变动；若后续逻辑偷懒假设“列表只会 append”，二分插入就会失效。
- `upsertMessageRecord()` 即使改成二分插入，`messageIds.includes()` 仍是 O(n) 判重；但这不阻塞 F13，因为当前最大热点仍是全量排序。
- LRU 阈值若后续实测过小，可能增加重复解析；但固定上限优先级高于无限增长，可在实测后调参。
- block payload 若浅比较字段选取不全，可能导致错误复用，需要专项测试兜底。
