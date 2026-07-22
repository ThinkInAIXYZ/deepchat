# Renderer Scope 收敛、可靠性与性能优化

## 背景

Renderer 已有独立的 main、settings、floating、splash 和 browser-overlay entry，且 chat main 的 composition root 已迁入 `apps/chat-main`。不过主聊天会话创建、会话列表刷新和 deeplink 仍存在并发窗口；流式消息在状态切换时会向全部可见行广播会话级状态；多窗口外观初始化也存在重复实现。

本工作在不改变 IPC、持久化数据、用户可见功能或 renderer entry 的前提下，继续收敛 renderer scope、消除已确认的异步竞态，并降低长会话流式与搜索时的无效计算。

## 目标

1. 让新建会话提交具备 renderer 侧互斥，避免同一草稿的快速重复触发创建多个会话。
2. 防止过期的 session refresh 结果覆盖较新的本地或 IPC 更新，并保证 runtime webContents identity 尚未就绪时不会错误丢弃定向状态事件。
3. 让 start deeplink 的异步默认值、模型解析、路由跳转和会话关闭只为仍是当前 token 的 payload 提交，不能由旧 deeplink 覆盖后到 deeplink 的导航意图。
4. 将流式会话状态收敛到正在流式输出的消息行，避免历史 assistant 行在流开始和结束时无意义重算。
5. 降低聊天搜索输入期间的同步全量扫描与 DOM 高亮频率，并保证结果计数、可见 DOM 高亮和键盘导航使用同一可渲染内容语义。
6. 让历史消息加载区分 exhausted 与失败，失败时提供可访问的重试路径。
7. 在不共享运行时 Pinia/Vue 实例的前提下，提取 renderer-only 外观初始化能力，减少 chat main、settings、floating 的主题/字体/语言初始化漂移。
8. 保持既有 `features/chat-page/model/displayMessage.ts` 的 chat feature model 所有权；不为纯目录移动制造跨 feature “共享层”。
9. 对 user message 的富文本、mention、inline skill/file 的可见文字建立单一纯函数投影，使渲染、折叠度量与搜索结果计数共享语义，且搜索结果只索引可以由 DOM 高亮器激活的文字。
10. 后续的 `renderer-state-ownership-hardening` 架构切片移除 stable history + streaming tail 的 append-only 私有快路径：保留 message 转换缓存、pending/renderKey handoff、虚拟窗口与阅读锚定等公共合同，删除基于引用复用和手工 microbenchmark 的非用户可见合同。
11. MarkdownRenderer mock 测试只锁定 DeepChat 委托边界和必要的 streaming smoke contract，不把 Markstream 的可调优 profile 数值当作本应用稳定 API。
12. 每个实现切片完成后执行独立 review；发现问题先修复，再继续寻找明确且低风险的 renderer 优化点。

## 约束

- 代码改动范围限于 `src/renderer/`、对应 renderer 测试和本 SDD 文档；不变更 main、preload、shared IPC contract、数据库 schema 或用户设置格式。
- 不改变现有发送、deeplink、会话选择、流式消息、搜索、历史加载的正常用户路径语义。
- renderer app 维持独立 bootstrap、Pinia、i18n 和生命周期，不能共享运行中实例。
- 新的用户可见文案必须使用既有 i18n key；若既有 key 无法表达状态，才添加全 locale key。
- 不新增 renderer API facade；`renderer/api/*Client` 保持唯一 IPC adapter。
- 性能优化以减少可验证的无效重算为目标，不预设未测量的复杂 cache/worker 方案。
- 按用户要求，开发中不运行 lint、typecheck 或测试；所有质量门禁仅在 PR 创建前统一执行。

## 非目标

- 不移动或重命名 Vite HTML entry。
- 不改 main 进程 stream 合帧、会话幂等、session 持久化协议或当前固定关闭的 start deeplink 自动发送产品语义。
- 不重写成熟的 scroll controller、message window 锚定机制或 stream tombstone/generation gate。
- 不把所有 `components/message` 移入 chat feature；它们可读取 chat 的纯 display model contract，详见 `chat-display-model-boundary`。
- 不以 bundle 分包替换为主要优化手段，除非 production profiling 证明常规文本会话的首屏解析是明确瓶颈。

## 验收标准

1. 连续触发同一条新会话提交时，在首个提交完成前不会发出第二次 create/send；失败后仍可重新提交，且草稿只在成功时清除。
2. 定向 session refresh 以 session ID 为粒度处理重叠：同一 ID 只有最新请求可以提交结果，不同 ID 的并发结果都可提交；全量列表 epoch 仍会使旧定向结果整体失效，首屏请求发起后已提交的定向行不会再被该首屏的旧快照覆盖，且合并不会用更旧 `updatedAt` 覆盖较新 session 数据。
3. webContents identity 异步就绪期间收到的定向 activation/deactivation 被保留，并在 identity 就绪后按已有 session activation 逻辑处理。
4. 被较新 start deeplink 取代的异步任务不写入 message/draft/model，也不清除较新的 pending payload。
5. `MessageListRow` 只为当前流式 assistant message 接收生成中状态；历史行的活动分组结果不因会话级状态切换而变化。
6. 聊天搜索的文本扫描和 DOM 高亮经过防抖；关闭、结果导航、可见行高亮行为保持可用；被 DOM 高亮器忽略的交互控件及默认隐藏的工具详情不产生无法激活的结果。
7. 历史加载在 failure 与 exhausted 情况有不同 UI 状态；failure 可重试且不误报已到底。
8. 共享外观能力不导入 chat feature/store；每个 app 仍按自己的数据源初始化并在 cleanup 时解绑。
9. rich user content 优先于 raw text 时，MessageItemUser、MessageContent、折叠判定和 search result 计数使用相同的文字投影；mention 的 prompts/context label 及 inline skill/file 标签与实际 DOM 一致，且不会因 raw text 或非可见 metadata 产生额外结果。
10. 该阶段曾保留 stable/tail profile 与引用 identity 测试；后续 `renderer-state-ownership-hardening` 已用单一 display-list、虚拟窗口和阅读锚定等公共合同取代它们，不将数组 microbenchmark 作为性能依据。
11. MarkdownRenderer 测试继续覆盖 worker 初始化、artifact ID、语言规范化、link/reference 行为、失败重试和 unmount guard；仅保留 live streaming `final=false`、`codeBlockStream=true` 的 smoke 断言，而不锁定 profile tuning 数值或本地 debounce handoff 细节。
12. 每项实现后完成独立只读 review，最终 review 未发现需要在本 scope 中继续处理的高/中风险问题。
13. 最终执行 format、i18n、lint、typecheck、针对性与 renderer tests，并在通过后创建以 `dev` 为 base 的 PR。

## 风险与兼容性

- 提交互斥必须覆盖文件准备等异步步骤；否则第二次触发仍可能穿透。
- session `updatedAt` 只可作为 renderer 防倒灌保护，不能替代 main 持久化的线性化保证。
- 深链 token 必须在每个异步边界后复核，且清除动作必须与 token 绑定。
- 搜索防抖只延后计算，不能使 Escape、关闭、箭头导航使用旧索引。
- 外观 bootstrap 的初始读取和订阅顺序需兼容各 renderer 的 preload API 差异。

## 最终复审补充

最终 renderer 复审确认并收敛了三个与本目标一致的状态边界：

- start deeplink 仅保留异步边界后的 token 校验，移除无法引入交错的同步重复 guard；
- floating button 在读取初始 snapshot 前订阅跨窗口 IPC 更新，且本地写失败只回滚到实际的前值；
- DeepChat agent 默认配置异步返回时，不得覆盖用户在等待期间手动选择的新项目。

同时修复了 language store 对显式 `ltr` direction 的丢失，以及 project snapshot 过期失败错误可能覆盖较新本地 mutation 的情况。

## GitHub Issue

本工作由用户直接要求提交 PR；未请求创建或同步 GitHub Issue。
