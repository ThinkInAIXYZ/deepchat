# Conversation History Archive（对话历史归档）规格

## 背景
当前上下文裁切会优先删除 tool call 相关内容，如果还不够就继续删除消息正文。这样会造成：
- 工具使用链路不可回溯（尤其是工具输出已被删）
- 模型在后续回合容易“忘记”已做过什么、为什么失败

本 spec 的目标是：把被裁切掉的对话与 tool result 归档为 Context Files，并在对话里保留一个明确的 `ContextRef` 指针。

依赖：
- `docs/specs/context-files/spec.md`（ContextRef 与读取能力）
- `docs/specs/tool-output-materialization/spec.md`（工具输出可能已独立归档为 artifacts）

## 核心策略：裁切≠丢弃，改为“归档 + 指针”

### 1) 归档时机
- 自动：每次触发上下文裁切（token 超限、或进入摘要流程）
- 手动：用户点击“生成总结/清理上下文”（如有）

### 2) 归档粒度
建议以“连续消息区间（segment）”为单位归档：
- 例如按最老的一段（从消息 A 到消息 B）归档为一个文件
- 归档后在对话里用一个“占位消息（placeholder message）”替换这段内容

### 3) 归档格式（推荐 Markdown）
归档文件（eager 物化时）：`<userData>/context/<conversationId>/history/archive/<timestamp>-<range>.md`

最小包含：
- 会话 id、归档时间、消息范围（messageId 或序号）
- 原始消息列表（role、时间、content）
- tool calls（如果被裁切）：tool name、arguments、toolCallId、以及 tool output 的 ContextRef（若存在）

如果工具输出已按 spec2 归档到 artifacts：
- 历史归档里不需要重复存原始大输出
- 只要存 ContextRef（或 toolCallId 以便反查 ref）

### 4) 占位消息（placeholder）标准
当某段被归档后，在对话上下文中插入一个占位消息，内容固定且明确：
- 说明“这段历史已被归档/压缩”
- 给出简短摘要（可选，先用实现端生成的 3–5 行要点）
- 给出 `ContextRef(history)` 指向归档文件
- 提示模型可用 `context.grep/tail/read` 找回细节

占位消息应尽量小，避免再占用上下文。

## 物化策略（Eager vs Lazy）
历史归档与工具输出不同：对话原文通常已存在于 SQLite（源数据已被系统持久化）。因此 `ContextRef(history)` 可以采用 lazy 物化，把“归档文件”当作可再生缓存，用于 grep/tail：

### Lazy（默认推荐）
- 创建 placeholder 时只创建 `ContextRef(history)`（逻辑 ref），记录 messageId 范围/时间戳等元信息，不立即写 markdown 文件。
- 当模型首次 `context.read/tail/grep` 访问该 ref 时，从 SQLite 导出该段历史生成 markdown 文件，再执行读取/grep。
- 清理：可按 LRU 清理生成的 markdown（作为可再生缓存）；再次访问可重新生成。

### Eager（可选）
- 在裁切当下立即生成 markdown 文件并写入 `history/archive/`。
- 适用：你希望“即使没有导入 SQLite，也能通过 export 包单独恢复历史”的场景。

### 可移植性（export/import）
为保证导出包可用，需要明确策略（二选一即可）：
- 策略 A：导出包含 SQLite（或会话数据库），lazy ref 可在导入后重建归档文件（不必随包带 markdown）。
- 策略 B：导出时将所有 lazy history refs 统一“强制 eager 物化”并打包 `history/archive/**`，确保仅靠导出包也能回溯与 grep。

## tool call 删除场景的处理建议
你提到“我们目前上下文裁切会把 tool call 删掉”：
- 新策略：当裁切逻辑决定删除 tool call 相关消息时，必须先生成一个 history segment 的 `ContextRef(history)`（逻辑归档），并记录这段消息范围与 tool calls 元信息
- 并在原位置插入 placeholder（或在同一轮裁切后插入一个汇总 placeholder）

这样模型会知道“这里曾经有工具调用链路”，并且能按需通过 `context.read/tail/grep` 找回：
- eager：直接读取已生成的 markdown 文件
- lazy：首次访问时从 SQLite 导出生成 markdown 再读取/grep

## 长会话多次裁切的处理（你提到的未想清楚部分）
建议用“分段归档 + 多指针”解决，不需要 embedding：
- 每次裁切都生成一个新的 archive segment（`ContextRef(history)`；文件可 eager 或 lazy 生成）
- 对话中会累积多个 placeholder（每个都指向一个 segment）
- 模型要找信息时：
  - 先 `context.list(kind='history')` 找到最近的归档
  - 再 `context.grep(refId, '关键词')` 定位到对应段落

可选优化（后续再做）：
- 生成一个 `history/index.md` 汇总所有 segment 的范围与摘要，方便模型快速选择要读哪个文件

## 非目标
- 不做语义检索/向量化
- 不强求一次性生成“完美摘要”（重点是可回溯）

## 安全与隐私
- 历史归档属于用户对话数据，应纳入 export/import。
- 不做默认脱敏（纯本地；归档内容来自用户/工具原始数据）。
