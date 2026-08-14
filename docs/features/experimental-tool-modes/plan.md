# 实验性工具模式实施方案

## 状态

调研与架构设计已完成，尚未开始实施。

## 目标

实现一个单一 `ToolMode = agent | code | minimal` 会话配置，并把唯一入口放进现有高级配置
Popover。模式选择直接驱动下方工具区域与 LoopRun 工具方案，不增加第二组配置、footer chip、
Agent 设置页或新工具 registry。

## 现有所有权

```text
McpIndicator.vue
  -> advanced settings popover
  -> grouped Agent tools / disabledAgentTools

ChatStatusBar.vue
  -> generation settings
  -> permission mode

draftStore / NewThreadPage
  -> first-message draft
  -> session create input

TurnCoordinator
  -> resolveForTurn(command shell)
  -> prompt + provider request
  -> LoopRun

AgentToolManager / ToolService
  -> executable tool catalog
  -> permission + dispatch + output guard + journal
```

新功能必须进入这些 owner，不另建平行设置系统或执行通道。现有
`ChatMode = 'agent' | 'acp agent'` 继续只选择 backend；ToolMode 只属于 DeepChat Agent。

## 工程约束

- 一个共享枚举、一个 nullable session 字段、一个 resolver、一个高级配置控件。
- Agent Mode 是现有行为的兼容基线。
- Code Mode 保留当前 enabled catalog，只改变 Provider presentation。
- Minimal Mode 使用严格双工具目录，不保留 MCP 或其他 Agent 工具。
- 内部 Code 协议只叫 `run_code`，不增加 `transport` 字段。
- 命令工具始终叫 `exec`，Shell 选择只写入描述、环境提示和执行快照。
- 生产工具描述与 schema 使用固定上游 fixture，禁止近似改写。
- 模型代码只在每 cell 独立的 `utilityProcess.fork()` 中运行。
- 嵌套调用必须回到现有 permission、dispatch、output guard 与 journal。
- 不新增 runtime dependency，除非 Electron `41.10.4` canary 证明内置能力无法满足固定协议。

## 实施切片

### 1. 固定上游契约

- [ ] 增加 Codex `exec`、`wait`、helpers、名称规范化与 raw JavaScript fixture。
- [ ] 增加 Codex freeform `apply_patch` 描述、V4A parser 和 partial-delta fixture。
- [ ] 增加 harness `run_code` 名称、参数、SDK 声明、result envelope fixture。
- [ ] 增加 harness `str_replace_editor` 名称、描述、schema 与错误 fixture。
- [ ] 每组 fixture 记录源码 path、固定 commit 与 license metadata。
- [ ] 明确区分 Codex 顶层 Code-cell `exec` 与 SDK 中命令工具 `tools.exec` 的内部类型。

完成条件：任一生产描述、schema、声明布局或结果 envelope 漂移都会触发 contract failure。

### 2. 增加单一 ToolMode 契约

在共享 contract 中增加：

```ts
type ToolMode = 'agent' | 'code' | 'minimal'
type ToolModeOverride = ToolMode | null
type ToolModeResolutionSource = 'session' | 'model-catalog' | 'fallback'
```

- [ ] 把 nullable override 加入 session create/read/update/export/import contract。
- [ ] 在 `new_sessions` 增加一个 nullable `tool_mode_override` CHECK 字段。
- [ ] 给 draft store 增加 nullable override，并在 `NewThreadPage` 创建会话时复制。
- [ ] 增加原子 session route，活跃 LoopRun 时拒绝更新。
- [ ] 不改动现有 `ChatMode`、`useChatMode()` 或 ACP route。

模型目录：

- [ ] 给精确登记的 GPT-5.6 Codex-compatible 条目增加 `defaultToolMode: 'code'`。
- [ ] 给精确登记且支持工具调用的 DeepSeek 条目增加 `defaultToolMode: 'code'`。
- [ ] 把 recommendation 带入一次 `ResolvedModelCapabilitySnapshot`，UI 和 adapter 不重复模型
  家族判断。
- [ ] 身份缺失、歧义或无建议时回退 Agent Mode。
- [ ] Minimal Mode 不增加自动推荐。

完成条件：解析优先级只有 session override、model catalog、fallback 三层，用户界面不存在
Auto 模式。

### 3. 建立不可变 ToolMode plan

增加主进程纯 resolver：

```ts
type ResolvedToolModePlan = {
  mode: ToolMode
  source: ToolModeResolutionSource
  commandShell: ResolvedCommandShell
  executionCatalog: readonly ExecutableToolBinding[]
  providerPresentation: readonly ProviderToolSpec[]
}
```

- [ ] `TurnCoordinator` 在 Provider I/O 前解析模型能力、ToolMode、enabled tools 与命令 Shell。
- [ ] 把 plan 冻结到 LoopRun，prompt、Provider adapter、dispatcher 与 renderer status 只消费
  该 snapshot。
- [ ] active run 中禁止修改 mode，避免中途替换 Provider schema。
- [ ] 在 preflight 校验 Provider frontend、UtilityProcess capability、权限、Shell 与工具名冲突。
- [ ] 不兼容时 fail closed，不修改已存 override，也不静默进入 Agent Mode。

完成条件：一次 LoopRun 内的模式、工具目录、Provider presentation 与 Shell 完全一致。

### 4. 实现三种目录 projection

继续使用 `ToolService` 和 `AgentToolManager` 作为唯一 registry。

Agent Mode：

- [ ] 直接复用当前 enabled tool catalog 与 Provider mapper。
- [ ] 除 `exec` 动态 Shell 描述外保持 request snapshot 不变。

Code Mode：

- [ ] 以当前 Agent Mode enabled catalog 建立 execution bindings。
- [ ] disabled tools 不进入 SDK，也不能通过 stale/伪造 binding 调用。
- [ ] 生成稳定、可缓存的 SDK 声明与 opaque binding ID。
- [ ] 规范化名称冲突在 Provider 请求前失败。

Minimal Mode：

- [ ] 完全绕过其他 Agent/MCP/plugin 目录，只建立两个 execution bindings。
- [ ] Codex-compatible 路由建立 `exec + apply_patch`。
- [ ] function-tool/harness 路由建立 `exec + str_replace_editor`。
- [ ] 切换模式不改写原有 `disabledAgentTools`；返回 Agent/Code 后恢复。

完成条件：Minimal Mode 的 model-visible 与 executable 名称集合都严格等于两个工具。

### 5. 拆分 execution catalog 与 Provider presentation

- [ ] 增加 `ProviderToolSpec = function | freeform`，不改变 `MCPToolDefinition` 的执行职责。
- [ ] Agent/Minimal Mode 继续使用 direct function/freeform presentation。
- [ ] Codex Code Mode 只展示固定 `exec`/`wait`，保留 raw input，不 JSON stringify。
- [ ] function-tool Code Mode 只展示固定 `run_code` schema。
- [ ] 两种 frontend 在 adapter 边界后归一化为同一个内部 `run_code` request/result channel。
- [ ] Provider replay 只保存外层 wrapper call/result；nested calls 只进入 DeepChat transcript 与
  journal。
- [ ] 不增加 protocol/transport 持久化字段。

完成条件：Code Mode 的 Provider request 不泄漏任何 SDK nested tool schema。

### 6. 实现编辑工具 adapter

`apply_patch`：

- [ ] 使用固定 Codex freeform 描述与 V4A parser。
- [ ] 覆盖 add/delete/update/move、顺序应用和 partial-delta error。
- [ ] 复用现有 workspace canonicalization、symlink protection、permission 与 journal。

`str_replace_editor`：

- [ ] 保留 `view | create | str_replace | insert` schema。
- [ ] 强制绝对路径、唯一 literal match 与 view range 语义。
- [ ] 复用同一安全文件 primitive，不复用不兼容的现有 `edit` 外部 schema。

完成条件：两种工具的模型可见契约与固定 fixture 一致，内部文件边界与现有 Agent 工具一致。

### 7. 构建 UtilityProcess `run_code` runtime

增加 `RunCodeRuntimeManager` 与随应用打包的 utility-host entrypoint；每个 code cell 新建一个
进程，不增加 pool 或 daemon。

主进程 manager：

- [ ] 首次 Code 请求前运行一次可缓存 capability probe。
- [ ] `app.ready` 后 fork，并等待 5 秒内带版本的 `READY` handshake。
- [ ] 每个 LoopRun 只登记一个活跃外层 cell；串行下一 cell 使用新进程。
- [ ] 用版本化、带 cell/session/run identity 的 IPC 路由嵌套请求。
- [ ] 嵌套请求只通过现有 execution port 调度。
- [ ] 管理 Codex yield/wait 与按 session 隔离、有上限的 store/load snapshot。
- [ ] 在所有终态执行同一幂等 cleanup；500 ms 后用 `kill()` 回收。
- [ ] 永不自动重启或重放失败 cell。
- [ ] active map 为空后不保留 heartbeat、RSS timer、listener、port 或 pending request。
- [ ] 在 app teardown 中先于 MCP/plugin/tool/background-exec/Provider/database owner shutdown。

Utility host：

- [ ] 每个进程只创建一个全新 `vm.Context` 并执行一个 cell。
- [ ] Codex frontend 使用 `vm.SourceTextModule`，拒绝 import linking，保留 top-level await。
- [ ] function frontend 使用 harness wrapping 与 Node erasable TypeScript，不增加 TypeScript
  runtime dependency。
- [ ] 只暴露固定 helpers 与生成 SDK，不暴露 Node/Electron globals、parent IPC、filesystem、
  network、subprocess、worker、native addon、WASI 或 inspector。
- [ ] 强制 source 256 KiB、output 1 MiB、nested concurrency 8、V8 old-space 64 MiB、
  heartbeat、VM slice、yield lease 与 RSS 限制。
- [ ] 只发送一个 terminal message，随后停止接收调用并退出。

完成条件：成功、异常、取消、超时、OOM、崩溃和 app shutdown 后，进程及全部附属资源归零。

### 8. 复用现有嵌套工具执行路径

- [ ] 把 host nested-call message 转换为普通 DeepChat tool execution request。
- [ ] 复用 execution contract、permission precheck/prompt、handler、`ToolOutputGuard`、取消与
  journal。
- [ ] 给内部 metadata 增加 parent cell ID 与 nested sequence ID。
- [ ] direct 与 nested calls 共用现有 128 次 LoopRun 预算。
- [ ] 等待 permission、用户输入、process 或 MCP 时支持父 cell cancel。
- [ ] Provider history 不展开 nested calls，DeepChat UI 保留层级。

完成条件：Code runtime 没有可以绕过现有权限、authority、输出限制或会话隔离的 handler
入口。

### 9. 扩展 Shell 选择并统一 `exec` 描述

复用 `commandShell.ts`、`CommandShellService`、`AgentBashHandler`、background execution
manager 和 `CommandShellSettingsSection.vue`。

- [ ] 扩展 preference：macOS/Linux 为 Auto、Bash、Zsh、Fish；Windows 为 Auto、Windows
  PowerShell、PowerShell 7、Command Prompt、Git Bash、WSL。
- [ ] 接入已有 `cmd` profile，新增 `powershell-core` 与受控 `wsl` profile。
- [ ] Windows Auto 不选择 Git Bash 或 WSL；显式不可用项 fail closed。
- [ ] 被动 WSL 探测只用 `--list --quiet`；显式选择后再验证 distribution、内部 Shell 与 cwd。
- [ ] WSL 使用 nonce 绑定 process group scoped cleanup，禁止 `wsl.exe --terminate`。
- [ ] 抽取一个 Shell facts formatter，同时供 `buildCommandShellPromptLine()` 与 `exec` 描述使用。
- [ ] `exec` 名称、schema、disabled-tool、permission、dispatch、journal 和 replay 始终保持稳定。
- [ ] Shell 切换只影响下一次 LoopRun；已有 process handle 绑定创建时 snapshot。

完成条件：模型看到的 Shell、实际 executable/args 和 permission signature 来自同一个
`ResolvedCommandShell`。

### 10. 修改现有高级配置 UI

只修改现有 `McpIndicator.vue` 所有权边界，并复用当前 Popover、button、switch 与工具分组：

- [ ] 在「模型设置」与 `TOOLS` 之间增加 MODE radio group。
- [ ] 三项固定为 Agent Mode、Code Mode、Minimal Mode；不显示 Auto。
- [ ] 增加低强调「使用模型默认」动作，清除 nullable override。
- [ ] 点击后立即更新本地工具 projection，持久化失败时回滚。
- [ ] Agent Mode 保持当前工具分组 UI。
- [ ] Code Mode 显示实际 code 入口，并把现有 enabled groups 标记为「Code 可调用工具」。
- [ ] Minimal Mode 只渲染两个固定工具，隐藏 MCP/plugin 与其他 Agent groups。
- [ ] active LoopRun、permission prompt 或 code cell 期间禁用切换。
- [ ] unavailable mode 显示具体原因，但不暴露 protocol、transport 或 runtime 常规配置。
- [ ] 所有文案进入 `vue-i18n`，radio、焦点返回与 screen-reader 状态完整。

ASCII 目标：

```text
高级配置
+-------------------------------------------+
| 系统提示词                                |
| 模型设置                                  |
+-------------------------------------------+
| MODE                                      |
| [ Agent Mode ][ Code Mode ][Minimal Mode] |
|                              ^ selected   |
+-------------------------------------------+
| TOOLS                                     |
| 编码工具  [ exec ] [ apply_patch ]        |
+-------------------------------------------+
```

不增加 footer chip、独立设置页或 Agent 模型覆盖编辑器。

完成条件：模式选择与下方工具投影是一个面板内的直接因果关系，用户不需要理解 Tool set、
Calling、Provider frontend 或 UtilityProcess。

### 11. Runtime transcript 与错误投影

- [ ] Code Mode 外层 card 显示 code cell 状态与 nested call 数量。
- [ ] nested calls 复用现有工具 card、权限按钮、输出、取消和错误 UI。
- [ ] source 与 SDK 声明只放在展开详情，不成为常驻 transcript 噪声。
- [ ] UtilityProcess 启动、协议、超时、OOM、崩溃与 cleanup 错误使用稳定错误码。
- [ ] Minimal/Code 不兼容、权限不足、Shell 不可用时在发送前给出可操作错误。

完成条件：用户能定位失败和恢复，但高级配置正常状态不显示底层协议详情。

### 12. 全量审查与验证

实现完成后再决定最小耐久测试集，优先保留这些跨边界契约：

- [ ] 单字段 migration、draft 提升、session 重启记忆与清除 override。
- [ ] 精确模型 recommendation、身份歧义和 fallback。
- [ ] 三种 mode 的 model-visible/executable tool name snapshot。
- [ ] Agent Mode request regression；除 `exec` 描述外无变化。
- [ ] Codex/harness fixture、freeform streaming 与 Provider replay。
- [ ] Minimal Mode 无法通过 stale binding 调用第三个工具。
- [ ] nested permission、cancel、output guard、journal 与共享预算。
- [ ] UtilityProcess capability、malformed IPC、constructor escape、import、无限循环、OOM、
  timeout、cancel、crash 与 teardown soak。
- [ ] Shell profile、描述/prompt/execution 同源、WSL scoped cleanup。
- [ ] 高级配置 radio、即时 projection、回滚、disabled state、键盘与焦点。

质量门：

```text
pnpm format
pnpm i18n
pnpm lint
pnpm typecheck
pnpm test:main -- <相关测试>
pnpm test:renderer -- <相关测试>
```

只提交能保护用户可见行为、持久化、协议、安全边界、生命周期与已证实回归的测试；不保留
实现耦合的临时 probe。

## 完成定义

- [ ] UI 只有一个三态 Tool Mode 控件，且只位于高级配置。
- [ ] GPT-5.6/DeepSeek 目录默认 Code，其他默认 Agent，Minimal 只由用户选择。
- [ ] Agent、Code、Minimal 的工具目录和 Provider presentation 与规范一致。
- [ ] 内部只有一个 `run_code` runtime，没有 transport/protocol 用户配置。
- [ ] `exec` 名称稳定，Shell 信息与执行同源。
- [ ] 每条 UtilityProcess 终态都可证明没有进程、timer、listener、port 或 pending request 泄漏。
- [ ] 文档、ASCII、视觉稿、实现和测试使用同一套三模式术语。
