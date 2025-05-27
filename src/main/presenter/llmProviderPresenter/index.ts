import {
  ILlmProviderPresenter,
  LLM_PROVIDER,
  LLMResponse,
  MCPToolCall,
  MODEL_META,
  OllamaModel,
  ChatMessage,
  LLMAgentEvent
} from '@shared/presenter'
import { BaseLLMProvider } from './baseProvider'
import { OpenAIProvider } from './providers/openAIProvider'
import { DeepseekProvider } from './providers/deepseekProvider'
import { SiliconcloudProvider } from './providers/siliconcloudProvider'
import { eventBus } from '@/eventbus'
import { OpenAICompatibleProvider } from './providers/openAICompatibleProvider'
import { PPIOProvider } from './providers/ppioProvider'
import { OLLAMA_EVENTS } from '@/events'
import { ConfigPresenter } from '../configPresenter'
import { GeminiProvider } from './providers/geminiProvider'
import { GithubProvider } from './providers/githubProvider'
import { GithubCopilotProvider } from './providers/githubCopilotProvider'
import { OllamaProvider } from './providers/ollamaProvider'
import { AnthropicProvider } from './providers/anthropicProvider'
import { DoubaoProvider } from './providers/doubaoProvider'
import { ShowResponse } from 'ollama'
import { CONFIG_EVENTS } from '@/events'
import { GrokProvider } from './providers/grokProvider'
import { presenter } from '@/presenter'
import { ZhipuProvider } from './providers/zhipuProvider'
import { LMStudioProvider } from './providers/lmstudioProvider'
import { OpenAIResponsesProvider } from './providers/openAIResponsesProvider'
// 流的状态
interface StreamState {
  isGenerating: boolean
  providerId: string
  modelId: string
  abortController: AbortController
  provider: BaseLLMProvider
}

// 配置项
interface ProviderConfig {
  maxConcurrentStreams: number
}

export class LLMProviderPresenter implements ILlmProviderPresenter {
  private providers: Map<string, LLM_PROVIDER> = new Map()
  private providerInstances: Map<string, BaseLLMProvider> = new Map()
  private currentProviderId: string | null = null
  // 通过 eventId 管理所有的 stream
  private activeStreams: Map<string, StreamState> = new Map()
  // 配置
  private config: ProviderConfig = {
    maxConcurrentStreams: 10
  }
  private configPresenter: ConfigPresenter

  constructor(configPresenter: ConfigPresenter) {
    this.configPresenter = configPresenter
    this.init()
    // 监听代理更新事件
    eventBus.on(CONFIG_EVENTS.PROXY_RESOLVED, () => {
      // 遍历所有活跃的 provider 实例，调用 onProxyResolved
      for (const provider of this.providerInstances.values()) {
        provider.onProxyResolved()
      }
    })
  }

  private init() {
    const providers = this.configPresenter.getProviders()
    for (const provider of providers) {
      this.providers.set(provider.id, provider)
      if (provider.enable) {
        try {
          console.log('init provider', provider.id, provider.apiType)
          const instance = this.createProviderInstance(provider)
          if (instance) {
            this.providerInstances.set(provider.id, instance)
          }
        } catch (error) {
          console.error(`Failed to initialize provider ${provider.id}:`, error)
        }
      }
    }
  }

  private createProviderInstance(provider: LLM_PROVIDER): BaseLLMProvider | undefined {
    try {
      // 特殊处理 grok
      if (provider.apiType === 'grok' || provider.id === 'grok') {
        console.log('match grok')
        return new GrokProvider(provider, this.configPresenter)
      }

      switch (provider.apiType) {
        case 'deepseek':
          return new DeepseekProvider(provider, this.configPresenter)
        case 'silicon':
        case 'siliconcloud':
          return new SiliconcloudProvider(provider, this.configPresenter)
        case 'ppio':
          return new PPIOProvider(provider, this.configPresenter)
        case 'gemini':
          return new GeminiProvider(provider, this.configPresenter)
        case 'zhipu':
          return new ZhipuProvider(provider, this.configPresenter)
        case 'github':
          return new GithubProvider(provider, this.configPresenter)
        case 'github-copilot':
          return new GithubCopilotProvider(provider, this.configPresenter)
        case 'ollama':
          return new OllamaProvider(provider, this.configPresenter)
        case 'anthropic':
          return new AnthropicProvider(provider, this.configPresenter)
        case 'doubao':
          return new DoubaoProvider(provider, this.configPresenter)
        case 'openai':
          return new OpenAIProvider(provider, this.configPresenter)
        case 'openai-compatible':
          return new OpenAICompatibleProvider(provider, this.configPresenter)
        case 'openai-responses':
          return new OpenAIResponsesProvider(provider, this.configPresenter)
        case 'lmstudio':
          return new LMStudioProvider(provider, this.configPresenter)
        default:
          console.warn(`Unknown provider type: ${provider.apiType}`)
          return undefined
      }
    } catch (error) {
      console.error(`Failed to create provider instance for ${provider.id}:`, error)
      return undefined
    }
  }

  getProviders(): LLM_PROVIDER[] {
    return Array.from(this.providers.values())
  }

  getCurrentProvider(): LLM_PROVIDER | null {
    return this.currentProviderId ? this.providers.get(this.currentProviderId) || null : null
  }

  getProviderById(id: string): LLM_PROVIDER {
    const provider = this.providers.get(id)
    if (!provider) {
      throw new Error(`Provider ${id} not found`)
    }
    return provider
  }

  async setCurrentProvider(providerId: string): Promise<void> {
    // 如果有正在生成的流，先停止它们
    await this.stopAllStreams()

    const provider = this.getProviderById(providerId)
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`)
    }

    this.currentProviderId = providerId
    // 确保新的 provider 实例已经初始化
    this.getProviderInstance(providerId)
  }

  setProviders(providers: LLM_PROVIDER[]): void {
    // 如果有正在生成的流，先停止它们
    this.stopAllStreams()

    this.providers.clear()
    providers.forEach((provider) => {
      this.providers.set(provider.id, provider)
    })
    this.providerInstances.clear()
    const enabledProviders = Array.from(this.providers.values()).filter(
      (provider) => provider.enable
    )
    for (const provider of enabledProviders) {
      this.getProviderInstance(provider.id)
    }

    // 如果当前 provider 不在新的列表中，清除当前 provider
    if (this.currentProviderId && !providers.find((p) => p.id === this.currentProviderId)) {
      this.currentProviderId = null
    }
  }

  private getProviderInstance(providerId: string): BaseLLMProvider {
    let instance = this.providerInstances.get(providerId)
    if (!instance) {
      const provider = this.getProviderById(providerId)
      instance = this.createProviderInstance(provider)
      if (!instance) {
        throw new Error(`Failed to create provider instance for ${providerId}`)
      }
      this.providerInstances.set(providerId, instance)
    }
    return instance
  }

  async getModelList(providerId: string): Promise<MODEL_META[]> {
    const provider = this.getProviderInstance(providerId)
    let models = await provider.fetchModels()
    models = models.map((model) => {
      const config = this.configPresenter.getModelConfig(model.id, providerId)
      if (config) {
        model.maxTokens = config.maxTokens
        model.contextLength = config.contextLength
        // 如果模型中已经有这些属性则保留，否则使用配置中的值或默认为false
        model.vision = model.vision !== undefined ? model.vision : config.vision || false
        model.functionCall =
          model.functionCall !== undefined ? model.functionCall : config.functionCall || false
        model.reasoning =
          model.reasoning !== undefined ? model.reasoning : config.reasoning || false
      } else {
        // 确保模型具有这些属性，如果没有配置，默认为false
        model.vision = model.vision || false
        model.functionCall = model.functionCall || false
        model.reasoning = model.reasoning || false
      }
      return model
    })
    return models
  }

  async updateModelStatus(providerId: string, modelId: string, enabled: boolean): Promise<void> {
    this.configPresenter.setModelStatus(providerId, modelId, enabled)
  }

  isGenerating(eventId: string): boolean {
    return this.activeStreams.has(eventId)
  }

  getStreamState(eventId: string): StreamState | null {
    return this.activeStreams.get(eventId) || null
  }

  async stopStream(eventId: string): Promise<void> {
    const stream = this.activeStreams.get(eventId)
    if (stream) {
      stream.abortController.abort()
      // Deletion is handled by the consuming loop in threadPresenter upon receiving the 'end' event or abortion signal
    }
  }

  private async stopAllStreams(): Promise<void> {
    const promises = Array.from(this.activeStreams.keys()).map((eventId) =>
      this.stopStream(eventId)
    )
    await Promise.all(promises)
  }

  private canStartNewStream(): boolean {
    return this.activeStreams.size < this.config.maxConcurrentStreams
  }

  async *startStreamCompletion(
    providerId: string,
    initialMessages: ChatMessage[],
    modelId: string,
    eventId: string,
    temperature: number = 0.6,
    maxTokens: number = 4096
  ): AsyncGenerator<LLMAgentEvent, void, unknown> {
    console.log('Starting agent loop for event:', eventId, 'with model:', modelId)
    if (!this.canStartNewStream()) {
      // Instead of throwing, yield an error event
      yield { type: 'error', data: { eventId, error: '已达到最大并发流数量限制' } }
      return
      // throw new Error('已达到最大并发流数量限制')
    }

    const provider = this.getProviderInstance(providerId)
    const abortController = new AbortController()
    const modelConfig = this.configPresenter.getModelConfig(modelId, providerId)

    this.activeStreams.set(eventId, {
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
    const MAX_TOOL_CALLS = 20
    const totalUsage: {
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
    } = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
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
        // let currentReasoning = ''
        const currentToolCalls: Array<{
          id: string
          name: string
          arguments: string
        }> = []
        const currentToolChunks: Record<string, { name: string; arguments_chunk: string }> = {}

        try {
          console.log(`Loop iteration ${toolCallCount + 1} for event ${eventId}`)
          const mcpTools = await presenter.mcpPresenter.getAllToolDefinitions()
          // Call the provider's core stream method, expecting LLMCoreStreamEvent
          const stream = provider.coreStream(
            conversationMessages,
            modelId,
            modelConfig,
            temperature,
            maxTokens,
            mcpTools
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
                  // currentReasoning += chunk.reasoning_content
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
                  currentToolChunks[chunk.tool_call_id] = {
                    name: chunk.tool_call_name,
                    arguments_chunk: ''
                  }
                  // Immediately send the start event to indicate the tool call has begun
                  yield {
                    type: 'response',
                    data: {
                      eventId,
                      tool_call: 'start',
                      tool_call_id: chunk.tool_call_id,
                      tool_call_name: chunk.tool_call_name,
                      tool_call_params: '' // Initial parameters are empty
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
                      tool_call_params: currentToolChunks[chunk.tool_call_id].arguments_chunk
                    }
                  }
                }
                break
              case 'tool_call_end':
                if (chunk.tool_call_id && currentToolChunks[chunk.tool_call_id]) {
                  const completeArgs =
                    chunk.tool_call_arguments_complete ??
                    currentToolChunks[chunk.tool_call_id].arguments_chunk
                  currentToolCalls.push({
                    id: chunk.tool_call_id,
                    name: currentToolChunks[chunk.tool_call_id].name,
                    arguments: completeArgs
                  })

                  // Send final update event to ensure parameter completeness
                  yield {
                    type: 'response',
                    data: {
                      eventId,
                      tool_call: 'update',
                      tool_call_id: chunk.tool_call_id,
                      tool_call_name: currentToolChunks[chunk.tool_call_id].name,
                      tool_call_params: completeArgs
                    }
                  }

                  delete currentToolChunks[chunk.tool_call_id]
                }
                break
              case 'usage':
                if (chunk.usage) {
                  // console.log('usage', chunk.usage, totalUsage)
                  totalUsage.prompt_tokens += chunk.usage.prompt_tokens
                  totalUsage.completion_tokens += chunk.usage.completion_tokens
                  totalUsage.total_tokens += chunk.usage.total_tokens
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
          // Only add if there's content or tool calls are expected
          if (currentContent || (needContinueConversation && currentToolCalls.length > 0)) {
            conversationMessages.push(assistantMessage)
          }

          // 2. Execute Tool Calls if needed
          if (needContinueConversation && currentToolCalls.length > 0) {
            for (const toolCall of currentToolCalls) {
              if (abortController.signal.aborted) break // Check before each tool call

              if (toolCallCount >= MAX_TOOL_CALLS) {
                console.warn('Max tool calls reached during execution phase for event:', eventId)
                yield {
                  type: 'response',
                  data: {
                    eventId,
                    maximum_tool_calls_reached: true,
                    tool_call_id: toolCall.id,
                    tool_call_name: toolCall.name
                  }
                }

                needContinueConversation = false
                break
              }

              toolCallCount++

              // Find the tool definition to get server info
              const toolDef = (await presenter.mcpPresenter.getAllToolDefinitions()).find(
                (t) => t.function.name === toolCall.name
              )

              if (!toolDef) {
                console.error(`Tool definition not found for ${toolCall.name}. Skipping execution.`)
                const errorMsg = `Tool definition for ${toolCall.name} not found.`
                yield {
                  type: 'response',
                  data: {
                    eventId,
                    tool_call: 'error',
                    tool_call_id: toolCall.id,
                    tool_call_name: toolCall.name,
                    tool_call_response: errorMsg
                  }
                }

                // Add error message to conversation history for the LLM
                conversationMessages.push({
                  role: 'user', // or 'tool' with error content? Let's use user for now.
                  content: `Error: ${errorMsg}`
                })
                continue // Skip to next tool call
              }

              // Prepare MCPToolCall object for callTool
              const mcpToolInput: MCPToolCall = {
                id: toolCall.id,
                type: 'function',
                function: {
                  name: toolCall.name,
                  arguments: toolCall.arguments
                },
                server: toolDef.server
              }

              // Yield tool start event
              yield {
                type: 'response',
                data: {
                  eventId,
                  tool_call: 'running',
                  tool_call_id: toolCall.id,
                  tool_call_name: toolCall.name,
                  tool_call_params: toolCall.arguments,
                  tool_call_server_name: toolDef.server.name,
                  tool_call_server_icons: toolDef.server.icons,
                  tool_call_server_description: toolDef.server.description
                }
              }

              try {
                // Execute the tool via McpPresenter
                const toolResponse = await presenter.mcpPresenter.callTool(mcpToolInput)

                if (abortController.signal.aborted) break // Check after tool call returns

                // Add tool call and response to conversation history for the next LLM iteration
                const supportsFunctionCall = modelConfig?.functionCall || false

                if (supportsFunctionCall) {
                  // Add original tool call message from assistant
                  const lastAssistantMsg = conversationMessages.findLast(
                    (m) => m.role === 'assistant'
                  )
                  if (lastAssistantMsg) {
                    if (!lastAssistantMsg.tool_calls) lastAssistantMsg.tool_calls = []
                    lastAssistantMsg.tool_calls.push({
                      function: {
                        arguments: toolCall.arguments,
                        name: toolCall.name
                      },
                      id: toolCall.id,
                      type: 'function'
                    })
                  } else {
                    // Should not happen if we added assistant message earlier, but as fallback:
                    conversationMessages.push({
                      role: 'assistant',
                      tool_calls: [
                        {
                          function: {
                            arguments: toolCall.arguments,
                            name: toolCall.name
                          },
                          id: toolCall.id,
                          type: 'function'
                        }
                      ]
                    })
                  }

                  // Add tool role message with result
                  conversationMessages.push({
                    role: 'tool',
                    content:
                      typeof toolResponse.content === 'string'
                        ? toolResponse.content
                        : JSON.stringify(toolResponse.content),
                    tool_call_id: toolCall.id
                  })
                } else {
                  // Non-native function calling: Append call and response differently

                  // 1. Append tool call info to the last assistant message
                  const lastAssistantMessage = conversationMessages.findLast(
                    (message) => message.role === 'assistant'
                  )
                  if (lastAssistantMessage) {
                    const toolCallInfo = `\n<function_call>
                    {
                      "function_call": ${JSON.stringify(
                        {
                          id: toolCall.id,
                          name: toolCall.name,
                          arguments: toolCall.arguments // Keep original args here
                        },
                        null,
                        2
                      )}
                    }
                    </function_call>\n`

                    if (typeof lastAssistantMessage.content === 'string') {
                      lastAssistantMessage.content += toolCallInfo
                    } else if (Array.isArray(lastAssistantMessage.content)) {
                      // Find the last text part or add a new one
                      const lastTextPart = lastAssistantMessage.content.findLast(
                        (part) => part.type === 'text'
                      )
                      if (lastTextPart) {
                        lastTextPart.text += toolCallInfo
                      } else {
                        lastAssistantMessage.content.push({ type: 'text', text: toolCallInfo })
                      }
                    }
                  }

                  // 2. Create a user message containing the tool response
                  const toolResponseContent =
                    '以下是刚刚执行的工具调用响应，请根据响应内容更新你的回答：\n' +
                    JSON.stringify({
                      role: 'tool', // Indicate it's a tool response
                      content:
                        typeof toolResponse.content === 'string'
                          ? toolResponse.content
                          : JSON.stringify(toolResponse.content), // Stringify complex content
                      tool_call_id: toolCall.id
                    })

                  // Append to last user message or create new one
                  const lastMessage = conversationMessages[conversationMessages.length - 1]
                  if (lastMessage && lastMessage.role === 'user') {
                    if (typeof lastMessage.content === 'string') {
                      lastMessage.content += '\n' + toolResponseContent
                    } else if (Array.isArray(lastMessage.content)) {
                      lastMessage.content.push({
                        type: 'text',
                        text: toolResponseContent
                      })
                    }
                  } else {
                    conversationMessages.push({
                      role: 'user',
                      content: toolResponseContent
                    })
                  }
                }

                // Yield tool end event with response
                yield {
                  type: 'response',
                  data: {
                    eventId,
                    tool_call: 'end',
                    tool_call_id: toolCall.id,
                    tool_call_response: toolResponse.content, // Simplified content for UI
                    tool_call_name: toolCall.name,
                    tool_call_params: toolCall.arguments, // Original params
                    tool_call_server_name: toolDef.server.name,
                    tool_call_server_icons: toolDef.server.icons,
                    tool_call_server_description: toolDef.server.description,
                    tool_call_response_raw: toolResponse.rawData // Full raw data
                  }
                }
              } catch (toolError) {
                if (abortController.signal.aborted) break // Check after tool error

                console.error(
                  `Tool execution error for ${toolCall.name} (event ${eventId}):`,
                  toolError
                )
                const errorMessage =
                  toolError instanceof Error ? toolError.message : String(toolError)

                // Yield tool error event
                yield {
                  type: 'response', // Still a response event, but indicates tool error
                  data: {
                    eventId,
                    tool_call: 'error',
                    tool_call_id: toolCall.id,
                    tool_call_name: toolCall.name,
                    tool_call_params: toolCall.arguments,
                    tool_call_response: errorMessage, // Error message as response
                    tool_call_server_name: toolDef.server.name,
                    tool_call_server_icons: toolDef.server.icons,
                    tool_call_server_description: toolDef.server.description
                  }
                }

                // Add error message to conversation history for the LLM
                conversationMessages.push({
                  role: 'user', // Or 'tool' with error? Use user for now.
                  content: `Error executing tool ${toolCall.name}: ${errorMessage}`
                })
                // Decide if the loop should continue after a tool error.
                // For now, let's assume it should try to continue if possible.
                // needContinueConversation might need adjustment based on error type.
              }
            } // End of tool execution loop

            if (abortController.signal.aborted) break // Check after tool loop

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

      this.activeStreams.delete(eventId)
      console.log('Agent loop finished for event:', eventId, 'User stopped:', userStop)
    }
  }

  // 非流式方法
  async generateCompletion(
    providerId: string,
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string> {
    // 记录输入到大模型的消息内容
    console.log('generateCompletion', providerId, modelId, temperature, maxTokens, messages)
    const provider = this.getProviderInstance(providerId)
    const response = await provider.completions(messages, modelId, temperature, maxTokens)
    return response.content
  }

  async generateSummary(
    providerId: string,
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    const provider = this.getProviderInstance(providerId)
    return provider.summaries(text, modelId, temperature, maxTokens)
  }

  async generateText(
    providerId: string,
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    const provider = this.getProviderInstance(providerId)
    return provider.generateText(prompt, modelId, temperature, maxTokens)
  }

  async generateCompletionStandalone(
    providerId: string,
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string> {
    const provider = this.getProviderInstance(providerId)
    let response = ''
    try {
      const llmResponse = await provider.completions(messages, modelId, temperature, maxTokens)
      response = llmResponse.content

      return response
    } catch (error) {
      console.error('Stream error:', error)
      return ''
    }
  }

  // 配置相关方法
  setMaxConcurrentStreams(max: number): void {
    this.config.maxConcurrentStreams = max
  }

  getMaxConcurrentStreams(): number {
    return this.config.maxConcurrentStreams
  }

  async check(providerId: string): Promise<{ isOk: boolean; errorMsg: string | null }> {
    const provider = this.getProviderInstance(providerId)
    return provider.check()
  }

  async addCustomModel(
    providerId: string,
    model: Omit<MODEL_META, 'providerId' | 'isCustom' | 'group'>
  ): Promise<MODEL_META> {
    const provider = this.getProviderInstance(providerId)
    return provider.addCustomModel(model)
  }

  async removeCustomModel(providerId: string, modelId: string): Promise<boolean> {
    const provider = this.getProviderInstance(providerId)
    return provider.removeCustomModel(modelId)
  }

  async updateCustomModel(
    providerId: string,
    modelId: string,
    updates: Partial<MODEL_META>
  ): Promise<boolean> {
    const provider = this.getProviderInstance(providerId)
    const res = provider.updateCustomModel(modelId, updates)
    this.configPresenter.updateCustomModel(providerId, modelId, updates)
    return res
  }

  async getCustomModels(providerId: string): Promise<MODEL_META[]> {
    const provider = this.getProviderInstance(providerId)
    return provider.getCustomModels()
  }

  async summaryTitles(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    providerId: string,
    modelId: string
  ): Promise<string> {
    const provider = this.getProviderInstance(providerId)
    return provider.summaryTitles(messages, modelId)
  }

  // 获取 OllamaProvider 实例
  getOllamaProviderInstance(): OllamaProvider | null {
    // 从所有 provider 中找到已经启用的 ollama provider
    for (const provider of this.providers.values()) {
      if (provider.id === 'ollama' && provider.enable) {
        const providerInstance = this.providerInstances.get(provider.id)
        if (providerInstance instanceof OllamaProvider) {
          return providerInstance
        }
      }
    }
    return null
  }
  // ollama api
  listOllamaModels(): Promise<OllamaModel[]> {
    const provider = this.getOllamaProviderInstance()
    if (!provider) {
      // console.error('Ollama provider not found')
      return Promise.resolve([])
    }
    return provider.listModels()
  }
  showOllamaModelInfo(modelName: string): Promise<ShowResponse> {
    const provider = this.getOllamaProviderInstance()
    if (!provider) {
      throw new Error('Ollama provider not found')
    }
    return provider.showModelInfo(modelName)
  }
  listOllamaRunningModels(): Promise<OllamaModel[]> {
    const provider = this.getOllamaProviderInstance()
    if (!provider) {
      // console.error('Ollama provider not found')
      return Promise.resolve([])
    }
    return provider.listRunningModels()
  }
  pullOllamaModels(modelName: string): Promise<boolean> {
    const provider = this.getOllamaProviderInstance()
    if (!provider) {
      throw new Error('Ollama provider not found')
    }
    return provider.pullModel(modelName, (progress) => {
      console.log('pullOllamaModels', {
        eventId: 'pullOllamaModels',
        modelName: modelName,
        ...progress
      })
      eventBus.emit(OLLAMA_EVENTS.PULL_MODEL_PROGRESS, {
        eventId: 'pullOllamaModels',
        modelName: modelName,
        ...progress
      })
    })
  }
  deleteOllamaModel(modelName: string): Promise<boolean> {
    const provider = this.getOllamaProviderInstance()
    if (!provider) {
      throw new Error('Ollama provider not found')
    }
    return provider.deleteModel(modelName)
  }
}
