# 任务清单

- [x] 审计 PR #2000 的 stable history、streaming tail、outer message window 与 scroll 链路。
- [x] 审计 main 120 ms snapshot 合帧、renderer message store，以及当前 Markstream + stream-diffs 源码与 AI workflow。
- [x] 明确 main、renderer integration、Markstream 和 outer window 的 owner 边界。
- [x] 写入 spec、plan 和验证预算，无 `[NEEDS CLARIFICATION]`。
- [x] 让 streaming snapshot 和 final handoff 绕过 DeepChat 静态内容 debounce。
- [x] 建立稳定的 stream-diffs handoff：streaming 保持 Markstream `<pre>` fallback，completed/visible 由同一 CodeBlockNode 升级 File/FileDiff surface。
- [x] 完成 Markstream 内建 enhanced code renderer 路径与公开 preview event 兼容处理。
- [x] 补同步 stream handoff、final、viewport 和 enhanced code renderer 行为测试。
- [x] 曾让正常尾部 inline stream 命中 stable/tail layout contract；后续 `renderer-state-ownership-hardening` 已改为单一完整 display-list 合同。
- [x] 修正高 orderSeq 分页窗口中的 optimistic/stream 本地尾序。
- [x] 使用 shallow stream state，并预填 renderer parsed cache；保留 main JSON normalization 兼容语义。
- [x] 用内建 link/reference/Mermaid + 事件委托移除 MarkdownRenderer 全局 custom registry 热路径。
- [x] 恢复 Markstream live code `<pre>` fallback，并覆盖 static/completed handoff 行为。
- [x] 将高频 chat typewriter 切换为 simple CSS cursor。
- [x] 更新 `markstream-code-block-rendering` issue spec 的版本、handoff 与验证状态。
- [x] 运行 targeted renderer tests 并复审 failure。
- [x] 运行 format、i18n、lint、typecheck、完整 renderer tests 与 production build。（full renderer 并行运行受宿主容量影响，出现 32 个无关 10 秒超时；Markstream 相关 suites、类型检查和 production bundling 均通过。）
- [x] 复审最终 diff、性能职责和 PR #2000 描述是否仍准确。
