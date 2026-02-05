# ACP 用户体验问题调研报告

> 针对 ACP 集成中体验割裂问题的深入调研
>
> 日期: 2025-01

## 问题概述

用户反馈的三个核心问题：

1. **设置项获取时机问题**：ACP 的设置项（如 mode/model）必须有 workdir 并初始化 session 才能获取，但用户希望能提前设置
2. **配置项不完整**：ACP 本身可配置的内容应该还有更多
3. **Workdir 切换问题**：ACP 使用过程中需要能够切换 workdir

---

## 问题 1: Mode/Model 获取时机

### 1.1 当前实现分析

DeepChat 实现了**两层模式系统**来尝试解决这个问题：

```
┌─────────────────────────────────────────────────────────────┐
│                    进程级 (Warmup)                          │
│  - 触发：用户【手动选择】workdir 后                         │
│  - 创建：useAcpWorkdir.selectWorkdir() 调用 warmupProcess()│
│  - 查询：useAcpMode.loadWarmupModes() 只查询已存在的进程   │
│  - 问题：如果用户未手动选择 workdir，进程不会被创建！       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    会话级 (Session)                         │
│  - 触发：开始对话，创建 session                             │
│  - 调用：sessionManager.getOrCreateSession()               │
│  - 作用：实际使用的 modes/models                            │
│  - 存储：AcpSessionRecord (内存) + SQLite (持久化)         │
└─────────────────────────────────────────────────────────────┘
```

**关键问题**：`loadWarmupModes()` 只是查询已存在的 warmup 进程，并不会创建进程。
warmup 进程只在 `selectWorkdir()` 中被创建，这意味着用户必须先手动选择 workdir 才能预加载 modes。

### 1.2 核心限制

**为什么需要 workdir？**

```typescript
// acpProcessManager.ts - warmupProcess()
const handle = await this.spawnProcess(agent, workdir)
// ↑ 进程必须在特定目录启动，因为：
// 1. Agent 可能根据 workdir 返回不同的 modes/models
// 2. Agent 可能需要读取 workdir 下的配置文件
```

**为什么需要 session？**

```typescript
// ACP 协议定义 - NewSessionResponse
interface NewSessionResponse {
  sessionId: string
  modes?: SessionModeState | null    // ← modes 在 session 响应中返回
  models?: SessionModelState | null  // ← models 在 session 响应中返回
}
```

ACP 协议设计上，modes/models 是**会话级别**的概念，必须通过 `newSession` RPC 获取。

### 1.3 当前的缓解措施（存在缺陷）

DeepChat 尝试通过 **warmup 进程** 解决这个问题，但实现存在缺陷：

```typescript
// useAcpMode.ts - loadWarmupModes()
const loadWarmupModes = async () => {
  if (!isAcpModel.value || hasConversation.value) return
  // ...
  // 只是查询已存在的进程，不会创建！
  const result = await sessionPresenter.getAcpProcessModes(agentId, workdir)
}

// useAcpWorkdir.ts - selectWorkdir()
const selectWorkdir = async () => {
  // ...
  // warmup 进程只在这里被创建
  await warmupProcess(selectedPath)
}
```

**问题链**：
```
用户选择 ACP agent
    ↓
loadWarmupModes() 被调用
    ↓
getAcpProcessModes() 查询进程
    ↓
进程不存在，返回 undefined
    ↓
modes 无法预加载！
    ↓
用户必须先手动选择 workdir
    ↓
selectWorkdir() 创建 warmup 进程
    ↓
再次 loadWarmupModes() 才能获取 modes
```

**根本问题**：`loadWarmupModes()` 应该在查询失败时主动创建 warmup 进程，而不是仅仅查询。

### 1.4 可能的改进方向

| 方案 | 描述 | 可行性 |
|------|------|--------|
| **A. 内置 tmp 目录** | 使用应用内置的 tmp 目录作为默认 workdir | ⭐⭐⭐⭐ 推荐 |
| **B. 缓存历史** | 缓存用户使用过的 workdir 的 modes/models | ⭐⭐⭐ 可行 |
| **C. Agent 元数据** | 在 Agent 配置中静态定义支持的 modes/models | ⭐⭐ 需要维护 |
| **D. 协议扩展** | 在 initialize 阶段返回 modes/models | ⭐ 需要协议修改 |

#### 推荐方案：内置 tmp 目录

**为什么不用 home 目录**：
- Agent 可能在 workdir 中执行文件操作（读写文件、执行命令）
- 使用 home 目录有安全风险，可能影响用户的个人文件

**推荐做法**：
- 类似 skills 系统，使用应用内置的 tmp 目录
- 例如：`app.getPath('userData')/acp-warmup-tmp/`
- 该目录仅用于 warmup 阶段获取 modes/models 配置
- 实际对话时仍使用用户选择的 workdir

**改进流程**：
```
用户切换到 ACP agent
    ↓
检查是否有用户选择的 workdir
    ↓
如果没有，使用内置 tmp 目录
    ↓
自动触发 warmupProcess(tmpDir)
    ↓
获取 modes/models 配置
    ↓
UI 显示可用的 modes/models
    ↓
用户可以提前设置首选 mode/model
    ↓
用户选择实际 workdir 后开始对话
```

---

## 问题 2: ACP 协议支持的完整配置项

### 2.1 协议定义的配置项

根据 `@agentclientprotocol/sdk@0.5.1` 的类型定义：

#### 客户端能力 (ClientCapabilities)

```typescript
interface ClientCapabilities {
  fs?: {
    readTextFile?: boolean   // 文件读取
    writeTextFile?: boolean  // 文件写入
  }
  terminal?: boolean         // 终端命令执行
}
```

**DeepChat 当前实现**：✅ 全部支持

#### Agent 能力 (AgentCapabilities)

```typescript
interface AgentCapabilities {
  loadSession?: boolean           // 会话加载/恢复
  mcpCapabilities?: {
    http?: boolean                // HTTP MCP 传输
    sse?: boolean                 // SSE MCP 传输
  }
  promptCapabilities?: {
    audio?: boolean               // 音频输入
    image?: boolean               // 图像输入
    embeddedContext?: boolean     // 嵌入式上下文
  }
}
```

**DeepChat 当前实现**：
- ✅ mcpCapabilities - 支持
- ⚠️ loadSession - 未实现
- ⚠️ promptCapabilities.audio - 未实现
- ✅ promptCapabilities.image - 支持
- ✅ promptCapabilities.embeddedContext - 支持

#### 会话级配置

| 配置项 | RPC 方法 | DeepChat 实现 |
|--------|---------|--------------|
| Mode | `setSessionMode` | ✅ 已实现 |
| Model | `setSessionModel` | ✅ 已实现 |
| MCP Servers | `newSession.mcpServers` | ✅ 已实现 |
| Working Directory | `newSession.cwd` | ✅ 已实现 |

### 2.2 未充分利用的功能

#### A. Available Commands (可用命令)

```typescript
// ACP 协议定义
interface AvailableCommand {
  name: string           // 命令名 (如 "create_plan", "research_codebase")
  description: string    // 命令描述
  input?: {
    hint: string         // 输入提示
  }
}
```

**当前实现**：仅打印日志，未暴露给 UI

```typescript
// acpContentMapper.ts
case 'available_commands_update':
  console.info('[ACP] Available commands update:', ...)
  break  // ← 没有实际处理
```

**改进建议**：
- 在 UI 中显示可用命令列表
- 支持用户通过 UI 触发命令
- 类似 Slack 的 `/command` 体验

#### B. Load Session (会话加载)

```typescript
// ACP 协议定义
interface LoadSessionRequest {
  cwd: string
  mcpServers: McpServer[]
  sessionId: string      // 要恢复的会话 ID
}
```

**当前实现**：未实现

**改进建议**：
- 支持会话持久化和恢复
- 用户可以继续之前的对话
- 跨应用重启保持上下文

#### C. Authentication (认证)

```typescript
// ACP 协议定义
interface AuthMethod {
  id: string
  name: string
  description?: string
}
```

**当前实现**：未实现

**改进建议**：
- 支持需要认证的 Agent
- OAuth/API Key 等认证方式

### 2.3 Notification 类型处理情况

| Notification 类型 | 描述 | DeepChat 实现 |
|------------------|------|--------------|
| `user_message_chunk` | 用户消息回显 | ✅ 忽略 (正确) |
| `agent_message_chunk` | Agent 消息 | ✅ 已实现 |
| `agent_thought_chunk` | Agent 思考 | ✅ 已实现 |
| `tool_call` | 工具调用 | ✅ 已实现 |
| `tool_call_update` | 工具调用更新 | ✅ 已实现 |
| `plan` | 计划 | ✅ 已实现 |
| `current_mode_update` | 模式变更 | ✅ 已实现 |
| `available_commands_update` | 可用命令 | ⚠️ 仅日志 |

---

## 问题 3: Workdir 切换机制

### 3.1 当前实现

```typescript
// acpProvider.ts - updateAcpWorkdir()
async updateAcpWorkdir(conversationId: string, workdir: string | null) {
  const previous = existing?.workdir ?? null
  const previousResolved = this.sessionPersistence.resolveWorkdir(previous)
  const nextResolved = this.sessionPersistence.resolveWorkdir(trimmed)

  if (previousResolved !== nextResolved) {
    // workdir 变更时，清理旧会话
    await this.sessionManager.clearSession(conversationId)
  }
}
```

**关键行为**：
1. Workdir 变更会**清理当前会话**
2. 下次对话时创建新会话（新 workdir）
3. **对话历史会丢失**

### 3.2 限制原因

```
┌─────────────────────────────────────────────────────────────┐
│  为什么不能在会话中切换 workdir？                            │
├─────────────────────────────────────────────────────────────┤
│  1. 进程已在特定目录启动，无法改变其 cwd                     │
│  2. 会话已初始化，ACP 协议不支持重新初始化                   │
│  3. Agent 的上下文可能依赖于 workdir                        │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 当前用户体验

```
用户选择 workdir A → 开始对话 → 想切换到 workdir B
                                      ↓
                              当前会话被清理
                                      ↓
                              对话历史丢失
                                      ↓
                              需要重新开始对话
```

### 3.4 可能的改进方向

| 方案 | 描述 | 复杂度 | 用户体验 |
|------|------|--------|---------|
| **A. 保留历史** | 切换时保存对话历史，新会话中显示 | 中 | ⭐⭐⭐ |
| **B. 多会话** | 支持同一对话中多个 workdir 会话 | 高 | ⭐⭐⭐⭐ |
| **C. 确认提示** | 切换前提示用户会话将被清理 | 低 | ⭐⭐ |
| **D. 会话恢复** | 利用 loadSession 恢复之前的会话 | 中 | ⭐⭐⭐⭐ |

---

## 总结与建议

### 优先级排序

| 优先级 | 问题 | 建议方案 |
|--------|------|---------|
| **P0** | Workdir 切换体验 | 方案 C (确认提示) + 方案 A (保留历史) |
| **P1** | 提前设置 mode/model | 方案 A (默认 workdir) + 方案 B (缓存历史) |
| **P2** | Available Commands | 在 UI 中展示和触发 |
| **P3** | Load Session | 实现会话恢复功能 |

### 快速改进建议

1. **Workdir 切换确认**
   - 切换前弹出确认对话框
   - 告知用户当前会话将被清理

2. **Mode/Model 缓存**
   - 缓存每个 agent 最近使用的 modes/models
   - 在设置页面显示历史选项

3. **Available Commands UI**
   - 在聊天输入框添加 `/` 命令支持
   - 显示 Agent 提供的可用命令

### 需要协议支持的改进

1. **Initialize 阶段返回 modes/models**
   - 需要 ACP 协议修改
   - 允许在无 session 时获取配置

2. **会话内 workdir 切换**
   - 需要 ACP 协议支持 `setSessionWorkdir`
   - 或支持会话迁移

---

## 附录：关键代码位置

| 功能 | 文件 | 行号 |
|------|------|------|
| Warmup modes 加载 | `useAcpMode.ts` | 77-100 |
| Session modes 加载 | `useAcpMode.ts` | 50-75 |
| Workdir 更新 | `acpProvider.ts` | 415-433 |
| Available commands 处理 | `acpContentMapper.ts` | 58-63 |
| Session 创建 | `acpSessionManager.ts` | 166-287 |
