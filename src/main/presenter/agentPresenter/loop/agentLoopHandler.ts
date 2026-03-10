import { ChatMessage, IConfigPresenter, LLMAgentEvent, MCPToolCall } from '@shared/presenter'
import { presenter } from '@/presenter'
import { eventBus, SendTarget } from '@/eventbus'
import { WORKSPACE_EVENTS } from '@/events'
import { BaseLLMProvider } from '@/presenter/llmProviderPresenter/baseProvider'
import { StreamState } from './loopState'
import { RateLimitManager } from '@/presenter/llmProviderPresenter/managers/rateLimitManager'
import { ToolCallProcessor } from './toolCallProcessor'
import { ToolPresenter } from '../../toolPresenter'
import { getAgentFilteredTools } from '../../mcpPresenter/agentMcpFilter'

interface AgentLoopHandlerOptions {
  configPresenter: IConfigPresenter
  getProviderInstance: (providerId: string) => BaseLLMProvider
  activeStreams: Map<string, StreamState>
  canStartNewStream: () => boolean
  rateLimitManager: RateLimitManager
}

export class AgentLoopHandler {
  private readonly toolCallProcessor: ToolCallProcessor
  private toolPresenter: ToolPresenter | null = null
  private currentSupportsVision = false

  constructor(private readonly options: AgentLoopHandlerOptions) {
    this.toolCallProcessor = new ToolCallProcessor({
      getAllToolDefinitions: async (context) => {
        // Get modelId from session
        let modelId: string | undefined
        if (context.conversationId) {
          try {
            const session = await presenter.sessionManager.getSession(context.conversationId)
            modelId = session?.resolved.modelId
          } catch {
            // Ignore errors, modelId will be undefined
          }
        }

        const { chatMode, agentWorkspacePath } = await this.resolveWorkspaceContext(
          context.conversationId,
          modelId
        )

        const toolDefs = await this.getToolPresenter().getAllToolDefinitions({
          enabledMcpTools: context.enabledMcpTools,
          chatMode,
          supportsVision: this.currentSupportsVision,
          agentWorkspacePath,
          conversationId: context.conversationId
        })

        return await this.filterToolsForChatMode(toolDefs, chatMode, modelId)
      },
      callTool: async (request: MCPToolCall) => {
        return await this.getToolPresenter().callTool(request)
      },
      preCheckToolPermission: async (request: MCPToolCall) => {
        return await this.getToolPresenter().preCheckToolPermission(request)
      },
      onToolCallFinished: ({ toolServerName, conversationId }) => {
        if (toolServerName !== 'agent-filesystem') return
        this.notifyWorkspaceFilesChanged(conversationId)
      }
    })
  }

  /**
   * Lazy initialization of ToolPresenter
   * This is needed because ToolPresenter depends on mcpPresenter and yoBrowserPresenter
   * which are created after LLMProviderPresenter in the Presenter initialization order
   */
  private getToolPresenter(): ToolPresenter {
    if (!this.toolPresenter) {
      if (presenter.toolPresenter) {
        this.toolPresenter = presenter.toolPresenter as ToolPresenter
        return this.toolPresenter
      }
      // Check if presenter is fully initialized
      if (!presenter.mcpPresenter || !presenter.yoBrowserPresenter) {
        throw new Error(
          'ToolPresenter dependencies not initialized. mcpPresenter and yoBrowserPresenter must be initialized first.'
        )
      }
      this.toolPresenter = new ToolPresenter({
        mcpPresenter: presenter.mcpPresenter,
        yoBrowserPresenter: presenter.yoBrowserPresenter,
        configPresenter: this.options.configPresenter
      })
    }
    return this.toolPresenter
  }

  /**
   * Resolve workspace context (chatMode and agentWorkspacePath) for tool definitions
   * @param conversationId Optional conversation ID
   * @param modelId Optional model ID (required for acp agent mode)
   * @returns Resolved workspace context
   */
  private async resolveWorkspaceContext(
    conversationId?: string,
    modelId?: string
  ): Promise<{ chatMode: 'agent' | 'acp agent'; agentWorkspacePath: string | null }> {
    return presenter.sessionManager.resolveWorkspaceContext(conversationId, modelId)
  }

  private notifyWorkspaceFilesChanged(conversationId?: string): void {
    if (!conversationId) return
    eventBus.sendToRenderer(WORKSPACE_EVENTS.FILES_CHANGED, SendTarget.ALL_WINDOWS, {
      conversationId
    })
  }

  private requiresReasoningField(modelId: string): boolean {
    const lower = modelId.toLowerCase()
    return (
      lower.includes('deepseek-reasoner') ||
      lower.includes('kimi-k2-thinking') ||
      lower.includes('glm-4.7')
    )
  }

  private isAgentToolDefinition(tool: { server?: { name: string } }): boolean {
    const name = tool.server?.name
    return Boolean(name && (name === 'yo-browser' || name.startsWith('agent-')))
  }

  private async filterToolsForChatMode(
    tools: Awaited<ReturnType<ToolPresenter['getAllToolDefinitions']>>,
    chatMode: 'agent' | 'acp agent',
    agentId?: string
  ): Promise<Awaited<ReturnType<ToolPresenter['getAllToolDefinitions']>>> {
    if (chatMode !== 'acp agent') return tools
    if (!agentId) return []

    const agentTools = tools.filter((tool) => this.isAgentToolDefinition(tool))
    const mcpTools = tools.filter((tool) => !this.isAgentToolDefinition(tool))
    const filteredMcp = await getAgentFilteredTools(
      agentId,
      undefined,
      mcpTools,
      this.options.configPresenter
    )
    return [...filteredMcp, ...agentTools]
  }

  async *startStreamCompletion(
    providerId: string,
    initialMessages: ChatMessage[],
    modelId: string,
    eventId: string,
    temperature: number = 0.6,
    maxTokens: number = 4096,
    enabledMcpTools?: string[],
    thinkingBudget?: number,
    reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high',
    verbosity?: 'low' | 'medium' | 'high',
    conversationId?: string
  ): AsyncGenerator<LLMAgentEvent, void, unknown> {
    console.log(`[Agent Loop] Starting agent loop for event: ${eventId} with model: ${modelId}`)
    if (!this.options.canStartNewStream()) {
      // Instead of throwing, yield an error event
      yield { type: 'error', data: { eventId, error: 'Maximum concurrent stream limit reached' } }
      return
      // throw new Error('Maximum concurrent stream limit reached')
    }

    const provider = this.options.getProviderInstance(providerId)
    const abortController = new AbortController()
    const modelConfig = this.options.configPresenter.getModelConfig(modelId, providerId)

    if (conversationId) {
      modelConfig.conversationId = conversationId
    }

    if (thinkingBudget !== undefined) {
      modelConfig.thinkingBudget = thinkingBudget
    }
    if (reasoningEffort !== undefined) {
      modelConfig.reasoningEffort = reasoningEffort
    }
    if (verbosity !== undefined) {
      modelConfig.verbosity = verbosity
    }
    this.currentSupportsVision = Boolean(modelConfig?.vision)

    this.options.activeStreams.set(eventId, {
      isGenerating: true,
      providerId,
      modelId,
      abortController,
      provider
    })

    // Agent Loop Variables
    const conversationMessages: ChatMessage[] = [...initialMessages]
    let needContinueConversation = true
    let toolCallCount = 0
    const MAX_TOOL_CALLS = BaseLLMProvider.getMaxToolCalls()
    const totalUsage: {
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
      context_length: number
    } = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      context_length: modelConfig?.contextLength || 0
    }

    try {
      // --- Agent Loop ---
      while (needContinueConversation) {
        if (abortController.signal.aborted) {
          console.log('Agent loop aborted for event:', eventId)
          break
        }

        if (toolCallCount >= MAX_TOOL_CALLS) {
          console.warn('Maximum tool call limit reached for event:', eventId)
          yield {
            type: 'response',
            data: {
              eventId,
              maximum_tool_calls_reached: true
            }
          }

          break
        }

        needContinueConversation = false

        // Prepare for LLM call
        let currentContent = ''
        let currentReasoning = ''
        const currentToolCalls: Array<{
          id: string
          name: string
          arguments: string
        }> = []
        const currentToolChunks: Record<
          string,
          {
            name: string
            arguments_chunk: string
            server_name?: string
            server_icons?: string
            server_description?: string
          }
        > = {}

        try {
          console.log(`[Agent Loop] Iteration ${toolCallCount + 1} for event: ${eventId}`)
          // Resolve workspace context
          const { chatMode, agentWorkspacePath } = await this.resolveWorkspaceContext(
            conversationId,
            modelId
          )

          // Get all tool definitions using ToolPresenter
          const toolDefs = await this.getToolPresenter().getAllToolDefinitions({
            enabledMcpTools,
            chatMode,
            supportsVision: this.currentSupportsVision,
            agentWorkspacePath,
            conversationId
          })
          const filteredToolDefs = await this.filterToolsForChatMode(toolDefs, chatMode, modelId)

          const canExecute = this.options.rateLimitManager.canExecuteImmediately(providerId)
          if (!canExecute) {
            const config = this.options.rateLimitManager.getProviderRateLimitConfig(providerId)
            const currentQps = this.options.rateLimitManager.getCurrentQps(providerId)
            const queueLength = this.options.rateLimitManager.getQueueLength(providerId)

            yield {
              type: 'response',
              data: {
                eventId,
                rate_limit: {
                  providerId,
                  qpsLimit: config.qpsLimit,
                  currentQps,
                  queueLength,
                  estimatedWaitTime: Math.max(0, 1000 - (Date.now() % 1000))
                }
              }
            }

            await this.options.rateLimitManager.executeWithRateLimit(providerId)
          } else {
            await this.options.rateLimitManager.executeWithRateLimit(providerId)
          }

          // Call the provider's core stream method, expecting LLMCoreStreamEvent
          const stream = provider.coreStream(
            conversationMessages,
            modelId,
            modelConfig,
            temperature,
            maxTokens,
            filteredToolDefs
          )

          // Process the standardized stream events
          for await (const chunk of stream) {
            if (abortController.signal.aborted) {
              break
            }
            // console.log('presenter chunk', JSON.stringify(chunk), currentContent)

            // --- Event Handling (using LLMCoreStreamEvent structure) ---
            switch (chunk.type) {
              case 'text':
                if (chunk.content) {
                  currentContent += chunk.content
                  yield {
                    type: 'response',
                    data: {
                      eventId,
                      content: chunk.content
                    }
                  }
                }
                break
              case 'reasoning':
                if (chunk.reasoning_content) {
                  currentReasoning += chunk.reasoning_content
                  yield {
                    type: 'response',
                    data: {
                      eventId,
                      reasoning_content: chunk.reasoning_content
                    }
                  }
                }
                break
              case 'tool_call_start':
                if (chunk.tool_call_id && chunk.tool_call_name) {
                  const toolDef = filteredToolDefs.find(
                    (tool) => tool.function.name === chunk.tool_call_name
                  )
                  const serverName = toolDef?.server?.name
                  const serverIcons = toolDef?.server?.icons
                  const serverDescription = toolDef?.server?.description

                  currentToolChunks[chunk.tool_call_id] = {
                    name: chunk.tool_call_name,
                    arguments_chunk: '',
                    server_name: serverName,
                    server_icons: serverIcons,
                    server_description: serverDescription
                  }
                  // Immediately send the start event to indicate the tool call has begun
                  yield {
                    type: 'response',
                    data: {
                      eventId,
                      tool_call: 'start',
                      tool_call_id: chunk.tool_call_id,
                      tool_call_name: chunk.tool_call_name,
                      tool_call_params: '', // Initial parameters are empty
                      tool_call_server_name: serverName,
                      tool_call_server_icons: serverIcons,
                      tool_call_server_description: serverDescription
                    }
                  }
                }
                break
              case 'tool_call_chunk':
                if (
                  chunk.tool_call_id &&
                  currentToolChunks[chunk.tool_call_id] &&
                  chunk.tool_call_arguments_chunk
                ) {
                  currentToolChunks[chunk.tool_call_id].arguments_chunk +=
                    chunk.tool_call_arguments_chunk

                  // Send update event to update parameter content in real-time
                  yield {
                    type: 'response',
                    data: {
                      eventId,
                      tool_call: 'update',
                      tool_call_id: chunk.tool_call_id,
                      tool_call_name: currentToolChunks[chunk.tool_call_id].name,
                      tool_call_params: currentToolChunks[chunk.tool_call_id].arguments_chunk,
                      tool_call_server_name: currentToolChunks[chunk.tool_call_id].server_name,
                      tool_call_server_icons: currentToolChunks[chunk.tool_call_id].server_icons,
                      tool_call_server_description:
                        currentToolChunks[chunk.tool_call_id].server_description
                    }
                  }
                }
                break
              case 'tool_call_end':
                if (chunk.tool_call_id && currentToolChunks[chunk.tool_call_id]) {
                  const completeArgs =
                    chunk.tool_call_arguments_complete ??
                    currentToolChunks[chunk.tool_call_id].arguments_chunk
                  const toolCallName = currentToolChunks[chunk.tool_call_id].name
                  const serverName = currentToolChunks[chunk.tool_call_id].server_name
                  const serverIcons = currentToolChunks[chunk.tool_call_id].server_icons
                  const serverDescription = currentToolChunks[chunk.tool_call_id].server_description

                  // For ACP provider, tool call execution is completed on agent side
                  // The tool_call_arguments_complete contains the execution result
                  // So we should immediately send 'end' event to mark it as successful
                  if (providerId === 'acp') {
                    // For ACP, tool_call_arguments_complete contains the execution result
                    // Use it directly as the response
                    yield {
                      type: 'response',
                      data: {
                        eventId,
                        tool_call: 'end',
                        tool_call_id: chunk.tool_call_id,
                        tool_call_name: toolCallName,
                        tool_call_params: completeArgs,
                        tool_call_response: completeArgs,
                        tool_call_server_name: serverName,
                        tool_call_server_icons: serverIcons,
                        tool_call_server_description: serverDescription
                      }
                    }

                    // Don't add to currentToolCalls for ACP - execution already completed
                    delete currentToolChunks[chunk.tool_call_id]
                  } else {
                    // For non-ACP providers, tool call needs to be executed by ToolCallProcessor
                    currentToolCalls.push({
                      id: chunk.tool_call_id,
                      name: toolCallName,
                      arguments: completeArgs
                    })

                    // Send final update event to ensure parameter completeness
                    yield {
                      type: 'response',
                      data: {
                        eventId,
                        tool_call: 'update',
                        tool_call_id: chunk.tool_call_id,
                        tool_call_name: toolCallName,
                        tool_call_params: completeArgs,
                        tool_call_server_name: serverName,
                        tool_call_server_icons: serverIcons,
                        tool_call_server_description: serverDescription
                      }
                    }

                    delete currentToolChunks[chunk.tool_call_id]
                  }
                }
                break
              case 'permission': {
                const permission = chunk.permission
                const permissionType = permission.permissionType ?? 'read'
                const description = permission.description ?? ''
                const toolName = permission.tool_call_name ?? permission.tool_call_id
                const serverName =
                  permission.server_name ?? permission.agentName ?? permission.providerName ?? ''

                yield {
                  type: 'response',
                  data: {
                    eventId,
                    tool_call: 'permission-required',
                    tool_call_id: permission.tool_call_id,
                    tool_call_name: toolName,
                    tool_call_params: permission.tool_call_params,
                    tool_call_server_name: serverName,
                    tool_call_server_icons: permission.server_icons,
                    tool_call_server_description:
                      permission.server_description ?? permission.agentName,
                    tool_call_response: description,
                    permission_request: {
                      toolName,
                      serverName,
                      permissionType,
                      description,
                      providerId: permission.providerId,
                      requestId: permission.requestId,
                      sessionId: permission.sessionId,
                      agentId: permission.agentId,
                      agentName: permission.agentName,
                      conversationId: permission.conversationId,
                      options: permission.options,
                      rememberable: permission.metadata?.rememberable === false ? false : true
                    }
                  }
                }
                break
              }
              case 'usage':
                if (chunk.usage) {
                  // console.log('usage', chunk.usage, totalUsage)
                  totalUsage.prompt_tokens += chunk.usage.prompt_tokens
                  totalUsage.completion_tokens += chunk.usage.completion_tokens
                  totalUsage.total_tokens += chunk.usage.total_tokens
                  totalUsage.context_length = modelConfig.contextLength
                  yield {
                    type: 'response',
                    data: {
                      eventId,
                      totalUsage: { ...totalUsage } // Yield accumulated usage
                    }
                  }
                }
                break
              case 'image_data':
                if (chunk.image_data) {
                  yield {
                    type: 'response',
                    data: {
                      eventId,
                      image_data: chunk.image_data
                    }
                  }

                  currentContent += `\n[Image data received: ${chunk.image_data.mimeType}]\n`
                }
                break
              case 'error':
                console.error(`Provider stream error for event ${eventId}:`, chunk.error_message)
                yield {
                  type: 'error',
                  data: {
                    eventId,
                    error: chunk.error_message || 'Provider stream error'
                  }
                }

                needContinueConversation = false
                break // Break inner loop on provider error
              case 'rate_limit':
                if (chunk.rate_limit) {
                  yield {
                    type: 'response',
                    data: {
                      eventId,
                      rate_limit: chunk.rate_limit
                    }
                  }
                }
                break
              case 'stop':
                console.log(
                  `Provider stream stopped for event ${eventId}. Reason: ${chunk.stop_reason}`
                )
                if (chunk.stop_reason === 'tool_use') {
                  // Consolidate any remaining tool call chunks
                  for (const id in currentToolChunks) {
                    currentToolCalls.push({
                      id: id,
                      name: currentToolChunks[id].name,
                      arguments: currentToolChunks[id].arguments_chunk
                    })
                  }

                  if (currentToolCalls.length > 0) {
                    needContinueConversation = true
                  } else {
                    console.warn(
                      `Stop reason was 'tool_use' but no tool calls were fully parsed for event ${eventId}.`
                    )
                    needContinueConversation = false // Don't continue if no tools parsed
                  }
                } else {
                  needContinueConversation = false
                }
                // Stop event itself doesn't need to be yielded here, handled by loop logic
                break
            }
          } // End of inner loop (for await...of stream)

          if (abortController.signal.aborted) break // Break outer loop if aborted

          // --- Post-Stream Processing ---

          // 1. Add Assistant Message
          const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: currentContent
          }
          if (
            this.requiresReasoningField(modelId) &&
            currentToolCalls.length > 0 &&
            currentReasoning
          ) {
            ;(assistantMessage as any).reasoning_content = currentReasoning
          }
          // Only add if there's content or tool calls are expected
          if (currentContent || (needContinueConversation && currentToolCalls.length > 0)) {
            conversationMessages.push(assistantMessage)
          }

          // 2. Execute Tool Calls if needed
          if (needContinueConversation && currentToolCalls.length > 0) {
            const processor = this.toolCallProcessor.process({
              eventId,
              toolCalls: currentToolCalls,
              enabledMcpTools,
              conversationMessages,
              modelConfig,
              providerId,
              abortSignal: abortController.signal,
              currentToolCallCount: toolCallCount,
              maxToolCalls: MAX_TOOL_CALLS,
              conversationId
            })

            while (true) {
              const { value, done } = await processor.next()
              if (done) {
                toolCallCount = value.toolCallCount
                needContinueConversation = value.needContinueConversation
                break
              }
              yield value
            }

            if (abortController.signal.aborted) {
              break // Check after tool loop
            }

            if (!needContinueConversation) {
              // If max tool calls reached or explicit stop, break outer loop
              break
            }
          } else {
            // No tool calls needed or requested, end the loop
            needContinueConversation = false
          }
        } catch (error) {
          if (abortController.signal.aborted) {
            console.log(`Agent loop aborted during inner try-catch for event ${eventId}`)
            break // Break outer loop if aborted here
          }
          console.error(`Agent loop inner error for event ${eventId}:`, error)
          yield {
            type: 'error',
            data: {
              eventId,
              error: error instanceof Error ? error.message : String(error)
            }
          }

          needContinueConversation = false // Stop loop on inner error
        }
      } // --- End of Agent Loop (while) ---
      console.log(
        `[Agent Loop] Agent loop completed for event: ${eventId}, iterations: ${toolCallCount}`
      )
    } catch (error) {
      // Catch errors from the generator setup phase (before the loop)
      if (abortController.signal.aborted) {
        console.log(`Agent loop aborted during outer try-catch for event ${eventId}`)
      } else {
        console.error(`Agent loop outer error for event ${eventId}:`, error)
        yield {
          type: 'error',
          data: {
            eventId,
            error: error instanceof Error ? error.message : String(error)
          }
        }
      }
    } finally {
      // Finalize stream regardless of how the loop ended (completion, error, abort)
      const userStop = abortController.signal.aborted
      if (!userStop) {
        // Yield final aggregated usage if not aborted
        yield {
          type: 'response',
          data: {
            eventId,
            totalUsage
          }
        }
      }
      // Yield the final END event
      yield { type: 'end', data: { eventId, userStop } }

      this.options.activeStreams.delete(eventId)
      console.log('Agent loop finished for event:', eventId, 'User stopped:', userStop)

      // Trigger ACP workspace file refresh (only for ACP provider)
      if (providerId === 'acp') {
        this.notifyWorkspaceFilesChanged(conversationId)
      }
    }
  }
}
