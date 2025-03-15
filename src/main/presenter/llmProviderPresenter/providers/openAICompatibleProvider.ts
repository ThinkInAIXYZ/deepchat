import { LLM_PROVIDER, LLMResponse, LLMResponseStream, MODEL_META } from '@shared/presenter'
import { BaseLLMProvider, ChatMessage } from '../baseProvider'
import OpenAI from 'openai'
import { ChatCompletionMessage, ChatCompletionMessageParam } from 'openai/resources'
import { ConfigPresenter } from '../../configPresenter'
import { proxyConfig } from '../../proxyConfig'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { presenter } from '@/presenter'

export class OpenAICompatibleProvider extends BaseLLMProvider {
  protected openai: OpenAI
  private isNoModelsApi: boolean = false
  // 添加不支持 OpenAI 标准接口的供应商黑名单
  private static readonly NO_MODELS_API_LIST = ['doubao']

  constructor(provider: LLM_PROVIDER, configPresenter: ConfigPresenter) {
    super(provider, configPresenter)
    const proxyUrl = proxyConfig.getProxyUrl()
    this.openai = new OpenAI({
      apiKey: this.provider.apiKey,
      baseURL: this.provider.baseUrl,
      httpAgent: proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined
    })
    if (OpenAICompatibleProvider.NO_MODELS_API_LIST.includes(this.provider.id.toLowerCase())) {
      this.isNoModelsApi = true
    }
    this.init()
  }

  // 实现BaseLLMProvider中的抽象方法fetchProviderModels
  protected async fetchProviderModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    // 检查供应商是否在黑名单中
    if (this.isNoModelsApi) {
      console.log(`Provider ${this.provider.name} does not support OpenAI models API`)
      return this.models
    }
    return this.fetchOpenAIModels(options)
  }

  protected async fetchOpenAIModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    const response = await this.openai.models.list(options)
    return response.data.map((model) => ({
      id: model.id,
      name: model.id,
      group: 'default',
      providerId: this.provider.id,
      isCustom: false,
      contextLength: 4096,
      maxTokens: 2048
    }))
  }

  // 辅助方法：格式化消息
  protected formatMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages
  }

  // OpenAI完成方法
  protected async openAICompletion(
    messages: ChatMessage[],
    modelId?: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    if (!this.isInitialized) {
      throw new Error('Provider not initialized')
    }

    if (!modelId) {
      throw new Error('Model ID is required')
    }

    const completion = await this.openai.chat.completions.create({
      messages: messages as ChatCompletionMessageParam[],
      model: modelId,
      stream: false,
      temperature: temperature,
      max_tokens: maxTokens
    })
    const message = completion.choices[0].message as ChatCompletionMessage & {
      reasoning_content?: string
    }
    const resultResp: LLMResponse = {
      content: ''
    }

    // 处理原生 reasoning_content
    if (message.reasoning_content) {
      resultResp.reasoning_content = message.reasoning_content
      resultResp.content = message.content || ''
      return resultResp
    }

    // 处理 <think> 标签
    if (message.content) {
      const content = message.content.trimStart()
      if (content.includes('<think>')) {
        const thinkStart = content.indexOf('<think>')
        const thinkEnd = content.indexOf('</think>')

        if (thinkEnd > thinkStart) {
          // 提取 reasoning_content
          resultResp.reasoning_content = content.substring(thinkStart + 7, thinkEnd).trim()

          // 合并 <think> 前后的普通内容
          const beforeThink = content.substring(0, thinkStart).trim()
          const afterThink = content.substring(thinkEnd + 8).trim()
          resultResp.content = [beforeThink, afterThink].filter(Boolean).join('\n')
        } else {
          // 如果没有找到配对的结束标签，将所有内容作为普通内容
          resultResp.content = message.content
        }
      } else {
        // 没有 think 标签，所有内容作为普通内容
        resultResp.content = message.content
      }
    }

    return resultResp
  }

  // OpenAI流式完成方法
  protected async *openAIStreamCompletion(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: any[],
    modelId?: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    if (!this.isInitialized) {
      throw new Error('Provider not initialized')
    }

    if (!modelId) {
      throw new Error('Model ID is required')
    }

    // 获取MCP工具定义
    const mcpTools = await presenter.mcpPresenter.getAllToolDefinitions()
    const tools = await presenter.mcpPresenter.mcpToolsToOpenAITools(mcpTools, this.provider.id)

    // 记录已处理的工具响应ID
    const processedToolCallIds = new Set<string>()

    // 维护消息上下文
    const conversationMessages = [...messages] as ChatCompletionMessageParam[]

    // 记录是否需要继续对话
    let needContinueConversation = false

    // 启动初始流
    let stream = await this.openai.chat.completions.create({
      messages: messages as ChatCompletionMessageParam[],
      model: modelId,
      stream: true,
      temperature: temperature,
      max_tokens: maxTokens,
      tools: tools
    })

    let hasCheckedFirstChunk = false
    let hasReasoningContent = false
    let buffer = ''
    let isInThinkTag = false
    let initialBuffer = '' // 用于累积开头的内容
    const WINDOW_SIZE = 10 // 滑动窗口大小

    // 辅助函数：清理标签并返回清理后的位置
    const cleanTag = (text: string, tag: string): { cleanedPosition: number; found: boolean } => {
      const tagIndex = text.indexOf(tag)
      if (tagIndex === -1) return { cleanedPosition: 0, found: false }

      // 查找标签结束位置（跳过可能的空白字符）
      let endPosition = tagIndex + tag.length
      while (endPosition < text.length && /\s/.test(text[endPosition])) {
        endPosition++
      }
      return { cleanedPosition: endPosition, found: true }
    }

    // 收集完整的助手响应
    let fullAssistantResponse = ''
    let pendingToolCalls: Array<{
      id: string
      function: { name: string; arguments: string }
      type: 'function'
      index: number
    }> = []

    while (true) {
      for await (const chunk of stream) {
        const choice = chunk.choices[0]

        // console.log('openai chunk', JSON.stringify(choice))
        // 检查是否有函数调用
        if (choice?.delta?.tool_calls && choice.delta.tool_calls.length > 0) {
          // 初始化tool_calls数组（如果尚未初始化）
          if (!pendingToolCalls) {
            pendingToolCalls = []
          }

          // 更新工具调用
          for (const toolCallDelta of choice.delta.tool_calls) {
            // 使用索引作为主要标识符
            const indexKey = toolCallDelta.index !== undefined ? toolCallDelta.index : 0
            const existingToolCall = pendingToolCalls.find(
              (tc) => tc.index === indexKey || (tc.id && tc.id === toolCallDelta.id)
            )

            if (existingToolCall) {
              // 更新现有工具调用
              if (toolCallDelta.id && !existingToolCall.id) {
                existingToolCall.id = toolCallDelta.id
              }

              if (toolCallDelta.type && !existingToolCall.type) {
                existingToolCall.type = 'function'
              }

              if (toolCallDelta.function) {
                if (toolCallDelta.function.name && !existingToolCall.function.name) {
                  existingToolCall.function.name = toolCallDelta.function.name
                }

                if (toolCallDelta.function.arguments) {
                  existingToolCall.function.arguments += toolCallDelta.function.arguments
                  console.log(
                    'existingToolCall.function.arguments',
                    existingToolCall.function.arguments
                  )
                }
              }
            } else {
              // 添加新的工具调用
              pendingToolCalls.push({
                id: toolCallDelta.id || '',
                type: 'function',
                index: indexKey,
                function: {
                  name: toolCallDelta.function?.name || '',
                  arguments: toolCallDelta.function?.arguments || ''
                }
              })
            }
          }

          // 通知工具调用更新 - 扩展LLMResponseStream类型
          yield {
            content: '' // 提供一个空内容以符合LLMResponseStream类型
            // 注意：tool_calls_update属性可能需要添加到LLMResponseStream接口
          }

          continue
        }

        // 处理finish_reason为tool_calls的情况
        if (choice?.finish_reason === 'tool_calls') {
          needContinueConversation = true

          // 添加助手消息到上下文
          conversationMessages.push({
            role: 'assistant',
            content: fullAssistantResponse,
            tool_calls: pendingToolCalls.map((tool) => ({
              id: tool.id,
              type: tool.type,
              function: {
                name: tool.function.name,
                arguments: tool.function.arguments
              }
            }))
          })

          // 处理工具调用并获取工具响应
          for (const toolCall of pendingToolCalls) {
            if (processedToolCallIds.has(toolCall.id)) {
              continue
            }

            processedToolCallIds.add(toolCall.id)

            try {
              // 转换为MCP工具
              const mcpTool = await presenter.mcpPresenter.openAIToolsToMcpTool(
                mcpTools,
                {
                  function: {
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments
                  }
                },
                this.provider.id
              )

              if (!mcpTool) {
                console.warn(`Tool not found: ${toolCall.function.name}`)
                continue
              }

              // 通知调用工具 - 扩展LLMResponseStream类型
              yield {
                content: `\n<tool_call_end name="${toolCall.function.name}">\n` // 提供一个空内容以符合LLMResponseStream类型
                // 注意：tool_call属性可能需要添加到LLMResponseStream接口
              }

              // 调用工具
              const toolCallResponse = await presenter.mcpPresenter.callTool(mcpTool)

              // 将工具响应添加到消息中
              conversationMessages.push({
                role: 'tool',
                content:
                  typeof toolCallResponse.content === 'string'
                    ? toolCallResponse.content
                    : JSON.stringify(toolCallResponse.content),
                tool_call_id: toolCall.id
              })

              // 通知工具调用完成 - 扩展LLMResponseStream类型
              yield {
                content: '' // 提供一个空内容以符合LLMResponseStream类型
                // 注意：tool_call_response属性可能需要添加到LLMResponseStream接口
              }
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : '未知错误'
              console.error(`Error calling tool ${toolCall.function.name}:`, error)

              // 通知工具调用失败 - 扩展LLMResponseStream类型
              yield {
                content: `\n<tool_call_error name="${toolCall.function.name}" error="${errorMessage}">\n` // 提供一个空内容以符合LLMResponseStream类型
                // 注意：tool_call_status属性可能需要添加到LLMResponseStream接口
              }

              // 添加错误响应到消息中
              conversationMessages.push({
                role: 'tool',
                content: `Error: ${errorMessage}`,
                tool_call_id: toolCall.id
              })
            }
          }

          // 重置变量，准备继续对话
          pendingToolCalls = []
          fullAssistantResponse = ''
          break
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const delta = chunk.choices[0]?.delta as any
        // 处理原生 reasoning_content 格式
        if (delta?.reasoning_content) {
          yield {
            reasoning_content: delta.reasoning_content
          }
          continue
        }

        const content = delta?.content || ''
        if (!content) continue

        // 累积完整响应
        fullAssistantResponse += content

        // 检查是否包含 <think> 标签
        if (!hasCheckedFirstChunk) {
          initialBuffer += content
          // 如果积累的内容包含了完整的 <think> 或者已经可以确定不是以 <think> 开头
          if (
            initialBuffer.includes('<think>') ||
            (initialBuffer.length >= 6 && !'<think>'.startsWith(initialBuffer.trimStart()))
          ) {
            hasCheckedFirstChunk = true
            const trimmedContent = initialBuffer.trimStart()
            hasReasoningContent = trimmedContent.includes('<think>')

            // 如果不包含 <think>，直接输出累积的内容
            if (!hasReasoningContent) {
              yield {
                content: initialBuffer
              }
              initialBuffer = ''
            } else {
              // 如果包含 <think>，将内容转移到主 buffer 继续处理
              buffer = initialBuffer
              initialBuffer = ''
              // 立即处理 buffer 中的 think 标签
              if (buffer.includes('<think>')) {
                isInThinkTag = true
                const thinkStart = buffer.indexOf('<think>')
                if (thinkStart > 0) {
                  yield {
                    content: buffer.substring(0, thinkStart)
                  }
                }
                const { cleanedPosition } = cleanTag(buffer, '<think>')
                buffer = buffer.substring(cleanedPosition)
              }
            }
            continue
          } else {
            // 继续累积内容
            continue
          }
        }

        // 如果没有 reasoning_content，直接返回普通内容
        if (!hasReasoningContent) {
          yield {
            content: content
          }
          continue
        }

        // 已经在处理 reasoning_content 模式
        if (!isInThinkTag && buffer.includes('<think>')) {
          isInThinkTag = true
          const thinkStart = buffer.indexOf('<think>')
          if (thinkStart > 0) {
            yield {
              content: buffer.substring(0, thinkStart)
            }
          }
          const { cleanedPosition } = cleanTag(buffer, '<think>')
          buffer = buffer.substring(cleanedPosition)
        } else if (isInThinkTag) {
          buffer += content
          const { found: hasEndTag, cleanedPosition } = cleanTag(buffer, '</think>')
          if (hasEndTag) {
            const thinkEnd = buffer.indexOf('</think>')
            if (thinkEnd > 0) {
              yield {
                reasoning_content: buffer.substring(0, thinkEnd)
              }
            }
            buffer = buffer.substring(cleanedPosition)
            isInThinkTag = false
            hasReasoningContent = false

            // 输出剩余的普通内容
            if (buffer) {
              yield {
                content: buffer
              }
              buffer = ''
            }
          } else {
            // 保持滑动窗口大小的 buffer 来检测结束标签
            if (buffer.length > WINDOW_SIZE) {
              const contentToYield = buffer.slice(0, -WINDOW_SIZE)
              yield {
                reasoning_content: contentToYield
              }
              buffer = buffer.slice(-WINDOW_SIZE)
            }
          }
        } else {
          // 不在任何标签中，累积内容
          buffer += content
          yield {
            content: buffer
          }
          buffer = ''
        }
      }

      // 如果需要继续对话，创建新的流
      if (needContinueConversation) {
        needContinueConversation = false
        stream = await this.openai.chat.completions.create({
          messages: conversationMessages as ChatCompletionMessageParam[],
          model: modelId,
          stream: true,
          temperature: temperature,
          max_tokens: maxTokens,
          tools: tools
        })
      } else {
        // 对话结束
        break
      }
    }

    // 处理剩余的 buffer
    if (initialBuffer) {
      yield {
        content: initialBuffer
      }
    }
    if (buffer) {
      if (isInThinkTag) {
        yield {
          reasoning_content: buffer
        }
      } else {
        yield {
          content: buffer
        }
      }
    }
  }

  // 实现BaseLLMProvider的抽象方法
  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      if (!this.isNoModelsApi) {
        const models = await this.fetchOpenAIModels({
          timeout: 3000
        })
        this.models = models
        // 避免在这里触发事件，而是通过ConfigPresenter来管理模型更新
      }
      return {
        isOk: true,
        errorMsg: null
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      return {
        isOk: false,
        errorMsg: error?.message
      }
    }
  }

  public async summaryTitles(messages: ChatMessage[], modelId: string): Promise<string> {
    const systemPrompt = `You need to summarize the user's conversation into a title of no more than 10 words, with the title language matching the user's primary language, without using punctuation or other special symbols`
    const fullMessage: ChatMessage[] = [
      {
        role: 'system',
        content: systemPrompt
      },
      { role: 'user', content: messages.map((m) => `${m.role}: ${m.content}`).join('\n') }
    ]
    const response = await this.openAICompletion(fullMessage, modelId, 0.5)
    return response.content
  }

  async completions(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return this.openAICompletion(messages, modelId, temperature, maxTokens)
  }

  async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return this.openAICompletion(
      [
        {
          role: 'user',
          content: `请总结以下内容，使用简洁的语言，突出重点：\n${text}`
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
  }

  async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return this.openAICompletion(
      [
        {
          role: 'user',
          content: prompt
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
  }

  async suggestions(
    context: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string[]> {
    const response = await this.openAICompletion(
      [
        {
          role: 'user',
          content: `基于以下上下文，给出3个可能的回复建议，每个建议一行：\n${context}`
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
    return response.content.split('\n').filter((line) => line.trim().length > 0)
  }

  async *streamCompletions(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    yield* this.openAIStreamCompletion(messages, modelId, temperature, maxTokens)
  }

  async *streamSummaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    yield* this.openAIStreamCompletion(
      [
        {
          role: 'user',
          content: `请总结以下内容，使用简洁的语言，突出重点：\n${text}`
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
  }

  async *streamGenerateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    yield* this.openAIStreamCompletion(
      [
        {
          role: 'user',
          content: prompt
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
  }
}
