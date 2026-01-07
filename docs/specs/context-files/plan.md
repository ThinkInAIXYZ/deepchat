# Context Files（动态上下文文件体系）实施计划

## 0) 产出物
- Context Store：`<userData>/context/<conversationId>/...` 目录与（可选）`manifest.json`
- ContextRef：统一的轻量引用结构
- 基础访问能力：`context.list/read/tail/grep`
- 分页读取能力：offset/limit（避免大文件一次性注入）
- Export/Import：按 `conversationId` 打包与恢复

## 1) 设计确认（先做）
- 定稿 `ContextRef` 字段与 `kind` 枚举（artifact/history/catalog）。
- 定稿 `context.read` offset 语义：字节偏移（UTF-8；输出为 string）。
- 定稿默认阈值：
  - `read.limit` 默认 8KB（可配置，上限例如 64KB）
  - `tail.lines` 默认 200（可配置，上限例如 2000）
- 定稿保留策略：
  - eager artifacts 默认不自动删除（与 DB 一样长期保留）
  - lazy cache 文件允许按 LRU 清理（可重建）

## 2) Context Store 管理器（main 侧）
- 生成 `contextRoot` 与 `conversationContextRoot(conversationId)` 的路径管理。
- 提供：
  - `createRef(kind, hint, mimeType?)` → `ContextRef` + 真实 file path
  - `write(refId, content)`/`append(...)`
  - `stat(refId)`（byteSize）
  - `resolve(refId)`（仅允许在会话目录内）
- 可选：`manifest.json` 索引（写入时更新）。
- 支持两种物化策略：
  - eager：创建即写入文件（适合 tool/terminal 原始输出）
  - lazy：首次 `read/tail/grep` 时再从 SQLite/可重建源生成文件（适合作为 grep 缓存）

## 3) Context Tool（推荐独立 server）
- 以最小 API 暴露：`context.list/read/tail/grep`
- 所有操作都隐式绑定 `conversationId`（避免模型拼错路径/越权）。
- `grep` 优先复用 ripgrep runtime（若可用），不可用时使用 JS 扫描；复用既有的 regex safety 校验思路，并限制 maxResults/超时。
- 实现上可以复用 `AgentFileSystemHandler` 的内部能力（尤其是 ripgrep + fallback 的 grep 实现），但对模型仅暴露 `context.*` 这组受限接口，且访问范围严格限制在 `<userData>/context/<conversationId>`。

## 4) Export/Import 集成
- Export：将 `context/<conversationId>/**` 纳入会话导出包。
- Import：恢复到 `<userData>/context/<conversationId>/`。
- 冲突策略：同名文件覆盖 or 合并（建议覆盖 + 备份旧目录）。

## 5) 测试
- Unit：
  - `resolve(refId)` 路径穿越防护
  - `read(offset/limit)` 边界（offset 越界、limit 上限、done 标识）
  - `tail(lines)` 对超大文件性能（只读末尾）
  - `grep` pattern 校验与 maxResults
- Integration：
  - Export/Import 后 `ContextRef` 仍可读

## 6) 交付
- 按本 spec 作为唯一标准实现并接入：Context Store + `context.*` API。
- 与 Export/Import 同步交付，保证 `ContextRef` 在导入后可读（eager artifacts）或可重建（lazy refs）。
