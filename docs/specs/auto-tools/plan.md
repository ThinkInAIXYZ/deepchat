# Auto-Tools（自动选工具 + 批量执行）实施计划

## 0) 依赖（必须先完成）
- `docs/specs/context-files/spec.md`（ContextRef + 分页读取）
- `docs/specs/tool-output-materialization/spec.md`（大输出落盘 + ref 回传）
  - 注：spec2 产生的 tool output `ContextRef` 属于 artifacts，必须 eager 物化；history 类 ref 可按需 lazy（由 history spec 定义）

## 1) Tool Index（轻量工具目录）生成
- 生成 ToolIndexItem：
  - name（唯一）
  - serverName（如有）
  - kind（mcp/agent）
  - risk（read/write/execute/unknown）
  - short（可选）
- 注入策略：
  - auto-tools 开启时，prompt 里只注入 ToolIndexItem（禁止注入完整 schema）
  - ACP 不走 auto-tools（维持现状）

## 2) 合成工具：`get_tool_details`
- 输入：`names[]`
- 输出：对应工具的 `description + JSON schema + examples?`
- 性能：
  - 支持批量；缓存同一会话内的详情，避免重复回传
- 错误：
  - 不存在/不可用的工具要明确返回 `missing[]`

## 3) 合成工具：`run_tool_batch`
- 输入：`calls[]`（name + arguments object）
- 执行策略：
  - 默认串行；read 类可受控并发（`parallelLimit`）
  - 任意 call 触发 `permission-required`：暂停 batch 并回传该请求（其余不继续）
- 输出：
  - `summary`（一屏可读）
  - `results[]`（每个 call 的 status + ContextRef（如产生了大输出））
- 与 spec2 的关系：
  - `run_tool_batch` 本身不负责大输出裁切/落盘，直接复用 spec2 逻辑

## 4) UI/UX
- 设置：
  - `enableAutoTools`（默认 false）
  - `parallelLimit`（默认 3–5）
- 会话中：
  - 显示 auto-tools 模式 chip
  - batch 执行进度（每个 call 的 running/end/error/permission）

## 5) 测试
- Unit：
  - ToolIndex 生成正确、体积可控
  - `get_tool_details` 批量/缓存/缺失处理
  - `run_tool_batch` 执行顺序、并发上限、permission 中断
- Integration：
  - auto-tools 开启后 prompt 体积显著下降（不含 schema）
  - tool outputs 仍由 spec2 materialization 控制（不会膨胀上下文）

## 6) Rollout
- 默认关闭；灰度打开（dev mode 先）
