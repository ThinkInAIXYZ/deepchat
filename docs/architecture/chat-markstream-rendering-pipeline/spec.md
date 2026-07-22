# Chat 与 Markstream 流式渲染管线

## 背景

PR #2000 已把高频流式消息从稳定历史列表中拆出，并为消息窗口增加 append-only tail
快路径、批量测量和显式行级 streaming 状态。与此同时，聊天正文仍经过 DeepChat 自己的
内容防抖，再交给当前 `markstream-vue@1.0.7-beta.4` 的 smooth streaming、解析合并、节点批量挂载和重节点延迟机制。增强代码块使用其 `stream-diffs@0.0.2` peer。

当前端到端链路如下：

```text
provider token events
  -> main accumulator
  -> echo renderer throttle (120 ms, full block snapshot)
  -> chat.stream.updated typed event
  -> messageIpc request/session ordering gate
  -> stream store + folded message record
  -> stable display history + active streaming tail
  -> outer message window / scroll arbitration
  -> MessageBlockContent ant-tag projection
  -> MarkdownRenderer stream handoff
  -> Markstream smooth streaming (up to 20 commits/s)
  -> incremental Markdown parse + node batching
  -> Monaco / Mermaid / KaTeX viewport deferral
  -> DOM measurement -> outer message window / scroll follow
```

主进程的 120 ms 合帧控制跨进程吞吐，Markstream 的 smooth streaming 控制用户实际看到的
文本节奏，PR #2000 的消息窗口控制历史行重算和滚动。集成层不应再成为第三个流式节拍 owner。

## 问题

1. 聊天流内容在进入 Markstream 前再经过 32 ms 或 96 ms 防抖。它不能减少 main snapshot
   数量，却增加首段之外每个 snapshot 的延迟，并可能让 `final` 先于最新防抖内容生效。
2. 旧集成曾把 `codeRenderer="monaco"` 误当作流式期间即时创建 Monaco 的开关，并因此尝试在
   应用层把 renderer 从 `pre` 重建为 `monaco`。当前 Markstream 的该兼容名称实际选择由
   `stream-diffs` 驱动的增强 `CodeBlockNode`：它在 block streaming 时保留内建 `<pre>`，仅在
   block 完成且可见后才升级同一宿主。因此外部 remount 会破坏受支持的 handoff，并可能造成完成闪烁或瞬时几何。
3. generic `code_block` 自定义映射会绕过 Markstream 内建的 renderer selection、异步 fallback 和
   viewport-deferred `stream-diffs` 路径。仅安装 optional peer 或直接导入其 controller 都不能替代该路径。
4. 该阶段曾为尾部 inline stream 引入 stable/tail layout segments；后续
   `renderer-state-ownership-hardening` 已移除这条私有路径，统一以完整 display-list 建立消息 geometry。
5. 每个累计 snapshot 在 main 中先 JSON round-trip 再 Zod clone，renderer 写入消息后又立即把
   同一份 blocks JSON.parse 回来；长回复会放大全量 snapshot 协议本身的 O(L^2) 累计成本。
6. 每个 MarkdownRenderer 通过全局 custom component registry 注册纯渲染 wrapper。同一消息被
   artifact 分段时 registry id 冲突，且任意非空 custom map 都会让 Markstream 禁用稳定顶层节点复用。
7. `codeBlockStream=false` 在 loading code node 上显示 skeleton，而不是实时代码；它不负责选择
   Monaco。对于聊天流，轻量 `<pre>` 比 skeleton 更连续，enhanced runtime 仍应等节点闭合且可见。
8. 外层消息窗口与 Markstream 内层节点窗口职责相邻。两者必须各自只处理自己的粒度：外层按
   message 行裁剪，内层按 Markdown node 裁剪，搜索/截图需要完整 DOM 时同时显式退出延迟行为。

## 目标

1. 让 main 进程负责 snapshot 合帧，Markstream 负责文本 pacing；聊天集成层同步转交流式内容。
2. 从 streaming 到 final 的同一消息、MarkdownRenderer、NodeRenderer 与内建 CodeBlockNode 都保持身份稳定；最终内容不会被旧的防抖回调覆盖。
3. 整个生命周期保持 Markstream `codeRenderer="monaco"`，并仅以 `codeBlockStream` / `final` 表达流式状态；内建 `CodeBlockNode` 在 streaming 时呈现 `<pre>`，完成且可见后才挂载 `stream-diffs` 表面。内层 node virtualization 继续在 streaming 阶段关闭，避免 typewriter 尾部被节点窗口裁掉。
4. completed 历史消息继续使用 Markstream node virtualization 及可见性延迟；聊天搜索、截图和其他要求
   完整 DOM 的路径仍可通过 `virtualizeNodes=false` 同时关闭虚拟化与视口延迟。
5. ordinary fenced code 使用 Markstream 内建 `stream-diffs` 路径；streaming 时先显示轻量 fallback，
   final 且接近视口后再加载 enhanced File/FileDiff surface。Mermaid 保持 strict 处理。
6. 保留非流式、可高频编辑的 docs/artifact surface 的现有内容防抖，避免把聊天优化扩散到不同
   交互语义的页面。
7. inline stream 与其他消息统一由完整 display-list 驱动；未变化记录仍复用 display-message
   转换缓存，虚拟窗口负责限制已挂载的行数。
8. 复用已通过 IPC schema 校验的 blocks，减少 renderer 内部重复 JSON parse，同时不削弱
   main/preload/renderer 边界校验，也不改变持久化 JSON 格式。
9. 使用 Markstream 内建 link/reference/Mermaid 节点和 renderer 级事件委托，避免全局 registry
   写入及其 parser reuse 失效；链接导航、搜索引用预览和 strict Mermaid 行为保持不变。
10. 高频 chat stream 使用 Markstream 的 simple CSS typewriter cursor，避免 precise cursor 每次可见
    提交都通过 Range/getClientRects 触发布局读取。

## 非目标

- 不修改 `chat.stream.updated` snapshot contract、main 120 ms renderer 合帧或 600 ms DB 合帧。
- 不改 Markstream、stream-diffs 或 DeepChat 独立 editor surfaces 所用 stream-monaco 的上游实现，不维护本地 fork。
- 不重写 `useArtifacts` 的 ant-tag parser、消息 JSON 持久化格式或 message store 的折叠协议。
- 不在本次工作中把 full snapshot IPC 改为 delta transport；它仍是超长输出的剩余架构瓶颈。
- 不替换 PR #2000 的 outer message window、scroll controller、search highlight 或 capture owner。
- 不在本次工作中改变 markdown worker 的全局生命周期或引入新的用户设置。

## 验收标准

1. streaming 状态下，首个及后续 `content` snapshot 都在同一 Vue 更新周期传给 NodeRenderer，
   不等待 DeepChat 的 32/96 ms timer。
2. streaming -> final 时，NodeRenderer 同步收到最终 content 和 `final=true`；任何较早的静态防抖
   任务都不能回写旧内容。
3. 非流式内容更新继续走已有 fast/slow debounce；现有 docs/artifact 行为不变。
4. 正常 streaming chat 配置为 `nodeVirtual=false`、`maxLiveNodes=0`、`codeRenderer="monaco"`、`codeBlockStream=true`；完成态在同一 NodeRenderer 上设为 `final=true` 与 `codeBlockStream=false`。Markstream 在流式阶段展示内建 `<pre>`，完成且可见后才升级 `stream-diffs` surface。`viewportPriority` 与 `deferNodesUntilVisible` 仍仅由 `virtualizeNodes` 控制。
5. `virtualizeNodes=false` 时，node virtualization、viewport priority 和 visible deferral 均关闭，
   保证搜索、截图和完整 DOM 消费者可用。
6. NodeRenderer 在 live chat 和 completed/static 内容均保持 `codeRenderer="monaco"`，只通过 `codeBlockStream` 与 `final` 交给 Markstream 管理单一代码块 handoff；preview event 与 strict Mermaid 仍可用。
7. MarkdownRenderer 不写入 Markstream 全局 custom component registry；内建 link/reference 事件经
   根级委托保持 DeepChat 导航和引用交互，同消息多个 text part 互不覆盖。
8. inline stream 在完整 display-list 中保持 `messageIds` 顺序；未变化记录的转换缓存、单行
   streaming 状态和 completion node reuse 回归测试继续通过。
9. renderer 已校验 blocks 直接预填 parsed cache，不在同一个 snapshot 写入后立即 JSON.parse。
12. format、i18n、lint、typecheck、targeted renderer tests 和 renderer production build 通过。

## 性能与交互预算

- 跨进程 snapshot 频率仍由 main 限制为最多约 8.3 次/秒。
- 屏幕文本提交频率由 Markstream 限制为最多 20 次/秒；集成层不再叠加聊天内容 timer。
- 单个 stream snapshot 的 display-message 转换复用未变化记录；外层 geometry 仍以完整 display-list
  计算，并由虚拟窗口限制实际挂载的行数。
- 已校验 blocks 不得在 renderer 同步热路径再次 JSON.parse。
- 重节点在接近视口前不得启动 Monaco/Mermaid/KaTeX 重工作；完成态的 fallback 到 enhanced
  切换不得替换外层 message row。
- 沿用 chat scroll ownership 的每帧最多一次 scroll write、1 px anchor 误差和无新增 >50 ms
  long task 预算；jsdom 测试覆盖可自动化的调度和 handoff 回归。

## 兼容性与回滚

变化位于 main snapshot clone 与 renderer 集成层，不改变持久化数据、IPC schema 或用户设置。
若需回滚，可以分别恢复内容路由、parsed cache 预填、事件委托和内建 code renderer 选择；
`renderer-state-ownership-hardening` 的完整 display-list 消息窗口仍可独立工作。

## GitHub Issue

未请求或创建 GitHub issue。当前工作区的 `docs/issues/markstream-code-block-rendering/spec.md`
记录 ordinary code block 的具体回归，本架构目标覆盖其集成层根因。
