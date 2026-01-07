# Context Files（动态上下文文件体系）规格

## 背景
随着工具数量与工具输出体积增长，直接把 tool definitions 与 tool results 注入对话上下文会造成：
- 上下文 token 被“原始数据/长日志/大 JSON”占满
- 依赖截断会丢失排障关键信息
- 长会话触发摘要/裁切后，关键信息不可回溯

本 spec 定义一个最小且稳定的“动态上下文文件体系（Context Files）”标准：把大块数据变成文件，并通过轻量的引用（ContextRef）提供给模型按需读取。

## 目标
- 把所有“大而不应常驻上下文”的内容外置为文件（tool output、terminal output、history dump、tool catalog 等）。
- 给模型一个简单、低选择成本的读取方式：list → read（分页）/tail/grep。
- Context files 本质就是 files：不要引入复杂概念；只标准化目录结构、基础 meta、以及读写接口的输入输出。
- 存储位置默认在 DeepChat 应用数据目录（`app.getPath('userData')`）下，便于统一管理、清理、备份导入，不污染用户 workspace。

## 非目标
- 不引入 embedding/语义检索（只做文本读取与 grep）。
- 不做跨设备/云端同步（先本地）。
- 不要求模型理解复杂的“知识库/向量库”概念。

## 存储位置与目录结构

### 根目录
- `contextRoot`：`<userData>/context/`
- 每个会话独立目录：`<contextRoot>/<conversationId>/`

### 目录结构（标准）
- `artifacts/`：工具/终端输出等原始大内容
- `history/`：对话/裁切归档、摘要输入输出等
- `catalog/`：工具目录（可选：MCP tools/server 状态文件）
- `manifest.json`：可选索引（ref → file path、来源、hash、大小、创建时间、过期策略）

建议文件名规则（不强制，但推荐一致性）：
- 工具输出：`artifacts/tool/<toolCallId>.json` 或 `.txt`
- 终端输出：`artifacts/terminal/<snippetId>.log`
- 历史归档：`history/archive/<timestamp>-<range>.md`
- 手动摘要：`history/summary/<timestamp>.md`

## ContextRef（轻量引用）标准
ContextRef 是模型侧唯一需要“记住”的对象，用于按需读取文件内容。

### JSON Schema（逻辑）
- `id: string`：稳定标识（不等同于真实文件路径）
- `kind: 'artifact' | 'history' | 'catalog'`
- `mimeType?: string`
- `byteSize?: number`
- `createdAt: number`（ms epoch）
- `hint: string`（一句话说明用途/来源）

### 约定
- `id` 必须能被 `context.read` 等 API 解析到真实文件（允许在首次访问时由系统“按需生成/物化”该文件）。
- 模型默认只拿到 `ContextRef + 少量 inline 片段`，不直接注入完整文件内容。

## 基础访问能力（API 标准）
本 spec 只定义“能力与输入输出”，实现可通过独立 tool server（推荐）或复用/扩展现有文件读写能力完成。

### 关于“这就是在搜文件”（给模型的心智模型）
- Context files 本质就是普通文件，只是路径被系统托管（按会话隔离）并通过 `ContextRef.id` 间接访问。
- `context.grep`/`context.tail` 的行为等价于“对一个文件做 ripgrep / tail”，目的是让模型用熟悉的文件排障方式动态发现上下文：先搜关键词，再按需读取相关片段。
- 实现层应尽可能复用现有的文件/搜索能力（例如 ripgrep），并在输出里保留“行号/上下文行”，让模型明显感知自己是在“检索一个文件”。

### `context.list`
用途：列出当前会话已有的 ContextRef（按 kind 过滤）。

输入：
- `kind?: 'artifact' | 'history' | 'catalog'`
- `limit?: number`（默认 50）

输出：
- `items: ContextRef[]`

### `context.read`（分页读取）
用途：以 offset/limit 分页读取，避免一次性把大文件塞进上下文。

输入：
- `id: string`
- `offset: number`（字节或字符偏移，需在实现中明确；建议“字节”）
- `limit: number`（默认 8192，最大可配置）

输出：
- `id: string`
- `offset: number`
- `limit: number`
- `done: boolean`（是否读到文件末尾）
- `content: string`（此页内容）

### `context.tail`（优先用于排障）
用途：先看末尾错误段落，再决定是否继续读取。

输入：
- `id: string`
- `lines: number`（默认 200，最大可配置）

输出：
- `id: string`
- `lines: number`
- `content: string`

### `context.grep`
用途：在大输出/历史里快速定位关键词/错误堆栈。

输入：
- `id: string`
- `pattern: string`
- `maxResults?: number`（默认 50）
- `contextLines?: number`（默认 0）
- `caseSensitive?: boolean`（默认 false）

输出（建议结构，便于 UI/模型二次定位）：
- `totalMatches: number`
- `matches: Array<{ line: number; content: string; before?: string[]; after?: string[] }>`

#### 实现建议：优先使用 ripgrep
- 若运行环境可用 ripgrep（项目已有 runtime 方案），`context.grep` 应优先走 ripgrep，以获得更好的性能与一致的 grep 语义；失败时再回退到 JS 扫描。
- pattern 必须做 ReDoS 安全校验（与 `AgentFileSystemHandler` 一致的思路），并限制 `maxResults` 与超时。

## 物化策略（Eager vs Lazy）与清理
为避免把“本来已在 SQLite 里存在的数据”重复长期落盘，Context Files 支持两种物化策略（对模型透明）：

### Eager（创建即写文件）
- 适用：原始大输出本身就是“源数据”（例如 tool/terminal 的完整输出在裁切后不再保留于上下文）。
- 行为：创建 `ContextRef` 时立即写入文件，保证随时可 `tail/grep/read`，并在 export/import 中打包。

### Lazy（按需生成文件，作为可再生缓存）
- 适用：源数据已经可靠存在于本地存储（例如 SQLite 对话消息、可重建的索引/目录）。
- 行为：创建 `ContextRef` 时只记录必要元信息（例如 `hint`、来源 message/tool ids），不立即写文件；当首次调用 `context.read/tail/grep` 时再从源数据生成文件后执行读取/grep。
- 清理：这类文件可按 LRU/TTL 自动清理；再次访问时可重新生成。

约束：
- 不管 eager/lazy，模型侧交互仍只使用 `ContextRef.id` + `context.*` API，不暴露真实路径与复杂存储细节。

## Truncate 与分页策略
- 所有“写入对话上下文”的内容都必须有 `maxInlineBytes/maxInlineChars` 阈值。
- 超阈值时：完整内容写入 context file；对话里只放摘要/片段 + `ContextRef`。
- 模型若需要更多信息，应通过 `context.read/tail/grep` 按需拉取。

## 备份/导入（与 Sync/Export 集成）
Context files 属于“会话运行时衍生数据”，但对排障与可回溯非常关键，应纳入备份导入。

最低要求：
- Export 时按 `conversationId` 打包：`context/<conversationId>/**`
- Import 时恢复到 `<userData>/context/<conversationId>/**`
- 若存在 `manifest.json`，需要随同导入；否则允许按目录结构重建索引（可选）。

## 安全边界
- Context API 只能访问 `<userData>/context/<conversationId>` 这棵树。
- 不允许通过 `id` 间接访问任意磁盘路径（防止路径穿越）。
- `context.grep` 的 pattern 需要做 ReDoS 安全校验（复用现有 validator 思路）。

## [NEEDS CLARIFICATION]
- `context.read` 的 offset 语义：字节 vs 字符（建议字节 + UTF-8，跨平台一致性需要定义好）。
- Context 的默认保留策略（按会话删除/按大小 LRU/上限默认值）。
- 是否需要默认脱敏（建议最小化：只对明显 key/token 进行 regex redact；其余由用户选择“敏感模式”）。
