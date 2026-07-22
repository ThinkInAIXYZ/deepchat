# 实施计划

## 1. 建立单一流式节拍 owner

`MarkdownRenderer` 保留非流式 fast/slow debounce，但为 chat streaming 增加同步旁路：

```text
content update
  -> streaming now or streaming just ended?
       yes -> invalidate older debounce revision and commit immediately
       no  -> keep existing 32/96 ms static debounce
  -> NodeRenderer
  -> Markstream smooth stream / parse scheduler
```

监听 source 同时包含 `content` 与 `isStreaming`。完成态转换必须根据 previous streaming state
同步提交，以覆盖父组件同一次 patch 中 content/status 一起改变的情况。旧 timer 继续用 revision
guard no-op，不新增 timer cleanup 或第二份派生状态。

## 2. 解耦 node virtualization 与重节点优先级

保留两类派生值：

- `shouldVirtualizeNodes = virtualizeNodes && !isStreaming`：只决定 Markdown node DOM window；
- `shouldUseViewportPriority = virtualizeNodes`：继续决定 heavy node 是否接近视口后才启动。

保持 `codeRenderer="monaco"` 贯穿同一个 `NodeRenderer`，不要以 phase key 重建它。当前 Markstream 将
该兼容名称映射到由 `stream-diffs` 支持的 `CodeBlockNode`：流式期间它保留自身的 `<pre>` fallback，代码块
完成且可见后再把同一宿主原子升级为单一 File/FileDiff surface。`deferNodesUntilVisible` 与
`viewportPriority` 继续使用第二个值，保留既有 Mermaid/KaTeX 等重节点的调度策略。搜索/截图传入
`virtualizeNodes=false` 时，所有内容仍立即可用。

`MessageBlockContent` 只在搜索、截图等完整 DOM 消费者出现时传 `virtualizeNodes=false`。streaming 的
node window 仍由 `MarkdownRenderer` 内部的 `virtualizeNodes && !isStreaming` 负责关闭。

chat streaming 的 typewriter 使用 `simple` 模式。它保留尾部 CSS 光标和 smooth streaming 的 auto
eligibility，但不使用 precise 模式每次提交的 Range/getClientRects 光标定位。

## 3. 使用 Markstream 内建 code renderer

- 增加 `stream-diffs` direct dependency，使 Markstream 的动态 runtime import 可解析；
- live chat 与 completed/static 均显式传 `codeRenderer="monaco"`；live 传 `codeBlockStream=true`，完成时传 false 并同步更新 `final=true`。不重建 NodeRenderer，也不直接调用 `stream-diffs`；
- 删除 generic `code_block` custom mapping，恢复 `CodeBlockNode` 的内建 `<pre>` fallback 与增强 surface handoff；
- 通过 `codeBlockProps` 传 themes 和工具栏选项，通过 `codeBlockMonacoOptions` 传字体/换行，通过 `@handle-artifact-click` 接收预览；
- 保留 Mermaid strict props、`break-words` prose root 和可收缩的 flex host，但不覆盖 `stream-diffs` gutter/content 内部几何。

## 4. 消息顺序与流式窗口

后续 `renderer-state-ownership-hardening` 已移除 stable/tail layout 快路径。`useDisplayMessages`
始终按 `messageIds` 产生完整顺序的 display list，未变化记录通过转换缓存复用；`useMessageWindow`
据此建立 geometry，虚拟窗口限制实际挂载的行数。本地 optimistic user 和首次 stream placeholder 的
`orderSeq` 使用当前缓存最大有限值加一，而不是 `messageIds.length + 1`。这样只加载长会话尾页时，
新消息仍保持真实尾序，不会因一次全量排序被移到历史前方。该扫描只发生在本地消息首次插入，不在
token snapshot 热路径。

## 5. 缩短 full snapshot 的 renderer 热路径

- stream store 使用 shallow ref，因为每个 snapshot 都是整数组替换，内部没有嵌套 mutation contract；
- `applyStreamingBlocksToMessage` 在写入 JSON record 的同时，用同一份已校验 blocks 预填 parsed cache；
- stable block identity 继续通过 `reuseStableAssistantBlocks` 复用，metadata cache 在内容更新时保留。

main 的 JSON normalization + Zod clone 继续保留，因为真实 `extra` payload 含有 undefined 值，直接
schema parse 会改变兼容语义甚至拒绝 snapshot。preload 与 renderer event contract 校验也继续保留。
full snapshot transport 仍会随累计长度重复校验和跨进程复制；delta protocol 需要独立设计和
profile，不在本次变更中暗改。

## 6. 移除 custom registry 热路径

MarkdownRenderer 改用 NodeRenderer 内建 link/reference/Mermaid 组件：

- `mermaidProps.isStrict=true` 保持安全模式；
- 根级 click 委托识别 anchor，继续调用 `navigateLink`；
- 根级 mouse/click 委托识别 `.reference-node`，继续加载搜索结果与显示引用浮层；
- code preview 通过公开 `@handle-artifact-click` event 处理。

因此不再调用 `setCustomComponents/removeCustomComponents`，同消息多个 text part 不会互相覆盖，
Markstream 也可以启用 append-only parse 和 stable top-level node reuse。`customId` 仍包含实例 token，
用于隔离 NodeRenderer 自身的虚拟化/测量 identity。

## 7. 与 PR #2000 的边界

不改变 `useMessageWindow` 或 `useMessageVirtualization` 的 contract。本次补齐
`useDisplayMessages` 对真实尾部 inline stream 的分类，并保证 tail 到 Markstream 的交接不再重复
pacing、重复 JSON parse 或因 registry 关闭增量节点复用。

完成态继续依赖现有 message id / renderKey handoff：

```text
pending placeholder -> real stream message -> persisted final message
       same outer row identity      same MarkdownRenderer instance
```

## 8. 测试策略

- MarkdownRenderer component test：
  - 后续 streaming snapshot 同步转交，不只覆盖首 chunk；
  - final transition 同步带上最终 content，且旧 timer 不能回写；
  - streaming 到 final 始终选择同一个 enhanced renderer，并把 `codeBlockStream` 从 true 切到 false；
  - explicit `virtualizeNodes=false` 同时关闭三类延迟；
  - `stream-diffs` handoff、无 generic override、preview 和 Mermaid strict 保持。
- useDisplayMessages：
  - 尾部 inline stream 返回 segments，连续 snapshot 保持 stable identity；
  - 中间位置 inline stream 返回 null，完整消息顺序不变。
- message/echo：
  - schema parse 保持深拷贝；
  - snapshot blocks 预填 parsed cache，并保持 settled block identity。
- 复跑 MessageBlockContent、MessageList、MessageItemAssistant、useDisplayMessages、
  useMessageWindow、useMessageVirtualization 和 ChatPage 相关 suite。
- 执行 typecheck 与 production renderer build，验证 Markstream optional peer 的真实解析路径。

## 9. 验证命令

```bash
pnpm exec vitest --config vitest.config.renderer.ts test/renderer/components/MarkdownRenderer.test.ts test/renderer/components/message/MessageBlockContent.test.ts
pnpm exec vitest --config vitest.config.renderer.ts test/renderer/components/MessageList.test.ts test/renderer/components/message/MessageItemAssistant.test.ts test/renderer/composables/useMessageWindow.test.ts test/renderer/composables/useMessageVirtualization.test.ts
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run test:renderer
pnpm run build
```

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| final 与 content 同 patch 时顺序不确定 | 同时 watch 两个 source，并用 previous streaming 状态同步提交 |
| streaming heavy node 延迟后高度变化影响滚动 | 使用 Markstream 自带 lifecycle/ResizeObserver，外层继续按 PR #2000 批量测量 |
| 搜索或截图拿不到离屏 DOM | `virtualizeNodes=false` 同时关闭 node window 与 viewport deferral |
| stream-diffs optional peer 缺失 | direct dependency + Markstream 内建 pre fallback + production build 验证 |
| 旧静态 debounce 晚到覆盖 stream | 每次同步旁路递增同一个 revision，使旧 callback no-op |
| 事件委托误拦截普通节点 | 只处理 closest anchor / `.reference-node`，其他 click/mouse event 原样忽略 |
| 中间 stream 被错误追加到尾部 | 仅以排序后的 `messageIds` 最后一个 id 精确匹配，其他情况返回 null |
