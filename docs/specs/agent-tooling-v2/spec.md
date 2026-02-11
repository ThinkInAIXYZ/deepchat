# Agent Tooling V2（Main Loop 优先）

## 背景

当前 main 层 agent 工具体系存在以下问题：

1. 工具命名与主流 Agent 生态不一致（大量下划线命名、语义重叠）。
2. 文件工具数量偏多且参数风格不统一，模型选工具与组参成本高。
3. Skills 来源多样（尤其 Claude Code），`allowedTools` 与 DeepChat 当前工具名不直接兼容。
4. 文件匹配/检索能力未充分利用 `rg`，在大型仓库下性能和结果质量不稳定。
5. loop 已基本可运行，但“对 renderer 输出的消息/事件格式”尚未形成明确、稳定的主协议。

本规格聚焦 main 层：先让 loop + tool 协议稳定、清晰、可推理，再推进 renderer 适配。

## 目标

1. **工具面收敛**：仅保留 8 个主工具（不兼容旧名）。
2. **Skills 工具映射**：引入标准映射层，重点支持 Claude Code 工具名。
3. **文件匹配增强**：`find/grep` 优先使用 `rg`，大仓库性能可预期。
4. **协议清晰**：导出 main 层稳定的消息格式与事件格式，供 renderer 后续接入。

## 非目标

1. 本阶段不改 renderer 逻辑与 UI 交互。
2. 不保留旧工具名的后向兼容（不做 alias call）。
3. 不重构 MCP 协议与第三方 provider 的底层实现。
4. 不引入新的权限类型（仍为 `read|write|all|command`）。

## 范围边界（补充）

本次优化仅覆盖：

1. 文件操作工具（fs）
2. runtime 工具（命令执行与后台进程管理）
3. 上述工具在 main loop 中的调用、权限与事件输出

本次**不改动**：

1. browser 相关工具（如 `yo_browser_*`）
2. skills 管理工具（如 `skill_list`、`skill_control`）
3. DeepChat 设置类工具（如 `deepchat_settings_*`）
4. 提问工具（`deepchat_question`）
5. MCP 工具本体及其服务端协议

## 工具集合（V2 Canonical）

固定为以下 8 个工具：

1. `read`
2. `write`
3. `edit`
4. `find`
5. `grep`
6. `ls`
7. `exec`
8. `process`

## Canonical 参数定义（V2）

### A. 文件工具（fs）

| 工具 | 必填参数 | 可选参数 | 说明 |
|---|---|---|---|
| `read` | `path: string` | `offset?: number`, `limit?: number` | 单文件读取；大文件分页读取。 |
| `write` | `path: string`, `content: string` | 无 | 创建或覆盖文件。 |
| `edit` | `path: string`, `oldText: string`, `newText: string` | `replaceAll?: boolean` | 精确文本替换；仅接受 canonical 参数名。 |
| `find` | `pattern: string` | `path?: string`, `maxResults?: number`, `exclude?: string[]` | 文件匹配，优先 `rg --files`。 |
| `grep` | `pattern: string` | `path?: string`, `filePattern?: string`, `caseSensitive?: boolean`, `contextLines?: number`, `maxResults?: number` | 内容搜索，优先 `rg`。 |
| `ls` | `path: string` | `depth?: number` | 列目录（默认浅层）。 |

### B. 运行时工具（runtime）

| 工具 | 必填参数 | 可选参数 | 说明 |
|---|---|---|---|
| `exec` | `command: string` | `cwd?: string`, `timeoutMs?: number`, `background?: boolean`, `yieldMs?: number` | 命令执行；长任务建议后台。 |
| `process` | `action: enum` | `sessionId?: string`, `offset?: number`, `limit?: number`, `data?: string`, `eof?: boolean` | 后台会话管理（list/poll/log/write/kill/clear/remove）。 |

约束：

1. 不再接受旧参数别名（如 `old_string/new_string`），只保留 canonical 参数名。
2. 参数校验失败必须返回结构化错误，不进入工具执行。

## 工具返回格式（统一）

所有 canonical 工具返回统一 envelope（`content` 可读摘要 + `rawData.toolResult` 结构化数据）：

```json
{
  "ok": true,
  "summary": "Found 12 matches in 3 files",
  "data": {},
  "meta": {
    "truncated": false
  }
}
```

错误格式：

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "path is required"
  }
}
```

说明：

1. `content` 供模型快速理解，`rawData.toolResult` 供 loop/renderer 稳定消费。
2. `find/grep/read` 需包含分页或截断信息（如 `returned`, `total`, `nextOffset`）。

## 待删除旧工具清单（用于边界确认）

以下旧工具将从 agent 文件/运行时工具定义中移除：

1. `read_file`
2. `write_file`
3. `list_directory`
4. `create_directory`
5. `move_files`
6. `edit_text`
7. `glob_search`
8. `directory_tree`
9. `get_file_info`
10. `grep_search`
11. `text_replace`
12. `edit_file`
13. `execute_command`

说明：

1. `process` 不删除，保留并归入 runtime canonical 集合。
2. 上述删除仅针对本地 Agent 工具定义层，不影响外部 MCP server 自带同名工具。

## Prompt 约束（main）

目标：降低模型选错工具/组参错误率，减少多余调用。

1. 系统提示中只暴露 canonical 工具名与参数摘要，不出现旧名。
2. 增加工具选择规则（按意图）：
   - 定位文件：`find` / `ls`
   - 搜索内容：`grep`
   - 读取内容：`read`
   - 精确修改：`edit`
   - 整体写入：`write`
   - 执行命令：`exec` + `process`
3. 增加调用策略：
   - 先查找再读取，再修改（`find/grep -> read -> edit/write`）
   - 优先小步调用，避免一次返回超大输出
4. 对无效工具名统一返回：`Unknown Agent tool: <name>`，不做自动别名纠正。

## 用户故事

### US-1：模型能更稳定选对工具
作为 agent 用户，我希望模型面对文件任务时优先在 6 个文件工具中做确定选择，而不是在多个重叠工具之间摇摆。

### US-2：Claude Code Skills 可直接复用
作为多工具用户，我希望导入 Claude Code skills 后，`allowed-tools` 能自动映射到 DeepChat 的 canonical 工具，不需要手工改名。

### US-3：大型仓库下检索稳定
作为 agent 用户，我希望 `find/grep` 在大仓库下保持高性能和一致结果，优先走 `rg`。

### US-4：事件协议可作为 renderer 改造输入
作为开发者，我希望 main 层先产出稳定的事件与消息格式，后续 renderer 可按协议接入，不再反复追 main 内部状态细节。

## Skills 工具映射（重点：Claude Code）

定义 canonical 映射（首批）：

| 外部工具名（Claude Code 常见） | DeepChat Canonical |
|---|---|
| `Read` | `read` |
| `Write` | `write` |
| `Edit` | `edit` |
| `MultiEdit` | `edit` |
| `Glob` | `find` |
| `Grep` | `grep` |
| `LS` | `ls` |
| `Bash` | `exec` |

说明：

1. 该映射用于 `skills allowedTools` 归一化，不影响 MCP 原生工具名。
2. 无法映射的工具名保留原值并标记 warning（不静默丢失）。
3. 映射后再参与“工具可用性过滤”。

## 文件匹配增强（rg 优先）

1. `find`：优先 `rg --files` + `-g` 模式过滤（含排除规则），不可用时回退 `glob`。
2. `grep`：优先 `rg`（支持行号、上下文、max results），不可用时回退 JS 扫描。
3. 输出必须包含可消费的结构化元信息（命中数、文件数、截断标识）。
4. 默认忽略目录保持统一：`.git`、`node_modules`、`dist`、`build`、`.next`（可扩展）。

## 消息与事件格式（main 导出）

本阶段定义并冻结 main 输出契约（renderer 暂不改）：

1. 仍通过 `STREAM_EVENTS.RESPONSE/ERROR/END` 发送。
2. `tool_call` 状态集合保持：`start|running|update|end|error|permission-required|question-required`。
3. 明确字段稳定性：
   - 必带：`eventId`
   - tool 事件必带：`tool_call_id`, `tool_call_name`
   - 权限事件必带：`permission_request.toolName/serverName/permissionType/description`
4. 在 `docs/specs/agent-tooling-v2/plan.md` 给出字段级 schema 约束与 JSON 样例（text/reasoning/tool/permission/question/end）。

## 约束

1. 安全边界：文件访问必须受 workspace/approved paths/conversation session 限制。
2. 权限门闩：遇到 permission-required 必须暂停，遵循已落地的 permission stabilization 语义。
3. 输出控制：工具大输出继续遵循 offload guardrails，不向模型直接注入超大文本。

## 验收标准

### A. 工具面

1. agent 工具定义列表只包含 8 个 canonical 工具名（加业务工具如 `deepchat_question`、skills 管理工具不在本条约束内）。
2. 旧文件工具名（如 `read_file/write_file/edit_file/...`）不再出现在工具定义中。
3. 调用旧工具名返回明确错误：`Unknown Agent tool`。
4. `yo_browser_*`、`skill_*`、`deepchat_settings_*` 的可见性与行为保持不变。

### B. Skills 映射

1. Claude Code `allowed-tools` 输入可映射到 canonical 工具。
2. `MultiEdit -> edit`、`Bash -> exec`、`Glob -> find` 等关键映射可通过测试验证。
3. 未知工具名不会被静默吞掉，存在可观测 warning。

### C. rg 增强

1. `find` 在可用 `rg` 时走 `rg` 分支；`rg` 不可用时自动回退 `glob`。
2. `grep` 在可用 `rg` 时走 `rg` 分支；`rg` 不可用时自动回退 JS。
3. 大仓库场景下 `find/grep` 都有 `maxResults` 截断行为并返回截断信息。

### D. 协议

1. `STREAM_EVENTS.RESPONSE` 中 tool 相关字段满足 plan 中定义的 schema。
2. `permission-required` 事件负载完整且可用于恢复执行链路。
3. 主流程可导出标准消息样例（text/reasoning/tool/permission/question/end）。

### E. 参数与 Prompt

1. 所有 canonical 工具参数满足本 spec 的统一定义。
2. 系统提示仅出现 canonical 工具名，不出现旧工具名或旧参数别名。
3. 工具参数校验失败可观测（明确错误码/错误信息），且不执行工具副作用操作。

## 开放问题

无。
