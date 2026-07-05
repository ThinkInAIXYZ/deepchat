# 修复 F8：关闭路径可观测性与停服超时兜底

## 目标
- 在 `Presenter.destroy()` 增加逐步骤耗时日志，形成关闭长尾定位的最小可观测闭环。
- 为 MCP 关闭链补充 per-server timeout，并明确超时后的清理/强杀策略。
- 在不破坏现有状态管理语义的前提下，收敛 plugin-owned MCP server 的停服耗时。

## 定位
- `requestShutdown()` 只是发起 `BEFORE_QUIT` 阶段并等待 `executeShutdownPhase()` 返回，本身不提供更细粒度的 destroy 观测。[`src/main/presenter/lifecyclePresenter/index.ts#L143`](../../../src/main/presenter/lifecyclePresenter/index.ts#L143)
- `executeHooksByPriority()` 当前按优先级分组、组内并行、组间串行执行 hook，但没有逐 hook duration 统计；它适合作为补充层，不是本次最小闭环的必做层。[`src/main/presenter/lifecyclePresenter/index.ts#L167`](../../../src/main/presenter/lifecyclePresenter/index.ts#L167)
- `before-quit` 拦截进入 `requestShutdown()` 后，真正重型关闭工作最终仍落在 `Presenter.destroy()` 链上，因此 destroy 层日志最关键。[`src/main/presenter/lifecyclePresenter/index.ts#L423`](../../../src/main/presenter/lifecyclePresenter/index.ts#L423)
- `Presenter.destroy()` 目前串行关闭 `pluginPresenter`、`mcpPresenter`、remote control、memory、sqlite、workspace、skill 等步骤，但缺少逐步骤耗时日志。[`src/main/presenter/index.ts#L954`](../../../src/main/presenter/index.ts#L954)
- `PluginHost.shutdown()` 目前串行遍历 plugin-owned server 并逐个 `await this.mcpPresenter.stopServer(serverName)`。[`src/main/presenter/pluginPresenter/index.ts#L132`](../../../src/main/presenter/pluginPresenter/index.ts#L132)
- `McpPresenter.shutdown()` 当前通过 `shutdownPromise` 防重复进入，但内部仍是逐个 server 串行 `await this.stopServer(...)`。[`src/main/presenter/mcpPresenter/index.ts#L227`](../../../src/main/presenter/mcpPresenter/index.ts#L227)
- `McpClient` 只在连接阶段提供超时；关闭阶段 `disconnect()` -> `cleanupResources()` -> `closeTransport()` 没有 timeout 包装。对于 `stdio` transport，会先执行 `terminateProcessTree(child, { graceMs: 2000 })`，随后仍会 `await transport.close()`；若卡在 `transport.close()`，上层仅靠 `Promise.race()` 无法取消底层任务。[`src/main/presenter/mcpPresenter/mcpClient.ts#L467`](../../../src/main/presenter/mcpPresenter/mcpClient.ts#L467) [`src/main/presenter/mcpPresenter/mcpClient.ts#L562`](../../../src/main/presenter/mcpPresenter/mcpClient.ts#L562)
- `serverManager.stopServer()` 只读取 `clients.get(name)`，调用该 client 的 `disconnect()`，然后删除对应 map 项并发事件；未见跨 server 共享的 stop 中间状态或全局串行锁。因此不同 server 的 stop 没有显式共享可变状态，具备改为并发执行的前提。[`src/main/presenter/mcpPresenter/serverManager.ts#L301`](../../../src/main/presenter/mcpPresenter/serverManager.ts#L301)

### 根因
- 关闭路径存在多层串行：hook 阶段完成后仍要进入 `Presenter.destroy()` 串行执行多个子系统关闭，缺少逐步骤耗时日志时，长尾来源不可见。
- plugin-owned MCP server 和 MCP presenter 自身 shutdown 都按 server 串行 stop，server 数量增多时退出耗时线性增长。
- 当前 proposed 的 `Promise.race(stopServer, timeout)` 只能让上层等待超时返回，不能取消底层 `stopServer()`；若底层卡在 `transport.close()`，后台停服任务仍可能继续悬挂。
- 现有强制终止只覆盖 `stdio` 子进程，且发生在 `closeTransport()` 调用 `transport.close()` 之前；对非 `stdio` transport 没有 force-kill 能力，对卡在 `transport.close()` 的场景也没有额外取消机制。

## 修复方案
### 4.1 destroy 层作为必做日志层
- 必做：仅在 `Presenter.destroy()` 内为关键步骤增加 duration 日志，记录开始/结束耗时，形成最小闭环。
- 可选：`executeHooksByPriority()` 额外补逐 hook duration 统计，但不作为本 F8 的必需项，避免方案范围扩大。
- 建议覆盖步骤：
  - `pluginPresenter.shutdown()`
  - `mcpPresenter.shutdown()`
  - `destroyRemoteControl()`
  - `memoryPresenter.dispose()`
  - `sqlitePresenter.close()`
  - `workspacePresenter.destroy()`
  - `skillPresenter.destroy()`

### 4.2 plugin-owned stop 改为受限并发，不直接裸 `Promise.allSettled`
- 已核对 `serverManager.stopServer()`：stop 逻辑按 server 独立处理 `clients` map 项，没有共享全局 stop 状态，因此可安全并发不同 server 的停服调用。[`src/main/presenter/mcpPresenter/serverManager.ts#L301`](../../../src/main/presenter/mcpPresenter/serverManager.ts#L301)
- 仍建议采用受限并发，而不是无限制 `Promise.allSettled()`：
  - 保持对资源争用更温和；
  - 避免大量 plugin-owned server 同时 stop 时集中触发 transport close / 进程终止。
- 建议上限：固定并发 4（常量即可，无需新增配置）。
- 保持失败继续：单个 stop 失败仅记录 warning，不阻断其他 server，也不阻断后续 `unregisterPluginToolPolicies(pluginId)`。

### 4.3 MCP shutdown 增加 per-server timeout，并明确超时后处置
- `McpPresenter.shutdown()` 对每个 `stopServer(serverName)` 包装超时，例如 10s。
- 超时后的策略必须写死并落实：
  - **stdio transport**：在超时分支补一次基于 server/client 上下文的强制终止兜底，调用现有 `terminateProcessTree(..., { graceMs: 2000 })` 路径，确保子进程不会因上层超时返回而长期残留。
  - **非 stdio transport**：无统一 force-kill 能力；只能记录 warning，继续关闭流程，并在日志中明确“后台 stop 可能仍未完成”。
- 这意味着 `Promise.race()` 只负责限制 shutdown 主链等待时间；真正的资源兜底仍要在超时分支显式执行，不能误以为 race 本身具备取消能力。
- 风险声明必须保留：即便 stdio 有补强杀，若底层已卡入不可中断的 `transport.close()` 或第三方 transport 内部 await，非 stdio 仍存在后台残留 stop 的可能。

## 验证
- 代码检查：确认 `Presenter.destroy()` 日志覆盖所有关键步骤，且失败分支也会输出耗时。
- 关闭链检查：配置多个普通 MCP server 与 plugin-owned MCP server，验证 plugin-owned stop 为受限并发、MCP shutdown 为 per-server timeout 后仍能完成退出。
- 超时场景验证：构造卡住的 server stop，确认：
  - stdio server 在超时后不会留下 zombie / 后台子进程；
  - 非 stdio server 会记录 warning，并允许主关闭流程继续。
- 日志验证：确认最少能看到 destroy 层步骤耗时，以及单个 server stop timeout / force-kill / warning 日志。
- 基础校验：按仓库约定执行 `pnpm run format`、`pnpm run i18n`、`pnpm run lint`。

## 风险
- `Promise.race()` 不可取消底层 `stopServer()`；若没有超时后的额外处置，后台停服任务仍可能继续运行，这是本问题的核心残留风险。
- stdio 只能通过已有子进程终止能力兜底，不能保证所有 transport 实现都能被同样强制回收。
- 非 stdio transport 超时后只能 warning + continue，存在资源延迟释放或后台任务未完成的已知风险，需要依赖日志辅助排查。
- 受限并发会改变 stop 的时序，但基于 `serverManager.stopServer()` 当前按 server 独立处理的实现，不应改变最终语义。
