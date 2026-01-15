# DeepChat 核心流程

本文档使用时序图详细描述 DeepChat 的关键业务流程，帮助开发者理解运行时行为。

## 1. 发送消息完整流程

```mermaid
sequenceDiagram
    autonumber
    participant User as 用户
    participant UI as ChatInput/ChatView.vue
    participant Store as chatStore.sendMessage()
    participant IPC as presenter:call (IPC)
    participant AgentP as AgentPresenter.sendMessage()
    participant MsgMgr as MessageManager
    participant StreamGen as StreamGenerationHandler
    participant SessionMgr as SessionManager
    participant AgentLoop as agentLoopHandler
    participant ToolP as ToolPresenter
    participant LLM as LLMProviderPresenter
    participant EventBus as EventBus

    User->>UI: 输入内容并点击发送
    UI->>Store: handleSend(message)
    Store->>IPC: presenter:call(agentPresenter.sendMessage)
    IPC->>AgentP: sendMessage(agentId, content)

    Note over AgentP,MsgMgr: 1. 创建用户消息
    AgentP->>MsgMgr: sendMessage(agentId, content, 'user')
    MsgMgr-->>AgentP: userMessage

    Note over AgentP,MsgMgr: 2. 创建助手消息（初始为空）
    AgentP->>MsgMgr: sendMessage(agentId, '[]', 'assistant')
    MsgMgr-->>AgentP: assistantMessage

    Note over AgentP,SessionMgr: 3. 启动 Agent Loop
    AgentP->>SessionMgr: startLoop(agentId, assistantMessage.id)
    SessionMgr->>SessionMgr: status = 'generating'

    Note over AgentP,StreamGen: 4. 启动流生成
    AgentP->>StreamGen: startStreamCompletion(agentId)
    StreamGen->>StreamGen: prepareConversationContext()
    StreamGen->>StreamGen: processUserMessageContent()
    alt 启用搜索
        StreamGen->>StreamGen: 执行搜索获取相关信息
    end
    StreamGen->>StreamGen: preparePromptContent(上下文+搜索+图片)

    Note over StreamGen,AgentLoop: 5. 启动 Agent Loop
    StreamGen->>AgentLoop: startStreamCompletion()
    AgentLoop->>ToolP: getAllToolDefinitions()
    ToolP-->>AgentLoop: toolDefs (MCP + Agent)

    AgentLoop->>LLM: provider.coreStream(messages, tools, modelConfig)

    loop Agent Loop 主循环
        Note over AgentLoop: 循环状态: toolCallCount < MAX_TOOL_CALLS

        LLM-->>AgentLoop: stream event (text/reasoning/tool_call/permission)

        alt text 事件
            AgentLoop->>EventBus: send STREAM_EVENTS.RESPONSE { content }
        else reasoning 事件
            AgentLoop->>EventBus: send STREAM_EVENTS.RESPONSE { reasoning_content }
        else tool_call_start 事件
            AgentLoop->>EventBus: send { tool_call: 'start', name, id }
        else tool_call_chunk 事件
            AgentLoop->>EventBus: send { tool_call: 'update', params增量 }
        else tool_call_end 事件
            Note over AgentLoop: 工具参数完整
            AgentLoop->>EventBus: send { tool_call: 'update', 完整params }

            alt ACP Provider
                Note over AgentLoop: ACP 直接返回执行结果
                AgentLoop->>EventBus: send { tool_call: 'end', response }
            else 非 ACP
                Note over AgentLoop: 需要本地执行工具
                AgentLoop->>AgentLoop: currentToolCalls.push({id, name, arguments})
            end
        else permission 事件
            AgentLoop->>EventBus: send { tool_call: 'permission-required' }
            AgentLoop->>AgentLoop: needContinue = false (等待用户响应)
            Note over AgentLoop: 退出循环等待用户批准
        end

        alt stop event
            AgentLoop->>AgentLoop: 检查 stop_reason
            alt tool_use
                Note over AgentLoop: 继续循环
            else end/max_tokens
                Note over AgentLoop: 结束循环
                Note over AgentLoop: 需要 break
            end
        end
    end

    alt 有工具调用需要执行
        Note over AgentLoop,ToolP: 执行工具调用
        AgentLoop->>ToolP: callTool(toolCall[0])
        ToolP->>ToolP: ToolMapper 路由
        ToolP->>ToolP: 执行工具 (MCP 或 Agent)
        ToolP-->>AgentLoop: toolResponse
        AgentLoop->>EventBus: send { tool_call: 'running' }
        AgentLoop->>EventBus: send { tool_call: 'end', response }

        Note over AgentLoop,AgentLoop: 添加工具结果到上下文
        AgentLoop->>AgentLoop: conversationMessages.push(tool_result)
        AgentLoop->>AgentLoop: toolCallCount++
        AgentLoop->>AgentLoop: 继续下一次 LLM 调用
    end

    loop 继续循环
        AgentLoop->>LLM: coreStream (带工具结果)
    end

    AgentLoop->>EventBus: send STREAM_EVENTS.END
    AgentLoop->>SessionMgr: status = 'idle'
```

**关键文件位置**：
- AgentPresenter.sendMessage: `src/main/presenter/agentPresenter/index.ts:139-176`
- SessionManager.startLoop: `src/main/presenter/sessionPresenter/session/sessionManager.ts:140-150`
- StreamGenerationHandler.startStreamCompletion: `src/main/presenter/agentPresenter/streaming/streamGenerationHandler.ts:54-179`
- agentLoopHandler.startStreamCompletion: `src/main/presenter/agentPresenter/loop/agentLoopHandler.ts:145-668`

## 2. 渲染与流式更新流程（含 Minimap）

```mermaid
sequenceDiagram
    autonumber
    participant UI as ChatInput/ChatView (Renderer)
    participant Store as chatStore (Renderer)
    participant IPC as presenter:call (IPC)
    participant AgentP as AgentPresenter (Main)
    participant StreamGen as StreamGenerationHandler (Main)
    participant LLM as LLMProviderPresenter (Main)
    participant LLMH as LLMEventHandler (Main)
    participant Sched as StreamUpdateScheduler (Main)
    participant Cache as messageRuntimeCache (Renderer)
    participant List as MessageList/Minimap (Renderer)

    UI->>Store: send(message)
    Store->>IPC: presenter:call(agentPresenter.sendMessage)
    IPC->>AgentP: sendMessage(agentId, content)
    AgentP->>StreamGen: generateAIResponse + startStreamCompletion
    StreamGen->>LLM: startStreamCompletion()
    LLM-->>LLMH: stream chunks
    LLMH->>Sched: enqueueDelta(content/tool_call/usage)
    Sched-->>Store: STREAM_EVENTS.RESPONSE (init/delta)
    Store->>Cache: cacheMessage/ensureMessageId
    Cache-->>List: messageItems/minimapMessages
    LLMH-->>Sched: flushAll(final)
    Sched-->>Store: STREAM_EVENTS.RESPONSE (final)
    LLMH-->>Store: STREAM_EVENTS.END/ERROR
```

**关键文件位置**：
- chatStore.sendMessage + stream handlers: `src/renderer/src/stores/chat.ts`
- Presenter IPC: `src/renderer/src/composables/usePresenter.ts`, `src/main/presenter/index.ts`
- AgentPresenter.sendMessage: `src/main/presenter/agentPresenter/index.ts`
- StreamGenerationHandler.startStreamCompletion: `src/main/presenter/agentPresenter/streaming/streamGenerationHandler.ts`
- LLMEventHandler + StreamUpdateScheduler: `src/main/presenter/agentPresenter/streaming/llmEventHandler.ts`, `src/main/presenter/agentPresenter/streaming/streamUpdateScheduler.ts`
- MessageList/Minimap: `src/renderer/src/components/message/MessageList.vue`, `src/renderer/src/components/message/MessageMinimap.vue`

## 3. Agent Loop 详细流程

```mermaid
sequenceDiagram
    autonumber
    participant StreamGen as StreamGenerationHandler
    participant AgentLoop as agentLoopHandler
    participant LLM as LLMProvider
    participant ToolP as ToolPresenter
    participant EventBus as EventBus

    StreamGen->>AgentLoop: startStreamCompletion()

    activate AgentLoop
    AgentLoop->>AgentLoop: 初始化循环变量
    Note right of AgentLoop: conversationMessages, needContinue, toolCallCount

    loop while (needContinueConversation)
        AgentLoop->>AgentLoop: 获取工具定义 (getAllToolDefinitions)
        AgentLoop->>ToolP: getAllToolDefinitions({chatMode, workspace})
        ToolP-->>AgentLoop: toolDefs[]

        AgentLoop->>LLM: coreStream(conversationMessages, filteredToolDefs)

        loop 处理流事件
            LLM-->>AgentLoop: event (LLMCoreStreamEvent)

            alt event.type == 'text'
                AgentLoop->>EventBus: send { content }
                AgentLoop->>AgentLoop: currentContent += event.content
            else event.type == 'reasoning'
                AgentLoop->>EventBus: send { reasoning_content }
                AgentLoop->>AgentLoop: currentReasoning += event.reasoning_content
            else event.type == 'tool_call_start'
                AgentLoop->>EventBus: send { tool_call: 'start', name, id }
                AgentLoop->>AgentLoop: currentToolChunks[id] = {name, arguments_chunk: ''}
            else event.type == 'tool_call_chunk'
                AgentLoop->>EventLoop: send { tool_call: 'update', args }
                AgentLoop->>AgentLoop: currentToolChunks[id].arguments_chunk += chunk
            else event.type == 'tool_call_end'
                AgentLoop->>AgentLoop: 完整合并参数
                alt providerId == 'acp'
                    Note over AgentLoop: ACP 已执行，直接返回结果
                    AgentLoop->>EventBus: send { tool_call: 'end', response }
                else 非 ACP
                    Note over AgentLoop: 需要执行工具
                    AgentLoop->>AgentLoop: currentToolCalls.push({id, name, arguments})
                end
            else event.type == 'permission'
                AgentLoop->>EventBus: send { tool_call: 'permission-required' }
                AgentLoop->>AgentLoop: 循环退出，等待用户响应
            else event.type == 'stop'
                AgentLoop->>AgentLoop: 检查 stop_reason
                alt stop_reason == 'tool_use'
                    Note over AgentLoop: needContinue = true
                else 其他
                    Note over AgentLoop: needContinue = false
                end
            end
        end

        Note over AgentLoop: 添加 assistant 消息到上下文
        AgentLoop->>AgentLoop: conversationMessages.push({role: 'assistant', content: currentContent})

        alt needContinue && currentToolCalls.length > 0
            Note over AgentLoop: 执行工具调用
            AgentLoop->>ToolP: 批量调用工具
            loop 执行每个工具
                ToolP-->>AgentLoop: toolResult
                AgentLoop->>EventBus: 发送工具执行事件
                AgentLoop->>AgentLoop: conversationMessages.push(tool_result)
            end
            AgentLoop->>AgentLoop: toolCallCount++
        end
    end
    deactivate AgentLoop

    AgentLoop->>EventBus: send STREAM_EVENTS.END {userStop}
```

**关键代码位置**：
- agentLoopHandler 主循环: `src/main/presenter/agentPresenter/loop/agentLoopHandler.ts:223-626`

## 3. 工具调用路由流程

```mermaid
sequenceDiagram
    autonumber
    participant AgentLoop as agentLoopHandler
    participant ToolP as ToolPresenter
    participant Mapper as ToolMapper
    participant McpP as McpPresenter
    participant AgentToolMgr as AgentToolManager
    participant FsHandler as AgentFileSystemHandler

    AgentLoop->>ToolP: callTool({id, function: {name, arguments}, server})

    ToolP->>Mapper: getToolSource(name)
    Mapper-->>ToolP: source ('mcp' or 'agent')

    alt source == 'mcp'
        ToolP->>McpP: callTool(request)
        Note over McpP: MCP 工具执行
        McpP-->>McpP: 获取工具定义
        McpP-->>McpP: 权限检查
        McpP->>McpP: 调用 MCP 服务器
        McpP-->>ToolP: toolResponse
    else source == 'agent'
        ToolP->>AgentToolMgr: callTool(name, args, conversationId)

        alt 工具名以 filesystem 开头
            AgentToolMgr->>FsHandler: read_file/write_file/list_directory
            Note over FsHandler: 路径安全检查<br/>执行文件操作
            FsHandler-->>AgentToolMgr: fileResult
        else 工具是 browser 相关
            AgentToolMgr->>AgentToolMgr: 调用 Browser 工具
            AgentToolMgr-->>AgentToolMgr: browserResult
        end

        AgentToolMgr-->>ToolP: toolResponse
    end

    ToolP-->>AgentLoop: {content, rawData}
```

**工具定义收集流程**：

```typescript
// 1. ToolPresenter.getAllToolDefinitions()
async getAllToolDefinitions({chatMode, supportsVision, agentWorkspacePath}) {
  // 2. 获取 MCP 工具
  const mcpDefs = await mcpPresenter.getAllToolDefinitions()
  this.mapper.registerTools(mcpDefs, 'mcp')

  // 3. chatMode != 'chat' 时获取 Agent 工具
  if (chatMode !== 'chat') {
    const agentDefs = await agentToolManager.getAllToolDefinitions()

    // 4. 过滤名称冲突（优先 MCP）
    const filtered = agentDefs.filter(t => !mapper.hasTool(t.name))
    this.mapper.registerTools(filtered, 'agent')

    return [...mcpDefs, ...filtered]
  }

  return mcpDefs
}
```

**关键文件位置**：
- ToolPresenter: `src/main/presenter/toolPresenter/index.ts:49-99`
- ToolMapper: `src/main/presenter/toolPresenter/toolMapper.ts`
- AgentToolManager: `src/main/presenter/agentPresenter/acp/agentToolManager.ts`
- AgentFileSystemHandler: `src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts`

## 4. 权限请求与响应流程

```mermaid
sequenceDiagram
    autonumber
    participant AgentLoop as agentLoopHandler
    participant EventBus as EventBus
    participant UI as PermissionDialog.vue
    participant AgentP as AgentPresenter
    participant SessionMgr as SessionManager
    participant ToolP as ToolPresenter

    AgentLoop->>EventBus: send {tool_call: 'permission-required', permissionType, description}
    Note over EventBus: permissionType: 'read' | 'write' | 'all' | 'command'

    EventBus->>UI: 渲染权限请求对话框
    UI->>User: 显示权限请求

    User->>UI: 点击"允许"或"拒绝"
    UI->>AgentP: handlePermissionResponse(messageId, toolCallId, granted, permissionType)

    Note over AgentP,SessionMgr: 更新权限状态
    AgentP->>SessionMgr: clearPendingPermission()

    alt granted == true
        AgentP->>AgentP: 记录用户选择（remember?）

        alt permissionType == 'command'
            Note over AgentP: 命令权限
            AgentP->>AgentP: CommandPermissionService.approve(signautre)
        else MCP 权限
            Note over AgentP: MCP 权限
            AgentP->>ToolP: grantPermission(serverName, permissionType, remember)
        else ACP 权限
            Note over AgentP: ACP 权限
            AgentP->>AgentP: resolveAgentPermission(requestId, true)
        end

        Note over AgentP,AgentP: 恢复 Agent Loop
        AgentP->>SessionMgr: startLoop(conversationId, messageId)
        AgentP->>AgentP: continueStreamCompletion(messageId)
        Note over AgentP: 从断点继续执行工具调用
    else granted == false
        Note over AgentP,AgentP: 拒绝权限
        AgentP->>AgentP: 返回错误消息"工具执行失败：用户拒绝权限"
        AgentP->>AgentP: 继续生成（不在工具结果基础上继续）
    end
```

**权限类型说明**：
- `read` - 读取操作（list_directory, read_file, get_file_info）
- `write` - 写入操作（write_file, create_directory, delete_file）
- `all` - 授予读写权限（常用于文件系统操作）
- `command` - 执行命令（需要额外审批）

**关键文件位置**：
- PermissionHandler: `src/main/presenter/agentPresenter/permission/permissionHandler.ts`
- agentLoopHandler permission 事件处理: `src/main/presenter/agentPresenter/loop/agentLoopHandler.ts:432-470`

## 5. 会话生命周期

```mermaid
stateDiagram-v2
    [*] --> 未创建: 用户打开聊天界面

    未创建 --> 激活: 创建会话 (createConversation)
    未创建 --> 激活: 从列表选择会话

    激活 --> 生成中: 用户发送消息 (sendMessage)

    生成中 --> 生成中: Agent Loop 循环执行工具
    生成中 --> 等待权限: 工具需要权限 (permission-required)
    生成中 --> 已完成: LLM 完成（无工具或达到最大调用次数）
    生成中 --> 已取消: 用户停止生成

    等待权限 --> 生成中: 用户批准权限
    等待权限 --> 已取消: 用户拒绝权限

    已完成 --> 激活: 用户继续对话
    已完成 --> 已完成: 用户查看历史

    已取消 --> 激活: 用户重新发送消息

    激活 --> 暂停: 切换到其他 Tab
    暂停 --> 激活: 切换回该 Tab

    激活 --> 分支: 用户选择分支 (forkConversation)

    分支 --> 激活: 新建子会话（部分历史）

    激活 --> 已删除: 用户删除会话

    已删除 --> [*]
```

**会话创建与绑定流程**：

```mermaid
sequenceDiagram
    participant UI as 聊天界面
    participant SessionP as SessionPresenter
    participant ConvMgr as ConversationManager
    participant SessionMgr as SessionManager

    UI->>SessionP: createConversation(title, settings, tabId)
    SessionP->>ConvMgr: createConversation(title, settings, tabId)
    ConvMgr->>ConvMgr: 持久化到 SQLite
    ConvMgr-->>SessionP: conversationId
    ConvMgr->>ConvMgr: setActiveConversation(conversationId, tabId)
    Note over ConvMgr: 绑定到 tab

    UI->>SessionP: getActiveConversation(tabId)
    SessionP->>ConvMgr: getActiveConversation(tabId)
    ConvMgr-->>UI: conversation

    Note over UI,SessionP: 首次发送消息时
    UI->>SessionP: sendMessage(conversationId, content)
    SessionP->>SessionMgr: getSession(conversationId)
    Note over SessionMgr: 解析 SessionContextResolved
    Note over SessionMgr: chatMode, providerId, modelId, workspace
```

**会话分支（Fork）流程**：

```mermaid
sequenceDiagram
    participant UI as 聊天界面
    participant SessionP as SessionPresenter
    participant ConvMgr as ConversationManager
    participant MsgMgr as MessageManager

    UI->>SessionP: forkConversation(conversationId, messageId, newTitle)
    SessionP->>ConvMgr: forkConversation()
    ConvMgr->>ConvMgr: 创建新会话
    ConvMgr->>MsgMgr: 复制消息到 targetMessageId（含变体选择）
    Note over ConvMgr,MsgMgr: 只复制到目标消息及其父消息
    ConvMgr->>ConvMgr: 更新父会话关系 (parentConversationId, parentMessageId)
    ConvMgr-->>UI: newConversationId
```

**关键文件位置**：
- ConversationManager: `src/main/presenter/sessionPresenter/managers/conversationManager.ts`
- forkConversation: `src/main/presenter/sessionPresenter/managers/conversationManager.ts:818-861`
- SessionManager.getSession: `src/main/presenter/sessionPresenter/session/sessionManager.ts:35-61`

## 6. 继续生成（Continue）流程

```mermaid
sequenceDiagram
    autonumber
    participant UI as ChatView
    participant AgentP as AgentPresenter
    participant PermHandler as PermissionHandler
    participant StreamGen as StreamGenerationHandler
    participant AgentLoop as agentLoopHandler
    participant McpP as McpPresenter

    UI->>AgentP: continueLoop(messageId)

    Note over AgentP,AgentP: 1. 检查是否是 maximum_tool_calls_reached
    AgentP->>AgentP: createContinueMessage(agentId)
    AgentP->>AgentP: sendMessage(agentId, '{"text":"continue"}', 'user')
    AgentP->>AgentP: generateAIResponse 创建空助手消息

    AgentP->>PermHandler: 继续之前的工具调用执行

    alt 有待执行的工具调用
        PermHandler->>PermHandler: 解析最后 action block
        PermHandler->>McpP: callTool(toolCall)
        McpP-->>PermHandler: toolResponse
        PermHandler->>EventBus: 发送 tool_call 事件 (running, end)
    end

    AgentP->>PermHandler: 从断点继续
    PermHandler->>StreamGen: continueStreamCompletion(conversationId, messageId)

    Note over StreamGen: 2. 准备上下文
    StreamGen->>StreamGen: 准备历史消息（含工具执行结果）
    StreamGen->>StreamGen: preparePromptContent(userContent='continue')

    StreamGen->>AgentLoop: startStreamCompletion(continue)
    AgentLoop->>AgentLoop: 继续正常 LLM 调用流程
    AgentLoop->>UI: 流式返回内容
```

**关键文件位置**：
- AgentPresenter.continueLoop: `src/main/presenter/agentPresenter/index.ts:178-204`
- StreamGenerationHandler.continueStreamCompletion: `src/main/presenter/agentPresenter/streaming/streamGenerationHandler.ts:181-350`

---

> 💡 **提示**：所有时序图均基于当前实际代码结构绘制，代码位置标注了文件的 approximate 行数，方便快速定位。
