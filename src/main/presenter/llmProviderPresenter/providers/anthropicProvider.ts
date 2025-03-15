import { LLM_PROVIDER, LLMResponse, LLMResponseStream, MODEL_META } from '@shared/presenter'
import { BaseLLMProvider } from '../baseProvider'
import { ConfigPresenter } from '../../configPresenter'
import Anthropic from '@anthropic-ai/sdk'
import { ChatMessage } from '../baseProvider'
import { presenter } from '@/presenter'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { proxyConfig } from '../../proxyConfig'

// 定义Anthropic工具使用的接口
interface AnthropicToolUse {
  id: string
  name: string
  input: Record<string, unknown>
}

export class AnthropicProvider extends BaseLLMProvider {
  private anthropic!: Anthropic
  private defaultModel = 'claude-3-7-sonnet-20250219'

  constructor(provider: LLM_PROVIDER, configPresenter: ConfigPresenter) {
    super(provider, configPresenter)
    this.init()
  }

  protected async init() {
    if (this.provider.enable) {
      try {
        const apiKey = this.provider.apiKey || process.env.ANTHROPIC_API_KEY
        const proxyUrl = proxyConfig.getProxyUrl()
        this.anthropic = new Anthropic({
          apiKey: apiKey,
          baseURL: this.provider.baseUrl || 'https://api.anthropic.com',
          httpAgent: proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined
        })
        await super.init()
      } catch (error) {
        console.error('Failed to initialize Anthropic provider:', error)
      }
    }
  }

  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    // Anthropic 目前没有提供获取模型列表的 API，所以我们手动定义支持的模型
    return [
      {
        id: 'claude-3-7-sonnet-20250219',
        name: 'Claude 3.7 Sonnet',
        providerId: this.provider.id,
        maxTokens: 200000,
        group: 'Claude 3.7',
        isCustom: false,
        contextLength: 200000
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        providerId: this.provider.id,
        maxTokens: 200000,
        group: 'Claude 3.5',
        isCustom: false,
        contextLength: 200000
      },
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        providerId: this.provider.id,
        maxTokens: 200000,
        group: 'Claude 3.5',
        isCustom: false,
        contextLength: 200000
      },
      {
        id: 'claude-3-5-sonnet-20240620',
        name: 'Claude 3.5 Sonnet (Legacy)',
        providerId: this.provider.id,
        maxTokens: 200000,
        group: 'Claude 3.5',
        isCustom: false,
        contextLength: 200000
      },
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        providerId: this.provider.id,
        maxTokens: 200000,
        group: 'Claude 3',
        isCustom: false,
        contextLength: 200000
      },
      {
        id: 'claude-3-haiku-20240307',
        name: 'Claude 3 Haiku',
        providerId: this.provider.id,
        maxTokens: 200000,
        group: 'Claude 3',
        isCustom: false,
        contextLength: 200000
      }
    ]
  }

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      if (!this.anthropic) {
        return { isOk: false, errorMsg: '未初始化 Anthropic SDK' }
      }

      // 发送一个简单请求来检查 API 连接状态
      await this.anthropic.messages.create({
        model: this.defaultModel,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hello' }]
      })

      return { isOk: true, errorMsg: null }
    } catch (error: unknown) {
      console.error('Anthropic API check failed:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { isOk: false, errorMsg: `API 检查失败: ${errorMessage}` }
    }
  }

  private formatMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
    const formattedMessages: Anthropic.MessageParam[] = []
    let systemContent = ''

    // 收集所有系统消息
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemContent +=
          (typeof msg.content === 'string'
            ? msg.content
            : msg.content
                .filter((c) => c.type === 'text')
                .map((c) => c.text)
                .join('\n')) + '\n'
      } else {
        // 处理消息内容
        let formattedContent: Anthropic.ContentBlockParam[] = []

        if (typeof msg.content === 'string') {
          formattedContent = [{ type: 'text', text: msg.content }]
        } else {
          formattedContent = msg.content.map((content) => {
            if (content.type === 'image_url') {
              return {
                type: 'image',
                source: { type: 'url', url: content.image_url!.url }
              }
            } else {
              return { type: 'text', text: content.text || '' }
            }
          })
        }

        formattedMessages.push({
          role: msg.role as 'user' | 'assistant',
          content: formattedContent
        })
      }
    }

    // 如果有系统消息，添加到第一个用户消息前
    if (systemContent) {
      if (formattedMessages.length > 0 && formattedMessages[0].role === 'user') {
        // 在现有内容前添加系统消息
        const existingContent = formattedMessages[0].content
        formattedMessages[0].content = [
          { type: 'text' as const, text: systemContent },
          ...(Array.isArray(existingContent)
            ? existingContent
            : [{ type: 'text' as const, text: String(existingContent) }])
        ]
      } else {
        // 创建新的用户消息
        formattedMessages.unshift({
          role: 'user',
          content: [{ type: 'text' as const, text: systemContent }]
        })
      }
    }
    console.log(JSON.stringify(formattedMessages))
    return formattedMessages
  }

  public async summaryTitles(messages: ChatMessage[], modelId: string): Promise<string> {
    const prompt = `
请为以下对话生成一个简短的标题，不超过6个字：

${messages.map((m) => `${m.role}: ${m.content}`).join('\n')}

只输出标题，不要有任何额外文字。
`
    const response = await this.generateText(prompt, modelId, 0.3, 50)

    return response.content.trim()
  }

  async completions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    try {
      const formattedMessages = this.formatMessages(messages)

      // 获取MCP工具定义
      const mcpTools = await presenter.mcpPresenter.getAllToolDefinitions()

      // 将MCP工具转换为Anthropic工具格式
      const anthropicTools =
        mcpTools.length > 0
          ? await presenter.mcpPresenter.mcpToolsToAnthropicTools(mcpTools, this.provider.id)
          : undefined

      // 创建基本请求参数
      const requestParams: Anthropic.Messages.MessageCreateParams = {
        model: modelId,
        max_tokens: maxTokens || 1024,
        temperature: temperature || 0.7,
        messages: formattedMessages
      }

      // 如果有可用工具，添加到请求中 (使用类型断言处理类型不匹配问题)
      if (anthropicTools && anthropicTools.length > 0) {
        // @ts-ignore - 类型不匹配，但格式是正确的
        requestParams.tools = anthropicTools
      }

      const response = await this.anthropic.messages.create(requestParams)

      // 检查是否包含工具使用
      // @ts-ignore - Anthropic SDK 类型定义中没有包含 tool_uses 字段，但接口响应中可能存在
      const toolUse = response.tool_uses?.[0] as AnthropicToolUse | undefined

      if (toolUse) {
        // 将Anthropic工具调用转换为MCP工具调用
        const mcpToolCall = await presenter.mcpPresenter.anthropicToolUseToMcpTool(
          mcpTools,
          { name: toolUse.name, input: toolUse.input },
          this.provider.id
        )

        if (mcpToolCall) {
          // 调用工具并获取响应
          const toolResponse = await presenter.mcpPresenter.callTool(mcpToolCall)

          // 获取助手的初始响应文本
          const initialResponseText = response.content
            .filter((block) => block.type === 'text')
            .map((block) => (block.type === 'text' ? block.text : ''))
            .join('')

          // 添加工具响应到消息中
          formattedMessages.push({
            role: 'assistant',
            content: [{ type: 'text', text: initialResponseText }]
          })

          formattedMessages.push({
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Tool response: ${typeof toolResponse.content === 'string' ? toolResponse.content : JSON.stringify(toolResponse.content)}`
              }
            ]
          })

          // 继续对话
          const finalParams = {
            model: modelId,
            max_tokens: maxTokens || 1024,
            temperature: temperature || 0.7,
            messages: formattedMessages
          }

          // 如果有可用工具，添加到请求中 (使用类型断言处理类型不匹配问题)
          if (anthropicTools && anthropicTools.length > 0) {
            // @ts-ignore - 类型不匹配，但格式是正确的
            finalParams.tools = anthropicTools
          }

          const finalResponse = await this.anthropic.messages.create(finalParams)

          return {
            content: finalResponse.content
              .filter((block) => block.type === 'text')
              .map((block) => (block.type === 'text' ? block.text : ''))
              .join(''),
            reasoning_content: undefined
          }
        }
      }

      // 常规响应处理
      return {
        content: response.content
          .filter((block) => block.type === 'text')
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join(''),
        reasoning_content: undefined
      }
    } catch (error) {
      console.error('Anthropic completions error:', error)
      throw error
    }
  }

  async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    const prompt = `请对以下内容进行摘要:

${text}

请提供一个简洁明了的摘要。`

    return this.generateText(prompt, modelId, temperature, maxTokens)
  }

  async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    try {
      const response = await this.anthropic.messages.create({
        model: modelId,
        max_tokens: maxTokens || 1024,
        temperature: temperature || 0.7,
        messages: [{ role: 'user', content: prompt }]
      })

      return {
        content: response.content
          .filter((block) => block.type === 'text')
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join(''),
        reasoning_content: undefined
      }
    } catch (error) {
      console.error('Anthropic generate text error:', error)
      throw error
    }
  }

  async suggestions(
    context: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string[]> {
    const prompt = `
根据下面的上下文，给出3个可能的回复建议，每个建议一行，不要有编号或者额外的解释：

${context}
`
    try {
      const response = await this.anthropic.messages.create({
        model: modelId,
        max_tokens: maxTokens || 1024,
        temperature: temperature || 0.7,
        messages: [{ role: 'user', content: prompt }]
      })

      const suggestions = response.content
        .filter((block) => block.type === 'text')
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .slice(0, 3)

      return suggestions
    } catch (error) {
      console.error('Anthropic suggestions error:', error)
      return ['建议生成失败']
    }
  }

  async *streamCompletions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    const formattedMessages = this.formatMessages(messages)

    try {
      // 获取MCP工具定义
      const mcpTools = await presenter.mcpPresenter.getAllToolDefinitions()
      // 将MCP工具转换为Anthropic工具格式
      const anthropicTools =
        mcpTools.length > 0
          ? await presenter.mcpPresenter.mcpToolsToAnthropicTools(mcpTools, this.provider.id)
          : undefined

      // 创建流参数
      const streamParams = {
        model: modelId,
        max_tokens: maxTokens || 1024,
        temperature: temperature || 0.7,
        messages: formattedMessages,
        stream: true
      } as Anthropic.Messages.MessageCreateParamsStreaming

      // 添加工具到参数中
      if (anthropicTools && anthropicTools.length > 0) {
        // @ts-ignore - 类型不匹配，但格式是正确的
        streamParams.tools = anthropicTools
      }

      // Claude 3.7 添加思考功能
      if (modelId.includes('claude-3-7')) {
        streamParams.thinking = { budget_tokens: 1024, type: 'enabled' }
      }

      // 收集工具调用
      const toolCalls: Array<{
        id: string
        name: string
        input: Record<string, unknown>
      }> = []
      let currentContent = ''
      // 存储思考内容
      let reasoningContent = ''
      // 存储当前正在处理的工具调用索引
      let currentToolIndex = -1
      // 是否在等待工具返回
      let waitingForToolResponse = false
      // 存储累积的 JSON 字符串
      let accumulatedJson = ''

      // 创建Anthropic流
      const stream = await this.anthropic.messages.create(streamParams)

      // 处理流中的各种事件
      for await (const chunk of stream) {
        console.log('chunk', chunk)

        // 处理消息开始
        if (chunk.type === 'message_start') {
          // 可以记录消息ID等信息，如果需要的话
          continue
        }

        // 处理内容块开始
        if (chunk.type === 'content_block_start') {
          // 重置累积的 JSON 字符串
          accumulatedJson = ''

          // 处理工具使用开始
          // @ts-ignore - Anthropic SDK 类型定义不完整
          if (chunk.content_block?.type === 'tool_use') {
            // @ts-ignore - content_block 不在类型定义中
            const toolId = chunk.content_block.id
            // @ts-ignore - content_block 不在类型定义中
            const toolName = chunk.content_block.name || ''

            toolCalls.push({
              id: toolId,
              name: toolName,
              input: {}
            })

            currentToolIndex = toolCalls.length - 1
            waitingForToolResponse = true

            continue
          }
          continue
        }

        // 处理内容块结束
        if (chunk.type === 'content_block_stop') {
          // 如果有累积的JSON字符串且当前有正在处理的工具调用
          if (accumulatedJson && currentToolIndex >= 0 && currentToolIndex < toolCalls.length) {
            try {
              // 尝试解析完整的JSON字符串
              // console.log('解析完整JSON:', accumulatedJson)

              // 移除可能的前导/尾随空格并检查是否是有效的JSON格式
              const jsonStr = accumulatedJson.trim()
              if (jsonStr && (jsonStr.startsWith('{') || jsonStr.startsWith('['))) {
                try {
                  const jsonObject = JSON.parse(jsonStr)
                  if (jsonObject && typeof jsonObject === 'object') {
                    toolCalls[currentToolIndex].input = {
                      ...toolCalls[currentToolIndex].input,
                      ...jsonObject
                    }
                  }
                } catch (e) {
                  console.error('解析完整JSON失败:', e)

                  // 尝试提取部分键值对
                  // 例如 {"path": "src/main"} 格式的提取
                  const keyValuePairs = jsonStr.match(/"([^"]+)":\s*"([^"]+)"/g)
                  if (keyValuePairs) {
                    for (const pair of keyValuePairs) {
                      const match = pair.match(/"([^"]+)":\s*"([^"]+)"/)
                      if (match && match.length >= 3) {
                        const key = match[1]
                        const value = match[2]
                        toolCalls[currentToolIndex].input[key] = value
                      }
                    }
                  }
                }
              }
            } catch (e) {
              console.error('处理累积JSON失败:', e)
            }

            // 重置累积的JSON
            accumulatedJson = ''
          }
          continue
        }

        // 处理消息状态更新
        if (chunk.type === 'message_delta') {
          // 检查是否因为工具调用而停止
          if (chunk.delta?.stop_reason === 'tool_use') {
            // 工具调用导致停止，需要处理工具调用
            if (waitingForToolResponse && toolCalls.length > 0) {
              // 处理所有等待的工具调用
              const toolResults: Anthropic.MessageParam[] = []

              for (const toolCall of toolCalls) {
                if (!toolCall.name) continue

                // 将Anthropic工具使用转换为MCP工具调用
                console.log('执行工具调用:', toolCall)

                const mcpToolCall = await presenter.mcpPresenter.anthropicToolUseToMcpTool(
                  mcpTools,
                  { name: toolCall.name, input: toolCall.input },
                  this.provider.id
                )

                if (mcpToolCall) {
                  yield {
                    content: `\n<tool_call name="${toolCall.name}">\n`,
                    reasoning_content: undefined,
                    tool_calling_content: toolCall.name
                  }

                  try {
                    // 调用工具并获取响应
                    const toolResponse = await presenter.mcpPresenter.callTool(mcpToolCall)
                    const responseContent =
                      typeof toolResponse.content === 'string'
                        ? toolResponse.content
                        : JSON.stringify(toolResponse.content)

                    yield {
                      content: `\n<tool_response name="${toolCall.name}">\n`,
                      reasoning_content: undefined,
                      tool_calling_content: toolCall.name
                    }

                    // 添加工具结果到继续对话的消息列表中
                    toolResults.push({
                      role: 'user',
                      content: [
                        {
                          type: 'text',
                          text: `Tool response: ${responseContent}`
                        }
                      ]
                    })
                  } catch (error) {
                    console.error('工具调用失败:', error)
                    const errorMessage = error instanceof Error ? error.message : String(error)

                    yield {
                      content: `\n<tool_call_error name="${toolCall.name}" error="${errorMessage}">\n`,
                      reasoning_content: undefined,
                      tool_calling_content: toolCall.name
                    }

                    toolResults.push({
                      role: 'user',
                      content: [
                        {
                          type: 'text',
                          text: `Tool response error: ${errorMessage}`
                        }
                      ]
                    })
                  }
                }
              }

              // 如果有工具结果，继续对话
              if (toolResults.length > 0) {
                yield {
                  content: `\n<tool_call_end name="${toolCalls[currentToolIndex].name}">\n`,
                  reasoning_content: undefined
                }

                // 添加助手的初始响应
                const newMessages = [
                  ...formattedMessages,
                  {
                    role: 'assistant',
                    content: [{ type: 'text', text: currentContent }]
                  },
                  ...toolResults
                ]

                // 创建新的流参数
                const newStreamParams = {
                  model: modelId,
                  max_tokens: maxTokens || 1024,
                  temperature: temperature || 0.7,
                  messages: newMessages,
                  stream: true
                } as Anthropic.Messages.MessageCreateParamsStreaming

                // 添加工具到新参数
                if (anthropicTools && anthropicTools.length > 0) {
                  // @ts-ignore - 类型不匹配，但格式是正确的
                  newStreamParams.tools = anthropicTools
                }

                // 创建新的流
                const newStream = await this.anthropic.messages.create(newStreamParams)

                // 处理新的流
                for await (const newChunk of newStream) {
                  console.log('工具响应后的新chunk:', newChunk)

                  if (
                    newChunk.type === 'content_block_delta' &&
                    newChunk.delta.type === 'text_delta'
                  ) {
                    yield {
                      content: newChunk.delta.text,
                      reasoning_content: undefined
                    }
                  }
                }
              }

              // 重置工具调用状态
              waitingForToolResponse = false
              toolCalls.length = 0
              currentToolIndex = -1
              accumulatedJson = ''
            }
          }
          continue
        }

        // 处理消息结束
        if (chunk.type === 'message_stop') {
          // 消息完全结束
          continue
        }

        // 处理工具使用更新 - input_json_delta
        // @ts-ignore - 类型定义中没有工具相关字段
        if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'input_json_delta') {
          if (currentToolIndex >= 0 && currentToolIndex < toolCalls.length) {
            // @ts-ignore - partial_json 不在类型定义中
            const partialJson = chunk.delta.partial_json

            if (partialJson) {
              // 累积JSON片段
              accumulatedJson += partialJson
            }
          }
          continue
        }

        // 处理工具使用更新 - tool_use_delta
        // @ts-ignore - 类型定义中没有工具相关字段
        if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'tool_use_delta') {
          if (currentToolIndex >= 0) {
            const toolCall = toolCalls[currentToolIndex]
            // @ts-ignore - delta 不在类型定义中
            if (chunk.delta.name) {
              // @ts-ignore - 访问 delta.name
              toolCall.name = chunk.delta.name
            }

            // @ts-ignore - delta.input 不在类型定义中
            if (chunk.delta.input) {
              toolCall.input = {
                ...toolCall.input,
                // @ts-ignore - 访问 delta.input
                ...chunk.delta.input
              }
            }
          }
          continue
        }

        // 处理常规文本内容
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          currentContent += chunk.delta.text
          yield {
            content: chunk.delta.text,
            reasoning_content: undefined
          }
        }

        // 处理思考内容（如果有）
        // @ts-ignore - 类型定义中没有thinking相关字段
        if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'thinking_delta') {
          // @ts-ignore - delta.thinking不在类型定义中
          reasoningContent += chunk.delta.thinking
          yield {
            content: undefined,
            // @ts-ignore - delta.thinking不在类型定义中
            reasoning_content: chunk.delta.thinking
          }
        }
      }

      // 输出摘要信息（如果有）
      if (reasoningContent) {
        yield {
          content: undefined,
          reasoning_content: reasoningContent
        }
      }

      // 流结束标记
      yield {
        content: undefined,
        reasoning_content: undefined
      }
    } catch (error) {
      console.error('Anthropic stream completions error:', error)
      yield {
        content: `错误: ${error instanceof Error ? error.message : String(error)}`,
        reasoning_content: undefined
      }

      yield {
        content: undefined,
        reasoning_content: undefined
      }
    }
  }

  async *streamSummaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    const prompt = `请对以下内容进行摘要:

${text}

请提供一个简洁明了的摘要。`

    yield* this.streamGenerateText(prompt, modelId, temperature, maxTokens)
  }

  async *streamGenerateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    try {
      const stream = await this.anthropic.messages.create({
        model: modelId,
        max_tokens: maxTokens || 1024,
        temperature: temperature || 0.7,
        messages: [{ role: 'user', content: prompt }],
        stream: true
      })

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          yield {
            content: chunk.delta.text,
            reasoning_content: undefined
          }
        }
      }

      yield {
        content: undefined,
        reasoning_content: undefined
      }
    } catch (error) {
      console.error('Anthropic stream generate text error:', error)
      throw error
    }
  }
}
