# Tool、MCP、Skill 与 Plugin

## 所有权

| 模块 | 位置 | 职责 |
| --- | --- | --- |
| Tool | `src/main/tool/` | catalog、source mapping、执行、权限和本地 Agent tools |
| MCP | `src/main/mcp/` | server/client 生命周期、OAuth、配置和 MCP tool 调用 |
| Skill | `src/main/skill/` | 全局 Skills、Agent binding、外部快照导入、Session 选择和 Plugin contribution |
| Plugin | `src/main/plugin/` | package 安装状态、manifest 验证和能力登记 |
| DeepChat adapter | `src/main/agent/deepchat/runtime/toolAdapters.ts` | 把 loop ports 接到 ToolService 和 interaction |
| ACP adapter | `src/main/agent/acp/runtime/` | ACP protocol tools、filesystem、terminal 和 MCP config |

Plugin 只登记能力，不接管 MCP、Skill 或 Tool 的运行状态。Skill 模块是进程级 owner：mutable
Skill package、catalog cache 和 watcher 归应用级全局 Skills；Agent 只拥有 binding 和 extension
binding。Session 只保存所选 Skill 名称，不拥有文件。

## Catalog 与 source mapping

`ToolService.getAllToolDefinitions()` 组合 MCP tools 和本地 Agent tools，处理 reserved name、disabled
配置和 model-visible capability，并为每个 Session 发布独立 source mapping。

- 已发布 mapping 是执行边界；不得从另一个 Session 的 snapshot 回退。
- 只有未持久化 draft 可以使用无 Session ID 的首次执行兼容 snapshot。
- configurable catalog 只返回 `user-configurable` Agent tools，不触碰 MCP runtime cache。
- MCP 同名工具不能覆盖 built-in reserved capability。

## Tool exposure

| Exposure | 含义 |
| --- | --- |
| `user-configurable` | 可以在设置中启停 |
| `system-model` | 由 runtime policy 决定是否给模型，不受 disabled list 控制 |
| `diagnostic` | 仅诊断 API，不生成模型 definition |
| `runtime-only` | 只有内部 runtime 可以调用 |

Tape 只向模型暴露 `tape_search` 和 `tape_context`。`tape_info`、`tape_anchors` 是 diagnostic，
`tape_handoff` 是 runtime-only。所有 Tape tool name 都是 reserved。

`subagent_orchestrator` 是 `system-model` capability：只有 regular DeepChat parent、当前 Agent policy
开启且至少一个 slot 有效时可见；调用前再次解析 policy，Subagent child 永远拒绝。

## 执行与交互

```mermaid
sequenceDiagram
    participant L as DeepChatLoopEngine
    participant A as Tool adapter
    participant T as ToolService
    participant M as MCP
    participant B as Built-in tools

    L->>A: executeToolBatch(snapshot)
    A->>T: callTool(request, signal)
    T->>T: resolve Session source mapping
    alt source = MCP
        T->>M: call tool with AbortSignal
        M-->>T: result or transport error
    else source = built-in
        T->>B: call handler
        B-->>T: result
    end
    T-->>A: normalized result
    A-->>L: output or ordered interaction
```

Tool batch 在执行前应用 permission mode、文件/命令/settings 授权和问题拦截；需要用户决定时写入
ordered interaction。最后一项决定完成后创建新的 resume Run。Side-effect tool 不因 output fitting
重跑。AbortSignal 必须一直传到 MCP client/provider adapter。

一个 source-aware main-process `ToolPermissionBroker` 统一拥有 host tool consent。MCP server
`autoApprove`、session permission cache 和 server-form permission 配置已经移除；MCP App 的
same-server tool call 进入同一个 broker，且不持久化 App 专属授权。

## Agent-scoped extensions

- Agent policy 决定可用 MCP server、Plugin capability 和 Subagent slot；Skill capability 来自共享
  全局 Skills 与当前 Agent `assigned: true` binding 的交集。
- mutable package 只存放在 `<skillsRoot>/<skillName>/`。每个 Agent 的 env、runtime policy 和 script
  override 存放在自己的 binding；`.agent-scopes` 仅作为旧版迁移证据保留，runtime 不读取。
- effective Skills 是 `Session persisted selection ∩ current Agent assigned catalog`。transfer、rebind、
  fork 和 Subagent entry 都必须重新计算交集。
- 每次 Run 使用闭合 capability snapshot；同一轮中发生 unassign 或内容更新，不得改变已解析的 prompt、
  tool allow-list、script policy 或 allowed package roots。
- Agent filesystem policy 保护整个 configured Skill root；即使是 `full_access`，也只有当前 Run 的具体
  active Skill roots 可以作为例外。
- Plugin unavailable、disabled 或 uninstall 时，相关 Skill contribution 和 bindings 必须撤销，不能
  留下可执行 mapping。
- 内部 DeepChat Agent 不再是导入源；现有 package 通过 assignment 复用。外部 Agent 导入要求显式
  target Agents，先 preview，再由 main 重新扫描来源并解析 conflict。
- 外部 import 是一次性 validated snapshot，不跟随 symlink、不建立 live link，也不传播后续来源修改；
  `skip` 保留现有 Skill，`rename` 选择首个合法全局名称，`overwrite` 先重验 enabled-Agent impact。
- Plugin-owned Skills 不作为普通文件复制；外部格式 adapter 不能绕过全局 Skills containment validation。
- child Session 重新解析自己的 capability，不继承父 Session 的 assignment、active Skills 或 permission
  state。

## 调试入口

1. `src/main/agent/deepchat/loop/ports.ts`
2. `src/main/agent/deepchat/runtime/toolAdapters.ts`
3. `src/main/tool/index.ts`
4. `src/main/tool/toolMapper.ts`
5. `src/main/tool/agentTools/`
6. `src/main/tool/permission/`
7. `src/main/mcp/toolManager.ts`
8. `src/main/mcp/mcpClient.ts`
9. `src/main/skill/`
10. `src/main/plugin/`
