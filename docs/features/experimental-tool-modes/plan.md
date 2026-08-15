# 实验性工具模式实施方案

状态：已完成。

## 实施范围

本功能只增加一个 `ToolMode = agent | code | minimal`，入口只位于现有高级配置 Popover。
实现继续使用现有 session、model capability、ToolService、AgentToolManager、permission、Shell
和 Provider adapter 所有权，不建立第二套 registry 或设置系统。

## 最终数据流

```text
draft/session toolModeOverride
          + model capability default
          + current enabled tools
          + ResolvedCommandShell
                     |
                     v
              TurnCoordinator
                     |
          +----------+-----------+
          |          |           |
        Agent       Code              Minimal
          |          |                   |
   direct tools   wrapper       reduced file tools
                     |          + enabled capabilities
             RunCodeRuntimeManager       |
                     |                    |
          utilityProcess per code cell   |
                     |                    |
          opaque nested-call IPC         |
                     |                    |
                     +----- ToolService --+
                     |
       existing authority / permission / handlers
```

## 已完成切片

### 1. ToolMode 契约、默认值与持久化

- [x] 增加共享 `ToolMode`、nullable override 和三层 resolver。
- [x] 在 schema v68 为 `new_sessions` 增加带 CHECK 的 `tool_mode_override`。
- [x] 打通 session create/read/update、draft 提升、fork 和 renderer store。
- [x] 增加 typed `sessions.setToolMode` route；DeepChat 运行中拒绝更新。
- [x] LoopRun 冻结 resolved mode，避免同一回复中切换 Provider schema。
- [x] 精确登记 GPT-5.6 型号与 DeepSeek 工具模型默认 Code；其他模型回退 Agent。
- [x] 支持模型目录显式 `default_tool_mode`。

主要所有者：

- `src/shared/toolMode.ts`
- `src/main/session/data/tables/newSessions.ts`
- `src/main/session/assignment.ts`
- `src/renderer/src/stores/ui/draft.ts`
- `src/renderer/src/stores/ui/session.ts`
- `src/main/provider/modelCapabilities.ts`

### 2. 三种工具 projection

- [x] Agent Mode 继续使用当前完整目录。
- [x] Code Mode 把完整执行目录隐藏在一个 code wrapper 后面。
- [x] Codex frontend 只显示 raw `exec` 和 `wait`。
- [x] function-tool frontend 只显示 `run_code` 和生成的 TypeScript SDK。
- [x] SDK 嵌套工具统一称为 subtools，并声明只能在 code 入口内部调用。
- [x] Minimal Mode 用 `exec + process + apply_patch` 替换 `openai-codex` 的细粒度文件工具。
- [x] Minimal Mode 用 `exec + process + str_replace_editor` 替换其他 Provider 的细粒度文件
      工具。
- [x] Minimal Mode 保留当前已启用的非文件 Agent、MCP 和插件能力，不强制启用被禁用工具。
- [x] direct call、unsafe name、保留名和规范化冲突 fail closed。
- [x] 从 Code SDK 与 nested execution binding 排除 `deepchat_question` 和
      `deepchat_subagents`，并在可用时把两者保留为顶层 Provider tools。
- [x] Code Mode 只允许上述两个 Loop 工具直接调用，其他 subtools 继续拒绝顶层 direct call。
- [x] 验证 Agent、Code、Minimal 使用独立 projection，Code catalog 调整不改变其他模式。
- [x] freeform input 在 AI SDK stream 中保持 raw string。
- [x] Code 与 Minimal 不叠加 Tool Surface 虚拟化，Agent 保持原有 Tool Surface 行为。

主要所有者：

- `src/main/tool/index.ts`
- `src/main/tool/codeMode/toolModeTools.ts`
- `src/main/provider/aiSdk/toolMapper.ts`
- `src/main/provider/aiSdk/streamAdapter.ts`
- `src/main/agent/deepchat/runtime/turnCoordinator.ts`

### 3. Minimal 编辑工具

- [x] 实现 V4A `apply_patch` parser 与 add/delete/update/move 执行。
- [x] 实现 `str_replace_editor` 的 view/create/str_replace/insert。
- [x] 保留绝对路径、唯一 literal match、view range 和输出截断语义。
- [x] 复用现有 workspace、protected Skill、session path 和 symlink 校验。
- [x] 新建多层目录文件时验证最近现存祖先，拒绝 symlink escape。
- [x] 多 operation patch 在首次写入前完成纯校验；I/O 部分失败时要求重新查看受影响文件。
- [x] 写入前接入现有 effect/journal commit callback。

主要所有者：

- `src/main/tool/agentTools/minimalEditorAdapter.ts`
- `src/main/tool/agentTools/agentToolManager.ts`
- `src/main/tool/agentTools/agentFileSystemHandler.ts`

### 4. UtilityProcess Code runtime

- [x] 增加独立 Vite entry，并用 `utilityProcess.fork()` 为每个 cell 新建进程。
- [x] 增加版本化 READY/START/NESTED_CALL/NESTED_RESULT/YIELDED/RESULT/ERROR/STOP 协议。
- [x] context 内生成 `tools` 和 helpers，不直接暴露 outer-realm tool function。
- [x] 参数、结果、store 通过 JSON 边界；结构化 MCP output 优先返回给代码。
- [x] 禁止 string code generation、WASM、Node/Electron globals 和 import linking。
- [x] 实现 TypeScript erasable syntax、Codex raw JavaScript、yield/wait 和 session store。
- [x] 嵌套命令权限在同一 cell 与同一外层 tool-call ID 内按调用签发 one-shot grant 并原地恢复，
      不重放已完成代码。
- [x] 每个 wrapper 与每个 nested subtool 分别提交 execution-journal dispatch/outcome；外层结算
      等待所有已 dispatch 的 nested operation 完成。
- [x] 顶层 Agent Loop 继续负责 `deepchat_question` 和 `deepchat_subagents` 的确认、暂停、恢复与
      持久状态，Code cell 不调用或等待这两个工具。
- [x] 实现 source/output/call/concurrency/heap/RSS/heartbeat/yield/permission lease 限制。
- [x] cleanup 取消嵌套调用，清 timer/listener/map，并在 grace 后 `kill()`。
- [x] app teardown 在 MCP/plugin 等执行 owner 销毁前关闭 Code runtime。

主要所有者：

- `src/shared/codeModeProtocol.ts`
- `src/main/codeModeUtilityHostEntry.ts`
- `src/main/tool/codeMode/codeModeUtilityHost.ts`
- `src/main/tool/codeMode/runCodeRuntimeManager.ts`
- `electron.vite.config.ts`
- `src/main/app/composition.ts`

### 5. Shell 统一

- [x] `exec` 在所有模式中保持同名。
- [x] 从 resolved Shell 生成工具描述和系统环境提示。
- [x] macOS/Linux 增加 Bash、Zsh、Fish 显式选择。
- [x] Windows 增加 PowerShell 7 和 Command Prompt，并保留 Windows PowerShell、Git Bash。
- [x] 显式不可用 Shell fail closed；PowerShell 7 和 Git Bash 做可用性检查。
- [x] background exec 和 skill script 接受新增 profile。

WSL 不在本次范围内；需要先完成 distribution、cwd 映射和 scoped process-group cleanup。

主要所有者：

- `src/shared/commandShell.ts`
- `src/main/agent/shared/process/commandShellService.ts`
- `src/main/agent/deepchat/resources/systemEnvPromptBuilder.ts`
- `src/renderer/settings/components/common/CommandShellSettingsSection.vue`

### 6. 高级配置 UI

- [x] 在模型设置与 `TOOLS` 之间增加三项 `RadioGroup`。
- [x] 使用现有 `DcPopover`、`DcButton`、`RadioGroup`、`Switch` 和 design token。
- [x] 显示模型默认来源和「使用模型默认」操作。
- [x] 选择后立即投影工具，持久化失败时回滚。
- [x] Agent、Code、Minimal 分别显示原目录、code 入口加顶层 Loop 工具与 code-callable 目录，
      以及精简文件工具加其他已启用能力。
- [x] Minimal Mode 保持 MCP 与插件列表可见，不再因为模式本身隐藏这些区域。
- [x] Code Mode 的 Subagent 继续使用原有工具卡、Activity 与侧边栏；code wrapper 只显示 cell
      和 nested-call 摘要。
- [x] session 工作中禁用切换。
- [x] 文案进入 20 个 locale，并保留 aria/radio/disabled 语义。

```text
BEFORE
高级配置
├─ 系统提示词
├─ 模型设置
└─ TOOLS

AFTER
高级配置
├─ 系统提示词
├─ 模型设置
├─ MODE  [Agent] [Code] [Minimal]
│         模型默认                  使用模型默认
└─ TOOLS  （随模式立即投影）
```

主要所有者：

- `src/renderer/src/components/chat-input/McpIndicator.vue`
- `src/renderer/src/i18n/*/chat.json`
- `src/renderer/src/i18n/*/settings.json`

## 基线验证

已通过：

```text
pnpm format
pnpm i18n
pnpm lint
pnpm typecheck
pnpm build
```

完整 Vitest 结果：

```text
main:     578 files passed, 29 skipped
          7870 tests passed, 433 skipped
renderer: 254 files passed
          2126 tests passed
```

现有耐久测试覆盖：

- ToolMode 精确默认值、override、schema CHECK 和三种 projection；
- Codex/function wrapper、freeform editor 和 SDK 契约；
- Utility context constructor escape、结果/store 序列化、取消和 listener cleanup；
- nested structured output、调用调度和 active call abort；
- nested dispatch/outcome 审计、外层结算顺序和 permission lease 回收；
- apply patch、literal replacement、view range、missing-parent 与 symlink escape；
- POSIX/Windows Shell profile 和设置 UI；
- 高级配置即时 projection、持久化和 working disabled state。

`newSessionsTable` 的 7 个用例在当前测试进程中因 native SQLite binding 不可用而按仓库既有
规则跳过；对应 schema、route 和类型检查均已通过，生产构建成功生成 v68 migration。

本次增量验证覆盖：

- Code SDK 排除 `deepchat_question` 和 `deepchat_subagents`，Provider 顶层目录按可用性保留
  这两个 Loop 工具；
- 只有这两个 Loop 工具可以绕过 code 入口直接调用，其他 direct call 继续 fail closed；
- Subagent 确认与子 Session 生命周期仍由顶层 Loop 和 live-delegation runtime 持有；
- Minimal projection 只替换文件工具，并保留 enabled/disabled、MCP、插件和 Subagent 能力；
- 三种模式连续切换不会污染彼此的 execution catalog 或 UI projection；
- DeepChat Loop 使用专用 `programmaticExecutionJournal` 提交 nested dispatch/outcome，不再依赖
  `TapeService` 上不存在的可选方法。

## 人工验收路径

1. 新建 GPT-5.6 或 DeepSeek 工具模型会话，打开高级配置，确认默认选中 Code Mode。
2. 切换 Minimal Mode，确认细粒度文件工具被替换为 `exec`、`process` 与 `apply_patch` 或
   `str_replace_editor`，其他已启用能力以及 MCP/插件列表仍存在。
3. 切回 Agent Mode，确认原 disabled-tool 开关仍保持。
4. 点击「使用模型默认」，重开会话，确认 override 已清除并按模型重新解析。
5. 发送 Code Mode 请求，确认 Provider 收到 `exec`/`wait` 或 `run_code`，以及当前可用的
   `deepchat_question`、`deepchat_subagents`。
6. 运行长 cell 后用 `wait` 续跑或终止，确认 UtilityProcess 最终退出。
7. 在通用设置切换 Shell，确认 `exec` 名称不变，描述与实际 executable 同步。
8. 在 Code Mode 直接调用 `deepchat_question`，确认顶层 Loop 正常挂起并在用户回答后恢复。
9. 在 Code Mode 直接调用 `deepchat_subagents`，确认显式策略仍通过原生 Loop 请求批准，并正常
   展示 Subagent 工具卡和 Activity。
10. 确认 `update_plan`、CronJob、文件、MCP 和插件工具仍只能在 code 入口中作为 subtools 调用。

## 后续边界

- WSL 只有在 scoped cleanup 与 cwd translation 完成后才能加入。
- `deepchat_question` 和 `deepchat_subagents` 继续留在顶层 Agent Loop，不进入 Code nested SDK。
- Code Mode transcript 的嵌套层级可作为独立 UI 增强，不改变当前协议与执行边界。
