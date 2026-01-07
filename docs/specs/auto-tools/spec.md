# Auto-Tools（自动选工具 + 批量执行）规格

## 定位与边界
Auto-Tools 解决的是“工具定义膨胀 + 模型选错工具”的问题，但不负责处理“工具输出过大”的承载方式：
- 工具输出承载：由 `docs/specs/tool-output-materialization/spec.md` 负责（独立且通用）
- 文件化/分页读取：由 `docs/specs/context-files/spec.md` 负责（独立且通用）

本 spec 只定义：
1) 模型如何拿到“足够轻量的工具目录（meta）”
2) 模型如何按 tool name 批量拉取工具详情（schema/description）
3) 模型如何一次性提交一组工具调用（batch），由系统执行并回传结果

## 目标
- 大幅减少 prompt 中常驻的 tool schema 体积（尤其是 MCP server 很多、工具描述很长时）。
- 让模型先“看名字/归类”，需要时再“按名称取详情”，而不是依赖模糊搜索（searchtools）做匹配。
- 支持模型把多个 tool calls 一次性提交（减少 round-trip），并复用既有权限体系。

## 非目标
- 不做 embedding/语义检索/复杂 ranking。
- v1 不引入 JS sandbox/code tool use（是否需要见下文决策）。

## 核心对象

### ToolIndexItem（轻量工具目录项）
模型侧默认只看到 ToolIndexItem 列表（可按 server 分组）。

建议字段：
- `name: string`（全局唯一工具名，直接用于调用）
- `serverName?: string`（如 MCP tool）
- `kind: 'mcp' | 'agent'`
- `risk?: 'read' | 'write' | 'execute' | 'unknown'`（用于权限/提示）
- `short?: string`（极短描述，可选，建议 <= 80 chars）

注意：这不是 ContextRef 文件；它就是轻量元数据，直接注入 prompt 即可。

### ToolDetails（按需工具详情）
当模型需要判断参数/语义时，通过专门能力按 name 批量拉取。

建议字段：
- `name`
- `description`
- `parameters`（JSON schema）
- `examples?`（可选，短小即可）

## 模型交互能力（建议以合成工具提供）

### 1) `get_tool_details`
用途：模型给出若干 `toolName`，系统返回这些工具的完整描述与 schema。

输入：
- `names: string[]`（支持批量，默认最多 20）

输出：
- `tools: ToolDetails[]`
- `missing: string[]`（不存在/不可用的工具名）

### 2) `run_tool_batch`
用途：模型一次性提交一组工具调用（按顺序执行或受控并发执行）。

输入：
- `calls: Array<{ name: string; arguments: object }>`
- `parallelLimit?: number`（默认 3–5；写/执行类强制串行或受权限约束）

输出（只返回小结果，避免膨胀）：
- `summary: string`（每个 call 的简短结果/错误）
- `results: Array<{ name: string; status: 'ok' | 'error' | 'permission'; ref?: ContextRef }>`
  - `ref` 指向详细输出（由 spec2 materialization 负责生成；该 ref 为源数据型 artifacts，因此应为 eager 物化）

权限：
- 每个 call 仍走既有 permission pipeline（read 可配置 auto-approve；write/execute 需要提示/审批）。
- 若 batch 中某个 call 触发 permission-required：可以中断 batch 或暂停并回传（实现选择，需在 plan 定义）。

## 是否需要 JS sandbox？（关键决策）
你提出的疑问成立：如果目标只是“更好选工具 + 少往 prompt 塞 schema + 减少 round-trip”，那么：
- ToolIndexItem + get_tool_details + run_tool_batch 已经覆盖 80% 价值
- 引入 JS sandbox 会带来：
  - 模型需要写代码（负担更重）
  - 安全面更大（即使做限制，也更复杂）
  - 调试体验更复杂（用户/模型都要理解代码执行）

因此 v1 建议不做 JS sandbox。保留 v2 扩展点：
- 当我们确实需要“循环/条件/动态分支/解析中间结果再决定下一步”的编排能力时，再引入 sandbox。
- 评估触发条件建议：
  - batch 编排无法覆盖的复杂工作流占比明显提升
  - 或需要在一次模型回合内做更复杂的数据加工（而不是交给模型）

## 验收标准（Acceptance Criteria）
- auto-tools 开启时：
  - prompt 不再注入完整 tool schemas，仅注入 ToolIndexItem（或更少：仅 tool names + serverName）。
  - 模型可调用 `get_tool_details` 批量拉取指定工具 schema。
  - 模型可调用 `run_tool_batch` 一次提交多个 tool calls。
- 任意 tool output 的“大内容”不直接进上下文：
  - 由 `tool-output-materialization` 负责落盘并返回 `ContextRef`。

## 依赖与顺序
- 必须先落地：`Context Files` + `Tool Output Materialization`
- Auto-Tools 才能稳定做到“少注入 + 可回溯”
