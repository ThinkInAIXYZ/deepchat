# ACP 用户体验增强设计规格

> 基于 ux-issues-research.md 调研结果的改进设计
>
> 状态: 设计中
> 日期: 2025-01

## 1. 概述

### 1.1 目标

解决 ACP 集成中的三个核心体验问题：

1. **Mode/Model 提前获取**：用户切换到 ACP agent 时，无需手动选择 workdir 即可获取和设置 mode/model
2. **Available Commands 展示**：在 UI 中展示 Agent 提供的可用命令
3. **Workdir 切换体验**：切换 workdir 时提供确认提示，保留对话历史显示

### 1.2 非目标

- 修改 ACP 协议本身
- 实现 loadSession（会话恢复）功能
- 实现 Authentication（认证）功能

---

## 2. 设计方案

### 2.1 Mode/Model 提前获取

#### 2.1.1 核心思路

引入**配置专用 warmup 目录**，在用户切换到 ACP agent 时自动创建 warmup 进程获取配置。

```
┌─────────────────────────────────────────────────────────────┐
│                    配置获取流程（改进后）                    │
├─────────────────────────────────────────────────────────────┤
│  用户切换到 ACP agent                                       │
│      ↓                                                      │
│  检查是否有用户选择的 workdir                               │
│      ↓                                                      │
│  [有] → 使用用户 workdir 创建 warmup                        │
│  [无] → 使用内置 tmp 目录创建 warmup                        │
│      ↓                                                      │
│  自动触发 warmupProcess()                                   │
│      ↓                                                      │
│  获取 modes/models 配置                                     │
│      ↓                                                      │
│  UI 显示可用的 modes/models                                 │
└─────────────────────────────────────────────────────────────┘
```

#### 2.1.2 配置专用目录

```typescript
// 位置：src/main/presenter/agentPresenter/acp/acpProcessManager.ts

// 新增：获取配置专用 warmup 目录
getConfigWarmupDir(): string {
  const userDataPath = app.getPath('userData')
  const warmupDir = path.join(userDataPath, 'acp-config-warmup')

  // 确保目录存在
  if (!fs.existsSync(warmupDir)) {
    fs.mkdirSync(warmupDir, { recursive: true })
  }

  return warmupDir
}
```

#### 2.1.3 自动 Warmup 触发

```typescript
// 位置：src/renderer/src/components/chat-input/composables/useAcpMode.ts

// 改进 loadWarmupModes
const loadWarmupModes = async () => {
  if (!isAcpModel.value || hasConversation.value) return
  if (!agentId.value) return

  // 确定 warmup 目录：优先用户选择，否则使用配置专用目录
  const warmupDir = selectedWorkdir.value || null

  // 先查询已存在的进程
  let result = await sessionPresenter.getAcpProcessModes(agentId.value, warmupDir)

  // 如果进程不存在，主动创建
  if (!result?.availableModes) {
    await sessionPresenter.ensureAcpWarmup(agentId.value, warmupDir)
    result = await sessionPresenter.getAcpProcessModes(agentId.value, warmupDir)
  }

  if (result?.availableModes) {
    availableModes.value = result.availableModes
    currentMode.value = result.currentModeId ?? result.availableModes[0]?.id ?? 'default'
  }
}
```

#### 2.1.4 新增 API

```typescript
// SessionPresenter 新增方法
interface SessionPresenter {
  /**
   * 确保 ACP agent 的 warmup 进程存在
   * 如果 workdir 为 null，使用配置专用目录
   */
  ensureAcpWarmup(agentId: string, workdir: string | null): Promise<void>
}
```

---

### 2.2 Available Commands 展示

#### 2.2.1 核心思路

将 `available_commands_update` 通知转换为 UI 可用的命令列表，支持用户通过 `/` 触发。

#### 2.2.2 数据流

```
Agent 发送 available_commands_update
    ↓
AcpContentMapper 处理通知
    ↓
发送事件到 Renderer
    ↓
useAcpCommands composable 接收
    ↓
ChatInput 显示命令列表
```

#### 2.2.3 类型定义

```typescript
// src/shared/types/acp.ts

interface AcpCommand {
  name: string
  description: string
  input?: {
    hint: string
  }
}

// 事件类型
interface AcpCommandsUpdateEvent {
  sessionId: string
  commands: AcpCommand[]
}
```

#### 2.2.4 事件定义

```typescript
// src/main/events.ts

ACP_WORKSPACE_EVENTS = {
  SESSION_MODES_READY: 'acp-workspace:session-modes-ready',
  SESSION_MODELS_READY: 'acp-workspace:session-models-ready',
  // 新增
  COMMANDS_UPDATE: 'acp-workspace:commands-update'
}
```

#### 2.2.5 ContentMapper 改进

```typescript
// src/main/presenter/agentPresenter/acp/acpContentMapper.ts

case 'available_commands_update':
  // 改进：发送事件到 Renderer
  this.emitCommandsUpdate(sessionId, update.availableCommands ?? [])
  break

private emitCommandsUpdate(sessionId: string, commands: AcpCommand[]) {
  eventBus.sendToRenderer(
    ACP_WORKSPACE_EVENTS.COMMANDS_UPDATE,
    SendTarget.ALL_WINDOWS,
    { sessionId, commands }
  )
}
```

#### 2.2.6 Renderer Composable

```typescript
// src/renderer/src/components/chat-input/composables/useAcpCommands.ts

export function useAcpCommands(options: UseAcpCommandsOptions) {
  const commands = ref<AcpCommand[]>([])

  const handleCommandsUpdate = (event: AcpCommandsUpdateEvent) => {
    if (event.sessionId === currentSessionId.value) {
      commands.value = event.commands
    }
  }

  onMounted(() => {
    window.electron.on(ACP_WORKSPACE_EVENTS.COMMANDS_UPDATE, handleCommandsUpdate)
  })

  onUnmounted(() => {
    window.electron.off(ACP_WORKSPACE_EVENTS.COMMANDS_UPDATE, handleCommandsUpdate)
  })

  return { commands }
}
```

---

### 2.3 Workdir 切换体验

#### 2.3.1 核心思路

1. 切换 workdir 前显示确认对话框
2. 切换后保留对话历史显示（只读）
3. 新会话从新 workdir 开始

#### 2.3.2 确认对话框

```typescript
// src/renderer/src/components/chat-input/composables/useAcpWorkdir.ts

const selectWorkdir = async () => {
  // ... 选择目录逻辑

  // 如果已有会话，显示确认对话框
  if (hasConversation.value && workdir.value !== selectedPath) {
    const confirmed = await showWorkdirChangeConfirm({
      currentWorkdir: workdir.value,
      newWorkdir: selectedPath,
      message: t('acp.workdirChangeWarning')
    })

    if (!confirmed) return
  }

  // 继续切换逻辑
}
```

#### 2.3.3 对话历史保留

```typescript
// 切换 workdir 时的处理
const handleWorkdirChange = async (newWorkdir: string) => {
  // 1. 标记当前会话为"已归档"状态
  await sessionPresenter.archiveAcpSession(conversationId.value)

  // 2. 设置新 workdir（会清理 session，但保留消息历史）
  await sessionPresenter.setAcpWorkdir(conversationId.value, agentId.value, newWorkdir)

  // 3. UI 显示分隔线，表示 workdir 已切换
  // 消息历史仍然可见，但标记为"来自之前的 workdir"
}
```

---

## 3. 文件变更清单

### 3.1 Main Process

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/main/events.ts` | 修改 | 新增 `COMMANDS_UPDATE` 事件 |
| `src/main/presenter/agentPresenter/acp/acpProcessManager.ts` | 修改 | 新增 `getConfigWarmupDir()` 方法 |
| `src/main/presenter/agentPresenter/acp/acpContentMapper.ts` | 修改 | 处理 `available_commands_update` |
| `src/main/presenter/sessionPresenter/index.ts` | 修改 | 新增 `ensureAcpWarmup()` 方法 |
| `src/main/presenter/llmProviderPresenter/index.ts` | 修改 | 新增 `ensureAcpWarmup()` 方法 |
| `src/main/presenter/llmProviderPresenter/providers/acpProvider.ts` | 修改 | 新增 `ensureWarmup()` 方法 |

### 3.2 Renderer Process

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/renderer/src/components/chat-input/composables/useAcpMode.ts` | 修改 | 改进 `loadWarmupModes()` |
| `src/renderer/src/components/chat-input/composables/useAcpWorkdir.ts` | 修改 | 添加确认对话框 |
| `src/renderer/src/components/chat-input/composables/useAcpCommands.ts` | 新增 | 命令列表 composable |

### 3.3 Shared Types

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/shared/types/presenters/session.presenter.d.ts` | 修改 | 新增 `ensureAcpWarmup` 类型 |
| `src/shared/types/acp.ts` | 新增 | ACP 相关类型定义 |

---

## 4. 实现计划

### Phase 1: Mode/Model 提前获取

1. 实现 `getConfigWarmupDir()` 方法
2. 实现 `ensureAcpWarmup()` API 链路
3. 改进 `loadWarmupModes()` 逻辑
4. 测试验证

### Phase 2: Available Commands 展示

1. 新增事件定义
2. 改进 ContentMapper
3. 实现 `useAcpCommands` composable
4. UI 集成（可选：命令面板）

### Phase 3: Workdir 切换体验

1. 实现确认对话框
2. 实现会话归档逻辑
3. UI 显示 workdir 切换分隔线

---

## 5. 风险与注意事项

### 5.1 配置专用目录的清理

- 需要定期清理 `acp-config-warmup` 目录
- 可在应用启动时清理过期文件

### 5.2 进程资源管理

- 配置专用 warmup 进程应在获取配置后及时释放
- 避免同时存在过多 warmup 进程

### 5.3 向后兼容

- 所有改动应保持向后兼容
- 现有的 workdir 选择流程仍然有效
