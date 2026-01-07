# Conversation History Archive（对话历史归档）实施计划

## 0) 依赖
- Context Files：`docs/specs/context-files/spec.md`
- Tool Output Materialization：`docs/specs/tool-output-materialization/spec.md`（可先后顺序都行，但更推荐先落地 spec2）

## 1) 现状梳理与 Hook 点确认
- 找到当前“上下文裁切/摘要触发”的代码路径：
  - 何时删 tool calls
  - 何时删消息正文
  - 是否已有 summary 产物

## 2) 归档实现
- 生成 archive segment：
  - lazy：创建 `ContextRef(history)` + 元信息（message 范围/时间/tool calls），首次访问时再导出 markdown
  - eager：立即导出 markdown 文件（结构固定、携带 message 范围与时间、tool call 信息结构化便于 grep）
- 生成 placeholder message：
  - 小摘要 + `ContextRef(history)`
  - 固定提示：如何 `context.grep/tail/read`

## 2.1) 物化策略（默认 lazy）
- 默认：placeholder 创建时不立刻写 markdown（lazy），首次 `context.read/tail/grep` 时从 SQLite 导出生成，再执行读取/grep。
- 可选：在裁切时 eager 生成 markdown（更“可移植”，但更占磁盘）。
- Export 策略需明确：
  - 若导出包不包含 SQLite：导出时强制把 lazy refs eager 物化并打包 `history/archive/**`
  - 若导出包包含 SQLite：可保持 lazy，导入后可重建

## 3) 多次裁切策略
- 每次裁切新建一个 segment（`ContextRef(history)`；文件可 eager 或 lazy 生成），避免覆盖。
- 可选：维护 `history/index.md` 汇总（范围/摘要/refs）。

## 4) Export/Import
- 将 `history/**` 纳入 export/import（依赖 spec1 的 Context Store 打包规则）。

## 5) 测试
- Unit：
  - segment 生成格式与最小字段
  - placeholder 体积与内容稳定性
- Integration：
  - 裁切后，原信息仍可通过 `ContextRef` 找回（grep/尾部读取）
