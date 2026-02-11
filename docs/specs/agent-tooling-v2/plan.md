# Agent Tooling V2 实施计划（Main Loop 优先）

## 1. 当前实现基线

### 1.1 工具路由

主路由为：

1. `ToolPresenter` 统一汇总和路由工具  
   `src/main/presenter/toolPresenter/index.ts`
2. Agent 本地工具由 `AgentToolManager` 管理  
   `src/main/presenter/agentPresenter/acp/agentToolManager.ts`
3. 文件能力由 `AgentFileSystemHandler` 执行  
   `src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts`

### 1.2 Loop 与事件

1. 生成与工具调度：`AgentLoopHandler` + `ToolCallProcessor`  
   `src/main/presenter/agentPresenter/loop/agentLoopHandler.ts`  
   `src/main/presenter/agentPresenter/loop/toolCallProcessor.ts`
2. 主事件类型：`LLMAgentEventData`  
   `src/shared/types/core/agent-events.ts`
3. 对 renderer 推送由 `StreamUpdateScheduler` 聚合  
   `src/main/presenter/agentPresenter/streaming/streamUpdateScheduler.ts`

### 1.3 Skills

1. active skills 与 allowedTools 来源：`SkillPresenter`  
   `src/main/presenter/skillPresenter/index.ts`
2. 当前 allowedTools 未做统一 canonical 归一化。

### 1.4 实施边界（补充）

本计划仅涉及：

1. `src/main/presenter/agentPresenter/acp/agentToolManager.ts`
2. `src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts`
3. `src/main/presenter/agentPresenter/loop/toolCallProcessor.ts`
4. `src/main/presenter/skillPresenter/index.ts`（仅 allowedTools 归一化接入）
5. `src/main/presenter/toolPresenter/index.ts`（tool prompt 与路由提示）
6. `src/main/presenter/agentPresenter/message/messageBuilder.ts`（system prompt 拼接）
7. `src/main/presenter/agentPresenter/message/skillsPromptBuilder.ts`（skills allowedTools 接入）
8. 与上述模块直接相关的测试与文档

明确不改动：

1. `src/main/presenter/browser/**`
2. `src/main/presenter/agentPresenter/acp/chatSettingsTools.ts`
3. `src/main/presenter/agentPresenter/tools/questionTool.ts`
4. `src/main/presenter/mcpPresenter/**`

## 2. 设计决策

### 2.1 工具命名策略

决策：使用固定 canonical 工具名，不保留旧名兼容调用。

canonical：

1. `read`
2. `write`
3. `edit`
4. `find`
5. `grep`
6. `ls`
7. `exec`
8. `process`

实现点：

1. `AgentToolManager.fileSystemSchemas` 直接改名。
2. `isFileSystemTool()`、`callFileSystemTool()`、`collectWriteTargets()` 全量切换新名。
3. `ToolCallProcessor.TOOLS_REQUIRING_OFFLOAD` 同步新名。

旧工具删除清单（本次落地必须删除）：

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

### 2.1.1 Canonical 参数收敛

决策：参数名统一，删除旧参数别名；一处校验，多处复用。

参数标准：

1. `read`: `path`, `offset?`, `limit?`
2. `write`: `path`, `content`
3. `edit`: `path`, `oldText`, `newText`, `replaceAll?`
4. `find`: `pattern`, `path?`, `maxResults?`, `exclude?`
5. `grep`: `pattern`, `path?`, `filePattern?`, `caseSensitive?`, `contextLines?`, `maxResults?`
6. `ls`: `path`, `depth?`
7. `exec`: `command`, `cwd?`, `timeoutMs?`, `background?`, `yieldMs?`
8. `process`: `action`, `sessionId?`, `offset?`, `limit?`, `data?`, `eof?`

落地原则：

1. schema 校验失败直接返回 `INVALID_ARGUMENT`，不执行工具。
2. 不再接受 `old_string/new_string` 等 alias。
3. skills 映射只做工具名映射，不改写工具参数。

### 2.1.2 工具返回 envelope

决策：工具返回统一为“可读摘要 + 结构化数据”。

约定：

1. `content`: 给模型看的短摘要。
2. `rawData.toolResult`: 结构化对象，至少包含 `ok`。
3. 查询类工具（`read/find/grep/ls/process(log)`）补充 `meta`（截断、分页）。
4. 写入类工具（`write/edit/exec/process(write|kill...)`）补充 `affectedPaths` 或 `sessionId` 等执行结果元信息。

### 2.2 Skills 工具映射层

决策：新增“skills allowedTools canonicalizer”，在 skills 到运行时工具过滤的边界做归一化。

建议新增模块：

`src/main/presenter/skillPresenter/toolNameMapping.ts`

提供：

1. `normalizeSkillToolName(toolName: string): { canonical: string; mapped: boolean }`
2. `normalizeSkillAllowedTools(tools: string[]): { tools: string[]; warnings: string[] }`

首批映射（Claude Code 优先）：

1. `Read -> read`
2. `Write -> write`
3. `Edit -> edit`
4. `MultiEdit -> edit`
5. `Glob -> find`
6. `Grep -> grep`
7. `LS -> ls`
8. `Bash -> exec`

接入点：

1. `SkillPresenter.getActiveSkillsAllowedTools()` 返回前归一化。
2. 归一化 warning 通过日志输出，避免静默丢失。

### 2.3 rg 增强策略

决策：`find/grep` 均采用 “rg 优先，fallback 次级实现”。

1. `find`
   - 优先：`rg --files` + `-g` include/exclude
   - 回退：`glob`
2. `grep`
   - 优先：现有 `runRipgrepSearch` 路径继续强化结构化输出
   - 回退：现有 JS grep 路径

约束：

1. 保持 `maxResults` 生效，返回截断信息。
2. 统一默认 ignore 集。
3. 当 `rg` 调用异常时必须记录告警并稳定回退。

### 2.4 事件与消息格式定版（main 导出）

决策：不在本阶段改事件通道，但冻结字段约束。

事件：

1. `stream:response`
2. `stream:error`
3. `stream:end`

`stream:response` 内 tool 事件规范：

1. 公共字段：`eventId`, `stream_kind`, `seq`
2. tool 事件必备：
   - `tool_call`
   - `tool_call_id`
   - `tool_call_name`
3. permission 事件附加：
   - `permission_request.toolName`
   - `permission_request.serverName`
   - `permission_request.permissionType`
   - `permission_request.description`

字段样例：

1. 文本增量：

```json
{
  "eventId": "evt_123",
  "stream_kind": "delta",
  "seq": 7,
  "content": "partial text"
}
```

2. 工具执行中：

```json
{
  "eventId": "evt_123",
  "tool_call": "running",
  "tool_call_id": "call_1",
  "tool_call_name": "grep",
  "tool_call_params": "{\"pattern\":\"TODO\",\"path\":\"src\"}",
  "tool_call_server_name": "agent-filesystem"
}
```

3. 工具执行结束：

```json
{
  "eventId": "evt_123",
  "tool_call": "end",
  "tool_call_id": "call_1",
  "tool_call_name": "grep",
  "tool_call_response": "Found 3 matches in 2 files",
  "tool_call_response_raw": {
    "toolResult": {
      "ok": true,
      "summary": "Found 3 matches in 2 files",
      "data": {
        "matches": []
      },
      "meta": {
        "truncated": false
      }
    }
  }
}
```

4. 权限请求：

```json
{
  "eventId": "evt_123",
  "tool_call": "permission-required",
  "tool_call_id": "call_2",
  "tool_call_name": "write",
  "permission_request": {
    "toolName": "write",
    "serverName": "agent-filesystem",
    "permissionType": "write",
    "description": "Write access requires approval."
  }
}
```

5. 提问请求：

```json
{
  "eventId": "evt_123",
  "tool_call": "question-required",
  "tool_call_id": "call_3",
  "tool_call_name": "deepchat_question",
  "question_request": {
    "question": "Select environment",
    "choices": ["dev", "prod"]
  }
}
```

说明：renderer 暂不改，仅作为后续改造输入契约。

### 2.5 Prompt 与调用策略更新（main）

决策：在 main 侧 prompt 拼接环节明确 canonical 工具规则，减少模型误调用。

改动点：

1. `src/main/presenter/toolPresenter/index.ts`
   - `buildToolSystemPrompt()` 增加 canonical 工具清单与“意图到工具”选择规则。
2. `src/main/presenter/agentPresenter/message/messageBuilder.ts`
   - 保证 tool prompt 在 agent/tool mode 下稳定拼接。
3. `src/main/presenter/agentPresenter/message/skillsPromptBuilder.ts`
   - `getSkillsAllowedTools()` 使用 canonicalized allowed tools。

prompt 规则（要点）：

1. 仅展示 canonical 工具名。
2. 明确 `find/grep -> read -> edit/write` 推荐顺序。
3. 明确“旧工具名不可用”与错误表现（`Unknown Agent tool`）。

### 2.6 Loop 执行顺序收敛

统一流程：

1. LLM 产出 tool calls
2. `batchPreCheckPermissions()` 批量权限预检
3. 发出 `permission-required`（若有）并暂停 loop
4. 逐个 tool 执行，发 `running -> end/error`
5. 大输出按 offload 规则写入 session 文件并返回 stub
6. 继续下一轮推理或结束

## 3. 实施阶段

### Phase 1：工具面切换（无兼容）

1. 重命名并收敛 tool schemas + definitions。
2. 切换 handler 分派逻辑。
3. 删除旧工具名引用（包括测试、文档、skills 默认示例）。
4. 回归确认 browser/skills/settings/question 工具定义与行为无变更。

### Phase 2：Skills 映射

1. 新增映射模块与单元测试。
2. 接入 `getActiveSkillsAllowedTools()`。
3. 在 skill sync 适配器层保持原始值，运行时归一化。

### Phase 3：rg 增强

1. `find` 引入 rg 分支（若尚未实现）。
2. `grep` 完善 rg 结果结构化（命中文件/行号/上下文/截断）。
3. 完善 fallback 与错误日志。

### Phase 4：Prompt 与协议导出

1. 更新 main 侧 tool prompt（仅 canonical + 调用规则）。
2. 增加消息/事件契约测试，确保字段不回归。

## 4. 数据与配置影响

1. **破坏性变化（明确）**：旧工具名不可再调用。
2. 不涉及数据库 schema 迁移。
3. Skills 的 `allowedTools` 原始存储不强制改写，仅在运行时归一化。

## 5. 测试策略

### 5.1 单元测试

1. `AgentToolManager`：
   - 工具定义仅包含 canonical 名。
   - 旧工具名调用报错。
   - canonical 参数 schema 校验正确。
2. Skills 映射：
   - Claude Code 常见工具名映射正确。
   - 未知工具产生 warning。
3. `AgentFileSystemHandler`：
   - `find/grep` 在 rg 可用与不可用分支均可运行。
4. Prompt 组装：
   - tool prompt 仅包含 canonical 工具名。
   - 不包含旧工具名提示。

### 5.2 集成测试

1. loop 工具调用事件序列：start/running/end。
2. permission-required 负载完整性。
3. offload 与大输出行为在新工具名下仍生效。
4. toolResult envelope 字段（`ok/summary/data/meta`）在关键工具路径可观测。

## 6. 风险与缓解

1. 风险：旧 prompt 或 skill 仍调用旧工具名导致失败。  
   缓解：在系统 prompt 与 skills metadata prompt 中明确仅 canonical 名。

2. 风险：不同平台 rg 参数兼容性差异。  
   缓解：统一封装 rg 参数构造，Windows/Linux/macOS 加测试样例。

3. 风险：skills 映射冲突导致过度归并。  
   缓解：映射表版本化，保留原值告警，必要时支持精细映射策略。

## 7. 质量门槛（DoD）

1. `pnpm run format`
2. `pnpm run lint`
3. `pnpm run typecheck`
4. 关键 main 测试通过（tool/loop/permission/skills 映射相关）
