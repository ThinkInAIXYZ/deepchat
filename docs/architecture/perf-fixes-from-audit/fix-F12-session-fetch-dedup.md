# 修复 F12：sessionStore.fetchSessions 首屏请求去重

## 目标
在不改变现有启动调用点的前提下，消除 `App.vue` 与 `ChatTabView.vue` 对 `sessionStore.fetchSessions()` 的并发首屏请求竞态，避免重复触发 IPC `listLightweight`；同时明确去重守卫只覆盖首屏 `fetchSessions()`，不包裹 `loadSessionPage()`，以免误伤 `reset:false` 的分页加载路径。

## 定位
- 启动主调用：[`src/renderer/src/App.vue#L525-L530`](../../../src/renderer/src/App.vue#L525-L530)
  - `onMounted` 中直接调用 `void sessionStore.fetchSessions()`。
- 启动关键 store 初始化：[`src/renderer/src/lib/storeInitializer.ts#L22-L25`](../../../src/renderer/src/lib/storeInitializer.ts#L22-L25)
  - `initAppStores()` 只并行初始化 `uiSettingsStore` 与 `providerStore`，不负责 session 首屏加载，因此不会替代 App 层调用。
- 兜底调用：[`src/renderer/src/views/ChatTabView.vue#L112-L116`](../../../src/renderer/src/views/ChatTabView.vue#L112-L116)
  - `finally` 中如果 `!sessionStore.hasLoadedInitialPage`，会再次 `void sessionStore.fetchSessions()`。
- session store 现状：[`src/renderer/src/stores/ui/session.ts#L276-L288`](../../../src/renderer/src/stores/ui/session.ts#L276-L288)、[`src/renderer/src/stores/ui/session.ts#L508-L549`](../../../src/renderer/src/stores/ui/session.ts#L508-L549)、[`src/renderer/src/stores/ui/session.ts#L587-L592`](../../../src/renderer/src/stores/ui/session.ts#L587-L592)
  - `initialPageRequestId` 仅用于丢弃过期 `reset:true` 结果。
  - `loading` / `hasLoadedInitialPage` 仅表示状态，不阻止新的首屏请求进入。
  - `fetchSessions()` 只是薄包装，直接调用 `loadSessionPage({ reset: true, ... })`，自身没有 in-flight 守卫。
- IPC 触发点：[`src/renderer/src/stores/ui/session.ts#L520-L527`](../../../src/renderer/src/stores/ui/session.ts#L520-L527)
  - 真正的重复成本发生在 `sessionClient.listLightweight(...)` 被并发执行。

结论：当前问题是 **`fetchSessions()` 缺少首屏 in-flight 去重**，而不是 `loadSessionPage()` 的通用并发模型有问题。`loadSessionPage(reset:false)` 还承担分页职责，不能被一个全局守卫一并串行化。

## 修复方案
1. **守卫仅加在 `fetchSessions()` 顶层**
   - 增加模块内 `sessionFetchPromise: Promise<void> | null`。
   - 当 `fetchSessions()` 发现已有 in-flight promise 时，直接返回同一个 promise。
   - 只把 `loadSessionPage({ reset: true, ... })` 包进该守卫，避免影响 `loadNextPage()` → `loadSessionPage({ reset:false })` 的翻页行为。
2. **`finally` 采用 `currentFetchPromise` 比对后清理**
   - 不能用“只要 `sessionFetchPromise` 非空就置空”的写法；那样在极端竞态下，旧请求 `finally` 可能误清新请求。
   - 应保存当前 promise 局部引用，并在 `finally` 中仅当 `sessionFetchPromise === currentFetchPromise` 时再清空。
3. **保留现有双调用，根治放在 store 层**
   - `App.vue` 继续作为主启动方发起首屏加载。
   - `ChatTabView.vue` 继续保留 `!hasLoadedInitialPage` 的兜底调用，覆盖主路径未来回归或初始化时序变化。
   - 两个调用点都走 `fetchSessions()`，由 store 统一去重。
4. **显式刷新语义边界要在文档中写清**
   - 如果已有首屏 `fetchSessions()` 在飞，后续再次调用 `fetchSessions()`，即便调用方主观上希望“强制 refresh”，也会被复用同一个 in-flight promise。
   - 推荐把这种去重语义限定为“首屏启动去重”：显式 refresh 若需要真正重新拉取，应走独立路径，直接调用 `loadSessionPage({ reset: true })`（或未来抽出专门 refresh API），而不是复用 `fetchSessions()`。

建议代码片段：

```ts
let sessionFetchPromise: Promise<void> | null = null

async function fetchSessions(): Promise<void> {
  if (sessionFetchPromise) {
    return sessionFetchPromise
  }

  const currentFetchPromise = (async () => {
    await loadSessionPage({
      reset: true,
      prioritizeSessionId: activeSessionId.value ?? bootstrapActiveSession.value?.id ?? null
    })
  })()

  sessionFetchPromise = currentFetchPromise

  try {
    await currentFetchPromise
  } finally {
    if (sessionFetchPromise === currentFetchPromise) {
      sessionFetchPromise = null
    }
  }
}
```

## 步骤拆分
1. 在 [`src/renderer/src/stores/ui/session.ts`](../../../src/renderer/src/stores/ui/session.ts) 中新增 `sessionFetchPromise` 状态。
2. 仅改造 `fetchSessions()` 为首屏 in-flight 去重包装器，保持 `loadSessionPage()` 的 `reset:true`/`reset:false` 分支结构不变。
3. 不调整 [`src/renderer/src/App.vue`](../../../src/renderer/src/App.vue) 与 [`src/renderer/src/views/ChatTabView.vue`](../../../src/renderer/src/views/ChatTabView.vue) 的现有调用点，继续采用“双调用 + store 去重”的启动策略。
4. 若后续实现显式“刷新会话列表”入口，要求该入口不要复用 `fetchSessions()` 语义，而应显式走 `loadSessionPage({ reset: true })` 或独立 refresh API。

## 验证
- **单元测试为主，spy/mock 为准**
  - 在 `test/renderer` 的 session store 测试中 mock `sessionClient.listLightweight`。
  - 并发触发两次 `fetchSessions()`，断言：
    1. `listLightweight` 只被调用一次；
    2. 两次调用拿到同一个完成结果；
    3. promise 完成后再次调用 `fetchSessions()` 会触发第二次真实请求。
- **边界测试**
  - 断言 `loadNextPage()` / `loadSessionPage({ reset:false })` 不受 `sessionFetchPromise` 影响，分页路径仍可独立执行。
  - 如实现显式 refresh API，补测它不会被首屏去重吞掉。
- **回归验证**
  - 可补充启动链路用例确认 `App.vue` 与 `ChatTabView.vue` 双调用共存时，首屏仍能正常加载。
  - console/trace 可作为人工辅助，但**不应**作为“只请求一次”的主验证依据，因为当前代码没有稳定的 `listLightweight` 次数日志，spy/mock 更可靠。

## 风险
- **显式刷新被去重吞掉的语义边界**：如果未来有人把 `fetchSessions()` 当成“总是强制刷新”，该语义会与首屏去重冲突。本文推荐将 `fetchSessions()` 明确定义为“首屏加载入口”，显式 refresh 走独立 API。
- **promise 生命周期管理**：若未采用 `currentFetchPromise` 比对清理，而是简单地在 `finally` 中清空共享变量，理论上可能误清后续新请求。
- **`hasLoadedInitialPage` 不是请求锁**：它仍然只是结果态标记；在请求尚未完成前，`ChatTabView` 的兜底分支仍可能进入 `fetchSessions()`，因此真正的去重必须由 promise 守卫承担。
- **代码行号可能随主线漂移**：本文引用基于当前核对版本，后续若上游再改动需重新对齐行号，但不影响方案本身。