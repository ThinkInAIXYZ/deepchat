# 实施计划

## Slice 1：会话与 deeplink 的并发边界

### 新会话提交

`NewThreadPage` 将持有单个 `isSubmitting` ref，并从 `onSubmit`、`onCommandSubmit` 进入统一 guarded submit 路径。锁从文件准备前开始，到 `submitText` 成功且页面状态清理完成后释放；异常仅记录并释放锁，不清除用户草稿。ACP 既有会话的 `sendMessage` 与普通 `createSession` 使用同一互斥语义。

发送 UI 同时接收锁状态，避免按钮表现为可点击但 handler 静默返回。

### Session 更新

- `refreshSessionsByIds` 为每个 refresh invocation 分配递增 revision，并将其登记到每个请求的 session ID。旧请求只会丢弃已被更新请求覆盖的 ID；不同 ID 的并发结果可各自合并。全量 `sessionListEpoch` 仍使旧定向响应整体失效，过期行不能更新 sessions、active shell 或 error。
- 首屏请求记录发起时的定向提交 revision；若定向行在首屏等待期间先提交，首屏替换列表时保留这些具有明确因果新鲜度的行，其他旧列表行仍按首屏快照替换。
- 定向刷新仅在它仍拥有至少一个 session ID 时清除或写入它自己标记的 refresh error；不覆盖首屏或分页错误。
- `mergeSessions` 保留已知 session 的较新 `updatedAt`；相同 timestamp 缺少跨窗口因果顺序，也不得由延迟响应覆盖已渲染状态。
- `sessionIpc` 按目标 webContents id 缓存 identity 未就绪时的最新定向 activation/deactivation 事件；`session` store 在取得本窗口 id 后仅处理本窗口事件，其他窗口事件不能覆盖它。非定向 list/update 不受影响。

### Start deeplink

`applyStartDeeplink` 接收并守卫 payload token。在 `await currentDraftDefaultsTask`、`nextTick`、`ensureEnabledModelsReady` 之后确认 draft store 当前 token 仍相同；仅在仍当前时写 message/system prompt/model，且只清除相同 token 的 pending payload。ChatMain 的 start deeplink 激活流程也在每个 async 边界后确认 token，旧 payload 不得再路由、选择 agent 或关闭 session。当前 main 固定关闭的 `autoSend` 保持不消费。

## Slice 2：流式列表和搜索

### 行级流式状态

ChatPage 计算当前 stream message id，MessageList 按 `item.id` 生成 `isStreamingMessage`。MessageListRow / MessageItemAssistant 接收该行状态，保留 prop 默认兼容。会话是否仍在生成的全局状态继续保留给页面 shell、composer/stop action 等真正需要的消费者。

### 搜索

使用 VueUse 防抖的 canonical query 作为 expensive match collection / highlight 的输入。关闭时立即清空 search result 和 highlight。结果索引使用与 display model 相同的可渲染 block 投影，避免计数包含永远不会挂载的内容；DOM 高亮器刻意忽略的按钮文本和默认 `aria-hidden` 的 tool-call 详情不进入索引。结果导航使用已提交的查询，必要时在等待中禁用导航或保持最后稳定结果，避免旧结果与新 query 混用。MutationObserver 只聚合受影响行并按 rAF 刷新，明确抑制自身的高亮 DOM mutation。

不在本 slice 更改 markdown virtualization 语义，除非 review 证明它能以小范围改动保留现有匹配和跳转正确性。

### 历史加载状态

将 message store 的历史加载结果升级为受判别状态的返回值或 state，调用方据此区分 loaded/exhausted/error。失败状态在 ChatPage 顶部使用已有 shadcn button 和 i18n 文案提供 retry；成功及 exhausted 不造成额外打扰。

## Slice 3：多窗口 appearance foundation

在 `src/renderer/src/foundation/appearance/` 放置只依赖浏览器/Vue 基础能力的纯 helper 或 composable：应用 theme class、font class、document lang/dir，并对短暂主题切换禁用 transition。数据读取和 renderer-specific listener 仍留在各 app，由 app 将解析后的 appearance state 传入 foundation helper。

chat main 迁移现有 `syncAppearanceClasses`；settings/floating 仅复用适用部分，保持各自 preload API 和 listener 生命周期。settings 的 persisted language 异步读取用 watcher cleanup 防止已失效的读取覆盖新语言事件。不能令 foundation import Pinia、feature、chat store 或 API client。

`ChatTabView` 已迁入 `apps/chat-main/`，router 保持按需加载该 route host，启动职责与路由契约不变。

## Slice 4：相邻 renderer 状态机收敛

### 项目环境重排

`projectStore.reorderEnvironments` 使用 renderer 内递增 revision 保护乐观排序，并同时记录共享 environment snapshot revision。并发的旧请求仍向它的调用方报错，但不得在后到 reorder、archive、restore、remove 或 IPC refresh 已经开始或完成后回滚 environments，避免拖拽和其他环境操作相互覆盖。

### 流式虚拟窗口

后续 `renderer-state-ownership-hardening` 切片将移除稳定前缀 + append-only tail contract。虚拟化始终由完整 display list 建立 geometry 并截取可见窗口；保留 display-message 转换缓存、pending/renderKey handoff、测量 cache 与逻辑锚定，确保公共的无闪烁和长历史 windowing 合同不变。tail 替换同时回收已离开 tail 的估高 cache。

### 可见 user text 与测试收尾

`features/chat-page/model/displayUserMessageText.ts` 与 `displayMessage.ts` 同属 chat display model：它将 rich content、mention label 和无 rich content 时按 offset 插入的 inline skill/file 投影为渲染 body 实际显示的 blocks/text。`MessageItemUser`、`MessageContent`、折叠度量与 `chatSearch` 只使用此投影；rich content 覆盖 raw text 和 inline metadata。standalone file/skill metadata 保持在 body 外，并显式标记为不可被 DOM 高亮器索引；高亮器在真实 message row 中也只遍历 `[data-message-content]`，避免 message chrome 增加不可导航匹配。

该阶段曾以稳定前缀和 streaming tail identity 覆盖 fast path；后续 `renderer-state-ownership-hardening` 已删除这条私有路径和 profile，改以 pending/renderKey handoff、完整 display-list、虚拟窗口和阅读锚定等公共行为测试覆盖。

MarkdownRenderer mock 测试删除 Markstream tuning profile 和 app-level stream/final handoff 的快照细节，只保留 DeepChat 的 worker、artifact、语言、link/reference/unmount 边界与 `final=false`/`codeBlockStream=true` streaming smoke。

## Slice 5：循环 review 与可证据化收尾

每完成一个 slice：

1. 审查变更 diff、依赖方向、用户路径与异步状态机。
2. 修复 review 明确发现的问题。
3. 再次搜索 renderer 中相邻 owner 是否存在同类可安全收敛点。
4. 仅当没有高/中风险、低回归风险的剩余优化，进入最终验证。

最终统一执行：

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run test:renderer
pnpm run architecture:renderer-baseline:check
```

根据改动覆盖补充或运行直接 renderer suite。确认 git diff、测试与质量门禁后，创建 `--base dev` 的 PR。

## 回滚

所有改动均是 renderer 内部状态边界和展示优化：不涉及 IPC 或数据迁移。可以按 slice 反向恢复，且用户已有 session、配置和消息不需要迁移。
