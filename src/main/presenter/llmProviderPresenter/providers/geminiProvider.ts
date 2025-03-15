import { LLM_PROVIDER, LLMResponse, LLMResponseStream, MODEL_META } from '@shared/presenter'
import { BaseLLMProvider, ChatMessage } from '../baseProvider'
import { GoogleGenerativeAI, GenerativeModel, Part, Content } from '@google/generative-ai'
import { ConfigPresenter } from '../../configPresenter'
import { presenter } from '@/presenter'

export class GeminiProvider extends BaseLLMProvider {
  private genAI: GoogleGenerativeAI

  constructor(provider: LLM_PROVIDER, configPresenter: ConfigPresenter) {
    super(provider, configPresenter)
    this.genAI = new GoogleGenerativeAI(this.provider.apiKey)
    this.init()
  }

  // 实现BaseLLMProvider中的抽象方法fetchProviderModels
  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    // Gemini没有获取模型的API，返回硬编码的模型列表
    return [
      {
        id: 'models/gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        group: 'default',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 1048576,
        maxTokens: 8192,
        description: 'Gemini 2.0 Flash 模型'
      },
      {
        id: 'models/gemini-2.0-flash-lite',
        name: 'Gemini 2.0 Flash-Lite',
        group: 'default',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 1048576,
        maxTokens: 8192,
        description: 'Gemini 2.0 Flash-Lite 模型（更轻量级）'
      },
      {
        id: 'models/gemini-1.5-flash',
        name: 'Gemini 1.5 Flash',
        group: 'default',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 1048576,
        maxTokens: 8192,
        description: 'Gemini 1.5 Flash 模型（更快速、性价比更高）'
      },
      {
        id: 'models/gemini-1.5-flash-8b',
        name: 'Gemini 1.5 Flash-8B',
        group: 'default',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 1048576,
        maxTokens: 8192,
        description: 'Gemini 1.5 Flash-8B 模型（8B 参数版本）'
      },
      {
        id: 'models/gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        group: 'default',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 2097152,
        maxTokens: 8192,
        description: 'Gemini 1.5 Pro 模型（更强大、支持多模态）'
      }
    ]
  }

  // 实现BaseLLMProvider中的summaryTitles抽象方法
  public async summaryTitles(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string
  ): Promise<string> {
    console.log('gemini ignore modelId', modelId)
    // 使用Gemini API生成对话标题
    try {
      const model = this.getModel('models/gemini-1.5-flash-8b', 0.4)
      const conversationText = messages.map((m) => `${m.role}: ${m.content}`).join('\n')
      const prompt = `请为以下对话生成一个简洁的标题，不超过10个字，不使用标点符号或其他特殊符号，语言应该匹配用户的主要语言：\n\n${conversationText}`

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      })

      return result.response.text().trim()
    } catch (error) {
      console.error('生成对话标题失败:', error)
      return '新对话'
    }
  }

  // 重载fetchModels方法，因为Gemini没有获取模型的API
  async fetchModels(): Promise<MODEL_META[]> {
    // Gemini没有获取模型的API，直接使用init方法中的硬编码模型列表
    return this.models
  }

  // 重载check方法，使用第一个默认模型进行测试
  async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      if (!this.provider.apiKey) {
        return { isOk: false, errorMsg: '缺少API密钥' }
      }

      // 使用第一个模型进行简单测试
      const testModel = this.getModel('models/gemini-1.5-flash-8b')
      const result = await testModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }]
      })
      return { isOk: result && result.response ? true : false, errorMsg: null }
    } catch (error) {
      console.error('Provider check failed:', this.provider.name, error)
      return { isOk: false, errorMsg: error instanceof Error ? error.message : String(error) }
    }
  }

  protected async init() {
    if (this.provider.enable) {
      try {
        // 更新 Gemini 模型列表为最新版本
        this.models = [
          {
            id: 'models/gemini-2.0-flash',
            name: 'Gemini 2.0 Flash',
            group: 'default',
            providerId: this.provider.id,
            isCustom: false,
            contextLength: 1048576,
            maxTokens: 8192,
            description: 'Gemini 2.0 Flash 模型'
          },
          {
            id: 'models/gemini-2.0-flash-lite',
            name: 'Gemini 2.0 Flash-Lite',
            group: 'default',
            providerId: this.provider.id,
            isCustom: false,
            contextLength: 1048576,
            maxTokens: 8192,
            description: 'Gemini 2.0 Flash-Lite 模型（更轻量级）'
          },
          {
            id: 'models/gemini-1.5-flash',
            name: 'Gemini 1.5 Flash',
            group: 'default',
            providerId: this.provider.id,
            isCustom: false,
            contextLength: 1048576,
            maxTokens: 8192,
            description: 'Gemini 1.5 Flash 模型（更快速、性价比更高）'
          },
          {
            id: 'models/gemini-1.5-flash-8b',
            name: 'Gemini 1.5 Flash-8B',
            group: 'default',
            providerId: this.provider.id,
            isCustom: false,
            contextLength: 1048576,
            maxTokens: 8192,
            description: 'Gemini 1.5 Flash-8B 模型（8B 参数版本）'
          },
          {
            id: 'models/gemini-1.5-pro',
            name: 'Gemini 1.5 Pro',
            group: 'default',
            providerId: this.provider.id,
            isCustom: false,
            contextLength: 2097152,
            maxTokens: 8192,
            description: 'Gemini 1.5 Pro 模型（更强大、支持多模态）'
          }
        ]
        await this.autoEnableModelsIfNeeded()
        this.isInitialized = true
        console.info('Provider initialized successfully:', this.provider.name)
      } catch (error) {
        console.warn('Provider initialization failed:', this.provider.name, error)
      }
    }
  }

  // 创建模型实例，每次都创建新的实例，不再缓存
  private getModel(modelId: string, temperature?: number, maxTokens?: number): GenerativeModel {
    const generationConfig = {
      temperature,
      maxOutputTokens: maxTokens
    }

    return this.genAI.getGenerativeModel(
      {
        model: modelId,
        generationConfig
      },
      {
        baseUrl: this.provider.baseUrl
      }
    )
  }

  // 将 ChatMessage 转换为 Gemini 格式的消息
  private formatGeminiMessages(messages: ChatMessage[]): Content[] {
    // 提取系统消息
    const systemMessages = messages.filter((msg) => msg.role === 'system')
    let systemContent = ''
    if (systemMessages.length > 0) {
      systemContent = systemMessages.map((msg) => msg.content).join('\n')
    }

    // 创建Gemini内容数组
    const formattedContents: Content[] = []

    // 如果有系统消息，将其作为第一条用户消息
    if (systemContent) {
      formattedContents.push({
        role: 'user',
        parts: [{ text: systemContent }]
      })
    }

    // 处理非系统消息
    const nonSystemMessages = messages.filter((msg) => msg.role !== 'system')
    for (const message of nonSystemMessages) {
      // 为每条消息创建parts数组
      const parts: Part[] = []

      // 处理消息内容 - 可能是字符串或包含图片的数组
      if (typeof message.content === 'string') {
        // 处理纯文本消息
        parts.push({ text: message.content })
      } else if (Array.isArray(message.content)) {
        // 处理多模态消息（带图片等）
        for (const part of message.content) {
          if (part.type === 'text') {
            parts.push({ text: part.text || '' })
          } else if (part.type === 'image_url' && part.image_url) {
            // 处理图片（假设是 base64 格式）
            const matches = part.image_url.url.match(/^data:([^;]+);base64,(.+)$/)
            if (matches && matches.length === 3) {
              const mimeType = matches[1]
              const base64Data = matches[2]
              parts.push({
                inlineData: {
                  data: base64Data,
                  mimeType: mimeType
                }
              })
            }
          }
        }
      }

      // 只有当parts不为空时，才添加到formattedContents中
      if (parts.length > 0) {
        // 将消息角色转换为Gemini支持的角色
        let role: 'user' | 'model' = 'user'
        if (message.role === 'assistant') {
          role = 'model'
        }

        formattedContents.push({
          role: role,
          parts: parts
        })
      }
    }

    return formattedContents
  }

  // 处理响应，提取思考内容
  private processResponse(text: string): LLMResponse {
    const resultResp: LLMResponse = {
      content: ''
    }

    // 处理 <think> 标签
    if (text) {
      const content = text.trimStart()
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
          resultResp.content = text
        }
      } else {
        // 没有 think 标签，所有内容作为普通内容
        resultResp.content = text
      }
    }

    return resultResp
  }

  // 实现抽象方法
  async completions(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    if (!this.isInitialized) {
      throw new Error('Provider not initialized')
    }

    if (!modelId) {
      throw new Error('Model ID is required')
    }

    try {
      // 每次创建新的模型实例，并传入生成配置
      const model = this.getModel(modelId, temperature, maxTokens)
      const formattedParts = this.formatGeminiMessages(messages)
      const result = await model.generateContent({
        contents: formattedParts
      })
      const text = result.response.text()

      return this.processResponse(text)
    } catch (error) {
      console.error('Gemini completions error:', error)
      throw error
    }
  }

  async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    if (!this.isInitialized) {
      throw new Error('Provider not initialized')
    }

    if (!modelId) {
      throw new Error('Model ID is required')
    }

    try {
      // 每次创建新的模型实例，并传入生成配置
      const model = this.getModel(modelId, temperature, maxTokens)
      const prompt = `请为以下内容生成一个简洁的摘要：\n\n${text}`

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      })

      const response = result.response.text()
      return this.processResponse(response)
    } catch (error) {
      console.error('Gemini summaries error:', error)
      throw error
    }
  }

  async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    if (!this.isInitialized) {
      throw new Error('Provider not initialized')
    }

    if (!modelId) {
      throw new Error('Model ID is required')
    }

    try {
      // 每次创建新的模型实例，并传入生成配置
      const model = this.getModel(modelId, temperature, maxTokens)

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      })

      const response = result.response.text()
      return this.processResponse(response)
    } catch (error) {
      console.error('Gemini generateText error:', error)
      throw error
    }
  }

  async suggestions(
    context: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string[]> {
    if (!this.isInitialized) {
      throw new Error('Provider not initialized')
    }

    if (!modelId) {
      throw new Error('Model ID is required')
    }

    try {
      // 每次创建新的模型实例，并传入生成配置
      const model = this.getModel(modelId, temperature, maxTokens)

      const prompt = `根据以下上下文，请提供最多5个合理的建议选项，每个选项不超过100个字符。请以JSON数组格式返回，不要有其他说明：\n\n${context}`

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      })

      const responseText = result.response.text()

      // 尝试从响应中解析出JSON数组
      try {
        const cleanedText = responseText.replace(/```json|```/g, '').trim()
        const suggestions = JSON.parse(cleanedText)
        if (Array.isArray(suggestions)) {
          return suggestions.map((item) => item.toString())
        }
      } catch (parseError) {
        // 如果解析失败，尝试分行处理
        const lines = responseText
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('```') && !line.includes(':'))
          .map((line) => line.replace(/^[0-9]+\.\s*/, '').replace(/^-\s*/, ''))

        if (lines.length > 0) {
          return lines.slice(0, 5)
        }
      }

      // 如果都失败了，返回一个默认提示
      return ['无法生成建议']
    } catch (error) {
      console.error('Gemini suggestions error:', error)
      return ['发生错误，无法获取建议']
    }
  }

  async *streamCompletions(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    if (!this.isInitialized) {
      throw new Error('Provider not initialized')
    }

    if (!modelId) {
      throw new Error('Model ID is required')
    }

    try {
      // 获取MCP工具定义
      const mcpTools = await presenter.mcpPresenter.getAllToolDefinitions()

      // 将MCP工具转换为Gemini格式的工具
      const geminiTools =
        mcpTools.length > 0
          ? await presenter.mcpPresenter.mcpToolsToGeminiTools(mcpTools, this.provider.id)
          : undefined

      // 每次创建新的模型实例，并传入生成配置
      const model = this.getModel(modelId, temperature, maxTokens)
      const formattedParts = this.formatGeminiMessages(messages)

      // 创建流式生成请求
      // 直接使用 @ts-ignore，因为 Gemini SDK 类型定义与实际 API 有差异
      // @ts-ignore - Gemini SDK类型定义与实际API有差异
      const result = await model.generateContentStream({
        contents: formattedParts,
        tools: geminiTools,
        toolConfig: geminiTools
          ? {
              functionCallingConfig: {
                mode: 'AUTO' // 允许模型自动决定是否调用工具
              }
            }
          : undefined
      })

      // 处理流式响应
      let buffer = ''
      let isInThinkTag = false
      let thinkContent = ''
      let hasThinkTag = false
      // 用于存储函数调用信息
      let functionCallDetected = false
      let functionName = ''
      let functionArgs = {}
      let currentContent = ''

      for await (const chunk of result.stream) {
        // 检查是否包含函数调用
        // @ts-ignore - SDK类型定义不完整
        if (chunk.candidates && chunk.candidates[0]?.content?.parts?.[0]?.functionCall) {
          // @ts-ignore - SDK类型定义不完整
          const functionCall = chunk.candidates[0].content.parts[0].functionCall
          functionCallDetected = true
          functionName = functionCall.name
          functionArgs = functionCall.args || {}

          // 停止继续处理流，转为处理工具调用
          break
        }

        const content = chunk.text()
        if (!content) continue

        currentContent += content
        buffer += content

        // 检查是否包含 <think> 标签
        if (buffer.includes('<think>') && !hasThinkTag) {
          hasThinkTag = true
          const thinkStart = buffer.indexOf('<think>')

          // 发送 <think> 前的内容
          if (thinkStart > 0) {
            yield {
              content: buffer.substring(0, thinkStart)
            }
          }

          buffer = buffer.substring(thinkStart + 7)
          isInThinkTag = true
          continue
        }

        // 检查是否有结束标签 </think>
        if (isInThinkTag && buffer.includes('</think>')) {
          const thinkEnd = buffer.indexOf('</think>')
          thinkContent += buffer.substring(0, thinkEnd)

          // 发送推理内容
          yield {
            reasoning_content: thinkContent
          }

          // 重置并准备处理 </think> 后的内容
          buffer = buffer.substring(thinkEnd + 8)
          isInThinkTag = false
          continue
        }

        // 如果我们在 <think> 标签内，累积推理内容
        if (isInThinkTag) {
          thinkContent += content
          continue
        }

        // 否则，正常发送内容
        yield {
          content
        }
      }

      // 处理函数调用
      if (functionCallDetected && functionName) {
        // 将Gemini函数调用转换为MCP工具调用
        const geminiFunctionCall = {
          name: functionName,
          args: functionArgs
        }

        const mcpToolCall = await presenter.mcpPresenter.geminiFunctionCallToMcpTool(
          mcpTools,
          geminiFunctionCall,
          this.provider.id
        )

        if (mcpToolCall) {
          try {
            // 通知正在调用工具
            yield {
              content: `\n<tool_call name="${functionName}">\n`,
              reasoning_content: undefined,
              tool_calling_content: functionName
            }

            // 调用工具并获取响应
            const toolResponse = await presenter.mcpPresenter.callTool(mcpToolCall)
            const responseContent =
              typeof toolResponse.content === 'string'
                ? toolResponse.content
                : JSON.stringify(toolResponse.content)

            // 通知工具响应结果
            yield {
              content: `\n<tool_response name="${functionName}">\n`,
              reasoning_content: undefined,
              tool_calling_content: functionName
            }

            // 创建一个带有工具响应的新消息
            const newMessages: ChatMessage[] = [
              ...messages.map((m) => ({ ...m })), // 复制原始消息
              {
                role: 'assistant',
                content: currentContent || `我将使用${functionName}工具来回答你的问题。`
              } as ChatMessage,
              {
                role: 'user',
                content: `工具 ${functionName} 的调用结果：${responseContent}`
              } as ChatMessage
            ]

            // 通知继续对话
            yield {
              content: `\n<tool_call_end name="${functionName}">\n`,
              reasoning_content: undefined,
              tool_calling_content: functionName
            }

            // 创建一个新的流生成请求
            const newFormattedParts = this.formatGeminiMessages(newMessages)
            // @ts-ignore - Gemini SDK类型定义与实际API有差异
            const continuationResult = await model.generateContentStream({
              contents: newFormattedParts
            })

            // 处理新的流响应
            for await (const newChunk of continuationResult.stream) {
              const newContent = newChunk.text()
              if (!newContent) continue

              yield {
                content: newContent,
                reasoning_content: undefined
              }
            }
          } catch (error) {
            console.error('工具调用失败:', error)
            const errorMessage = error instanceof Error ? error.message : String(error)

            yield {
              content: `\n<tool_call_error name="${functionName}" error="${errorMessage}">\n`,
              reasoning_content: undefined,
              tool_calling_content: errorMessage
            }

            // 如果工具调用失败，尝试直接回答
            // @ts-ignore - Gemini SDK类型定义与实际API有差异
            const fallbackResult = await model.generateContentStream({
              contents: [
                ...formattedParts,
                {
                  role: 'user',
                  parts: [
                    {
                      text: `请注意，我尝试调用工具失败了（错误：${errorMessage}）。请直接回答用户的问题，不要使用工具。`
                    }
                  ]
                }
              ]
            })

            for await (const fallbackChunk of fallbackResult.stream) {
              const fallbackContent = fallbackChunk.text()
              if (!fallbackContent) continue

              yield {
                content: fallbackContent,
                reasoning_content: undefined
              }
            }
          }
        }
      } else if (buffer) {
        // 如果没有函数调用但有剩余内容，发送它
        yield {
          content: buffer
        }
      }
    } catch (error) {
      console.error('Gemini stream completions error:', error)
      throw error
    }
  }

  async *streamSummaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    if (!this.isInitialized) {
      throw new Error('Provider not initialized')
    }

    if (!modelId) {
      throw new Error('Model ID is required')
    }

    try {
      // 每次创建新的模型实例，并传入生成配置
      const model = this.getModel(modelId, temperature, maxTokens)

      const prompt = `请为以下内容生成一个简洁的摘要：\n\n${text}`

      const result = await model.generateContentStream({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      })

      for await (const chunk of result.stream) {
        const content = chunk.text()
        if (!content) continue

        yield {
          content
        }
      }
    } catch (error) {
      console.error('Gemini streamSummaries error:', error)
      throw error
    }
  }

  async *streamGenerateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    if (!this.isInitialized) {
      throw new Error('Provider not initialized')
    }

    if (!modelId) {
      throw new Error('Model ID is required')
    }

    try {
      // 每次创建新的模型实例，并传入生成配置
      const model = this.getModel(modelId, temperature, maxTokens)

      const result = await model.generateContentStream({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      })

      for await (const chunk of result.stream) {
        const content = chunk.text()
        if (!content) continue

        yield {
          content
        }
      }
    } catch (error) {
      console.error('Gemini streamGenerateText error:', error)
      throw error
    }
  }
}
