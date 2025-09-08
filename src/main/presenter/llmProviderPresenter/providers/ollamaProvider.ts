import {
  LLM_PROVIDER,
  LLMResponse,
  MODEL_META,
  OllamaModel,
  ProgressResponse,
  MCPToolDefinition,
  ModelConfig,
  LLMCoreStreamEvent,
  ChatMessage,
  LLM_EMBEDDING_ATTRS,
  IConfigPresenter
} from '@shared/presenter'
import { createStreamEvent } from '@shared/types/core/llm-events'
import { BaseLLMProvider, SUMMARY_TITLES_PROMPT } from '../baseProvider'
import { Ollama, Message, ShowResponse } from 'ollama'
import { presenter } from '@/presenter'
import { EMBEDDING_TEST_KEY, isNormalized } from '@/utils/vector'

// Define Ollama tool type
interface OllamaTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: {
        [key: string]: {
          type: string
          description: string
          enum?: string[]
        }
      }
      required: string[]
    }
  }
}

export class OllamaProvider extends BaseLLMProvider {
  private ollama: Ollama
  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
    if (this.provider.apiKey) {
      this.ollama = new Ollama({
        host: this.provider.baseUrl,
        headers: { Authorization: `Bearer ${this.provider.apiKey}` }
      })
    } else {
      this.ollama = new Ollama({
        host: this.provider.baseUrl
      })
    }
    this.init()
  }

  // Basic Provider functionality implementation
  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    try {
      console.log('Ollama service check', this.ollama, this.provider)
      // Get list of locally installed Ollama models
      const ollamaModels = await this.listModels()

      // Convert Ollama model format to application's MODEL_META format
      return ollamaModels.map((model) => ({
        id: model.name,
        name: model.name,
        providerId: this.provider.id,
        contextLength: 8192, // Default value, can be adjusted based on actual model information
        maxTokens: 2048, // Add required maxTokens field
        isCustom: false,
        group: model.details?.family || 'default',
        description: `${model.details?.parameter_size || ''} ${model.details?.family || ''} model`
      }))
    } catch (error) {
      console.error('Failed to fetch Ollama models:', error)
      return []
    }
  }

  // Helper method: format messages
  private formatMessages(messages: ChatMessage[]): Message[] {
    return messages.map((msg) => {
      if (typeof msg.content === 'string') {
        return {
          role: msg.role,
          content: msg.content
        }
      } else {
        // Separate text and image content
        const text =
          msg.content && Array.isArray(msg.content)
            ? msg.content
                .filter((c) => c.type === 'text')
                .map((c) => c.text)
                .join('\n')
            : ''

        const images =
          msg.content && Array.isArray(msg.content)
            ? (msg.content
                .filter((c) => c.type === 'image_url')
                .map((c) => c.image_url?.url)
                .filter(Boolean) as string[])
            : []

        return {
          role: msg.role,
          content: text,
          ...(images.length > 0 && { images })
        }
      }
    })
  }

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      // Try to get model list to check if Ollama service is available
      await this.ollama.list()
      return { isOk: true, errorMsg: null }
    } catch (error) {
      console.error('Ollama service check failed:', error)
      return {
        isOk: false,
        errorMsg: `Unable to connect to Ollama service: ${(error as Error).message}`
      }
    }
  }

  public async summaryTitles(messages: ChatMessage[], modelId: string): Promise<string> {
    try {
      const prompt = `${SUMMARY_TITLES_PROMPT}\n\n${messages.map((m) => `${m.role}: ${m.content}`).join('\n')}`

      const response = await this.ollama.generate({
        model: modelId,
        prompt: prompt,
        options: {
          temperature: 0.3,
          num_predict: 30
        }
      })

      return response.response.trim()
    } catch (error) {
      console.error('Failed to generate title with Ollama:', error)
      return 'New Conversation'
    }
  }

  public async completions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    try {
      const response = await this.ollama.chat({
        model: modelId,
        messages: this.formatMessages(messages),
        options: {
          temperature: temperature || 0.7,
          num_predict: maxTokens
        }
      })

      const resultResp: LLMResponse = {
        content: ''
      }

      // Ollama may not provide complete token counts
      if (response.prompt_eval_count !== undefined || response.eval_count !== undefined) {
        resultResp.totalUsage = {
          prompt_tokens: response.prompt_eval_count || 0,
          completion_tokens: response.eval_count || 0,
          total_tokens: (response.prompt_eval_count || 0) + (response.eval_count || 0)
        }
      }

      // 处理 thinking 字段
      const content = response.message?.content || ''
      const thinking = response.message?.thinking || ''

      if (thinking) {
        resultResp.reasoning_content = thinking
        resultResp.content = content
      }
      // 处理<think>标签（其他模型）
      else if (content.includes('<think>')) {
        const thinkStart = content.indexOf('<think>')
        const thinkEnd = content.indexOf('</think>')

        if (thinkEnd > thinkStart) {
          // 提取reasoning_content
          resultResp.reasoning_content = content.substring(thinkStart + 7, thinkEnd).trim()

          // 合并<think>前后的普通内容
          const beforeThink = content.substring(0, thinkStart).trim()
          const afterThink = content.substring(thinkEnd + 8).trim()
          resultResp.content = [beforeThink, afterThink].filter(Boolean).join('\n')
        } else {
          // 如果没有找到配对的结束标签，将所有内容作为普通内容
          resultResp.content = content
        }
      } else {
        // 没有特殊格式，所有内容作为普通内容
        resultResp.content = content
      }

      return resultResp
    } catch (error) {
      console.error('Ollama completions failed:', error)
      throw error
    }
  }

  public async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    try {
      const prompt = `Please summarize the following content:\n\n${text}`

      const response = await this.ollama.generate({
        model: modelId,
        prompt: prompt,
        options: {
          temperature: temperature || 0.5,
          num_predict: maxTokens
        }
      })

      return {
        content: response.response,
        reasoning_content: undefined
      }
    } catch (error) {
      console.error('Ollama summaries failed:', error)
      throw error
    }
  }

  public async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    try {
      const response = await this.ollama.generate({
        model: modelId,
        prompt: prompt,
        options: {
          temperature: temperature || 0.7,
          num_predict: maxTokens
        }
      })

      return {
        content: response.response,
        reasoning_content: undefined
      }
    } catch (error) {
      console.error('Ollama generate text failed:', error)
      throw error
    }
  }

  public async suggestions(
    context: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string[]> {
    try {
      const prompt = `Based on the following context, generate 5 possible follow-up questions or suggestions:\n\n${context}`

      const response = await this.ollama.generate({
        model: modelId,
        prompt: prompt,
        options: {
          temperature: temperature || 0.8,
          num_predict: maxTokens || 200
        }
      })

      // 简单处理返回的文本，按行分割，并过滤掉空行
      return response.response
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && line.length > 0)
        .slice(0, 5) // 最多返回5个建议
    } catch (error) {
      console.error('Ollama suggestions failed:', error)
      return []
    }
  }

  private async attachModelInfo(model: OllamaModel): Promise<OllamaModel> {
    const showResponse = await this.showModelInfo(model.name)
    const info = showResponse.model_info
    const family = model.details.family
    const context_length = info?.[family + '.context_length'] ?? 4096
    const embedding_length = info?.[family + '.embedding_length'] ?? 512
    const capabilities = showResponse.capabilities ?? ['chat']

    // Merge customConfig properties to model
    return {
      ...model,
      model_info: {
        context_length,
        embedding_length
      },
      capabilities
    }
  }

  // Ollama 特有的模型管理功能
  public async listModels(): Promise<OllamaModel[]> {
    try {
      const response = await this.ollama.list()
      const models = response.models as unknown as OllamaModel[]
      // FIXME: Merge model properties, optimize after ollama list API is improved
      return await Promise.all(models.map(async (model) => this.attachModelInfo(model)))
    } catch (error) {
      console.error('Failed to list Ollama models:', (error as Error).message)
      return []
    }
  }

  public async listRunningModels(): Promise<OllamaModel[]> {
    try {
      const response = await this.ollama.ps()
      const runningModels = response.models as unknown as OllamaModel[]
      // FIXME: Merge model properties, optimize after ollama list API is improved
      return await Promise.all(runningModels.map(async (model) => this.attachModelInfo(model)))
    } catch (error) {
      console.error('Failed to list running Ollama models:', (error as Error).message)
      return []
    }
  }

  public async pullModel(
    modelName: string,
    onProgress?: (progress: ProgressResponse) => void
  ): Promise<boolean> {
    try {
      const stream = await this.ollama.pull({
        model: modelName,
        insecure: true,
        stream: true
      })

      for await (const chunk of stream) {
        if (onProgress) {
          onProgress(chunk as ProgressResponse)
        }
      }

      return true
    } catch (error) {
      console.error(`Failed to pull Ollama model ${modelName}:`, (error as Error).message)
      return false
    }
  }

  public async deleteModel(modelName: string): Promise<boolean> {
    try {
      await this.ollama.delete({
        model: modelName
      })
      return true
    } catch (error) {
      console.error(`Failed to delete Ollama model ${modelName}:`, (error as Error).message)
      return false
    }
  }

  public async showModelInfo(modelName: string): Promise<ShowResponse> {
    try {
      const response = await this.ollama.show({
        model: modelName
      })
      return response
    } catch (error) {
      console.error(`Failed to show Ollama model info for ${modelName}:`, (error as Error).message)
      throw error
    }
  }

  // 辅助方法：将 MCP 工具转换为 Ollama 工具格式
  private async convertToOllamaTools(mcpTools: MCPToolDefinition[]): Promise<OllamaTool[]> {
    const openAITools = await presenter.mcpPresenter.mcpToolsToOpenAITools(
      mcpTools,
      this.provider.id
    )
    return openAITools.map((rawTool) => {
      const tool = rawTool as unknown as {
        function: {
          name: string
          description?: string
          parameters: { properties: Record<string, unknown>; required?: string[] }
        }
      }
      const properties = tool.function.parameters.properties || {}
      const convertedProperties: Record<
        string,
        { type: string; description: string; enum?: string[] }
      > = {}

      for (const [key, value] of Object.entries(properties)) {
        if (typeof value === 'object' && value !== null) {
          const param = value as { type: unknown; description: unknown; enum?: string[] }
          convertedProperties[key] = {
            type: String(param.type || 'string'),
            description: String(param.description || ''),
            ...(param.enum ? { enum: param.enum } : {})
          }
        }
      }

      return {
        type: 'function' as const,
        function: {
          name: tool.function.name,
          description: tool.function.description || '',
          parameters: {
            type: 'object' as const,
            properties: convertedProperties,
            required: tool.function.parameters.required || []
          }
        }
      }
    })
  }

  // 实现BaseLLMProvider抽象方法 - 核心流处理
  async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    mcpTools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    if (!modelId) throw new Error('Model ID is required')
    // Ollama 不需要图片生成分支，直接处理聊天完成
    yield* this.handleChatCompletion(
      messages,
      modelId,
      modelConfig,
      temperature,
      maxTokens,
      mcpTools
    )
  }

  ///////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * 处理 Ollama 聊天补全模型请求的内部方法。
   * @param messages 聊天消息数组。
   * @param modelId 模型ID。
   * @param modelConfig 模型配置。
   * @param temperature 温度参数。
   * @param maxTokens 最大 token 数。
   * @param mcpTools MCP 工具定义数组。
   * @returns AsyncGenerator<LLMCoreStreamEvent> 流式事件。
   */
  private async *handleChatCompletion(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    mcpTools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    try {
      const tools = mcpTools || []
      const supportsFunctionCall = modelConfig?.functionCall || false
      let processedMessages = this.formatMessages(messages)

      // 工具参数准备
      let ollamaTools: OllamaTool[] | undefined = undefined
      if (tools.length > 0) {
        if (supportsFunctionCall) {
          // 支持原生函数调用，转换工具定义
          ollamaTools = await this.convertToOllamaTools(tools)
        } else {
          // 不支持原生函数调用，使用提示词包装
          processedMessages = this.prepareFunctionCallPrompt(processedMessages, tools)
          // Ollama对于非原生支持通常情况下也不需要传递tools参数
          ollamaTools = undefined
        }
      }

      // Ollama聊天参数
      const chatParams = {
        model: modelId,
        messages: processedMessages,
        options: {
          temperature: temperature || 0.7,
          num_predict: maxTokens
        },
        stream: true as const,
        ...(modelConfig?.reasoningEffort && { reasoning_effort: modelConfig.reasoningEffort }),
        ...(supportsFunctionCall && ollamaTools && ollamaTools.length > 0
          ? { tools: ollamaTools }
          : {})
      }

      // 创建流
      const stream = await this.ollama.chat(chatParams)

      // --- 状态变量 ---
      type TagState = 'none' | 'start' | 'inside' | 'end'
      let thinkState: TagState = 'none'
      let funcState: TagState = 'none'

      let pendingBuffer = '' // 用于标签匹配和潜在文本输出的缓冲区
      let thinkBuffer = '' // 思考内容缓冲区
      let funcCallBuffer = '' // 非原生函数调用内容的缓冲区
      let codeBlockBuffer = '' // 代码块内容的缓冲区

      const thinkStartMarker = '<think>'
      const thinkEndMarker = '</think>'
      const funcStartMarker = '<function_call>'
      const funcEndMarker = '</function_call>'

      // 代码块标记变体
      const codeBlockMarkers = [
        '```tool_code',
        '```tool',
        '``` tool_code',
        '``` tool',
        '```function_call',
        '``` function_call'
      ]
      const codeBlockEndMarker = '```'

      let isInCodeBlock = false

      // 用于跟踪原生工具调用
      const nativeToolCalls: Record<
        string,
        { name: string; arguments: string; completed?: boolean }
      > = {}
      let stopReason: LLMCoreStreamEvent['stop_reason'] = 'complete'
      let toolUseDetected = false
      let usage:
        | {
            prompt_tokens: number
            completion_tokens: number
            total_tokens: number
          }
        | undefined = undefined

      // --- 流处理循环 ---
      for await (const chunk of stream) {
        // 处理使用统计
        if (chunk.prompt_eval_count !== undefined || chunk.eval_count !== undefined) {
          usage = {
            prompt_tokens: chunk.prompt_eval_count || 0,
            completion_tokens: chunk.eval_count || 0,
            total_tokens: (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0)
          }
        }

        // 处理原生工具调用
        if (
          supportsFunctionCall &&
          chunk.message?.tool_calls &&
          chunk.message.tool_calls.length > 0
        ) {
          toolUseDetected = true
          for (const toolCall of chunk.message.tool_calls) {
            const toolId = toolCall.function?.name || `ollama-tool-${Date.now()}`
            if (!nativeToolCalls[toolId]) {
              nativeToolCalls[toolId] = {
                name: toolCall.function?.name || '',
                arguments: JSON.stringify(toolCall.function?.arguments || {})
              }

              // 发送工具调用开始事件
              yield createStreamEvent.toolCallStart(toolId, toolCall.function?.name || '')

              // 发送工具调用参数块事件
              yield createStreamEvent.toolCallChunk(
                toolId,
                JSON.stringify(toolCall.function?.arguments || {})
              )

              // 发送工具调用结束事件
              yield createStreamEvent.toolCallEnd(
                toolId,
                JSON.stringify(toolCall.function?.arguments || {})
              )
            }
          }

          stopReason = 'tool_use'
          continue
        }

        // 处理 thinking 字段
        const currentThinking = chunk.message?.thinking || ''
        if (currentThinking) {
          yield createStreamEvent.reasoning(currentThinking)
        }

        // 获取当前内容
        const currentContent = chunk.message?.content || ''
        if (!currentContent) continue

        // 逐字符处理
        for (const char of currentContent) {
          pendingBuffer += char
          let processedChar = false // 标记字符是否被状态逻辑处理

          // --- 处理代码块 ---
          if (isInCodeBlock) {
            codeBlockBuffer += char

            // 检查代码块结束
            if (codeBlockBuffer.endsWith(codeBlockEndMarker)) {
              isInCodeBlock = false
              const codeContent = codeBlockBuffer
                .substring(0, codeBlockBuffer.length - codeBlockEndMarker.length)
                .trim()

              try {
                // 尝试解析JSON
                let parsedCall
                try {
                  // 移除可能的语言标识和开头的空白
                  const cleanContent = codeContent.replace(/^tool_code\s*/i, '').trim()
                  parsedCall = JSON.parse(cleanContent)
                } catch {
                  // 尝试修复通用JSON格式问题
                  const cleanContent = codeContent.replace(/^tool_code\s*/i, '').trim()
                  const repaired = cleanContent
                    .replace(/,\s*}/g, '}') // 移除对象末尾的逗号
                    .replace(/,\s*\]/g, ']') // 移除数组末尾的逗号
                    .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":') // 确保所有键都有双引号

                  parsedCall = JSON.parse(repaired)
                }

                // 提取函数名和参数
                let functionName, functionArgs

                if (parsedCall.function_call && typeof parsedCall.function_call === 'object') {
                  functionName = parsedCall.function_call.name
                  functionArgs = parsedCall.function_call.arguments
                } else if (parsedCall.name && parsedCall.arguments !== undefined) {
                  functionName = parsedCall.name
                  functionArgs = parsedCall.arguments
                } else if (
                  parsedCall.function &&
                  typeof parsedCall.function === 'object' &&
                  parsedCall.function.name
                ) {
                  functionName = parsedCall.function.name
                  functionArgs = parsedCall.function.arguments
                } else {
                  throw new Error('Unable to recognize function call format from code block')
                }

                // 确保参数是字符串
                if (typeof functionArgs !== 'string') {
                  functionArgs = JSON.stringify(functionArgs)
                }

                // 生成唯一ID
                const id = parsedCall.id || `ollama-tool-${Date.now()}`

                // 发送工具调用
                toolUseDetected = true
                yield {
                  type: 'tool_call_start',
                  tool_call_id: id,
                  tool_call_name: functionName
                }

                yield {
                  type: 'tool_call_chunk',
                  tool_call_id: id,
                  tool_call_arguments_chunk: functionArgs
                }

                yield {
                  type: 'tool_call_end',
                  tool_call_id: id,
                  tool_call_arguments_complete: functionArgs
                }

                stopReason = 'tool_use'
              } catch {
                // 解析失败，将内容作为普通文本输出
                yield {
                  type: 'text',
                  content: '```tool_code\n' + codeContent + '\n```'
                }
              }

              // 重置状态和缓冲区
              codeBlockBuffer = ''
              pendingBuffer = ''
              processedChar = true
            }

            continue
          }
          if (usage) {
            yield createStreamEvent.usage(usage)
          }

          // --- 思考标签处理 ---
          if (thinkState === 'inside') {
            if (pendingBuffer.endsWith(thinkEndMarker)) {
              thinkState = 'none'
              if (thinkBuffer) {
                yield createStreamEvent.reasoning(thinkBuffer)
                thinkBuffer = ''
              }
              pendingBuffer = ''
              processedChar = true
            } else if (thinkEndMarker.startsWith(pendingBuffer)) {
              thinkState = 'end'
              processedChar = true
            } else if (pendingBuffer.length >= thinkEndMarker.length) {
              const charsToYield = pendingBuffer.slice(0, -thinkEndMarker.length + 1)
              if (charsToYield) {
                thinkBuffer += charsToYield
                yield createStreamEvent.reasoning(charsToYield)
              }
              pendingBuffer = pendingBuffer.slice(-thinkEndMarker.length + 1)
              if (thinkEndMarker.startsWith(pendingBuffer)) {
                thinkState = 'end'
              } else {
                thinkBuffer += pendingBuffer
                yield createStreamEvent.reasoning(pendingBuffer)
                pendingBuffer = ''
                thinkState = 'inside'
              }
              processedChar = true
            } else {
              thinkBuffer += char
              yield createStreamEvent.reasoning(char)
              pendingBuffer = ''
              processedChar = true
            }
          } else if (thinkState === 'end') {
            if (pendingBuffer.endsWith(thinkEndMarker)) {
              thinkState = 'none'
              if (thinkBuffer) {
                yield createStreamEvent.reasoning(thinkBuffer)
                thinkBuffer = ''
              }
              pendingBuffer = ''
              processedChar = true
            } else if (!thinkEndMarker.startsWith(pendingBuffer)) {
              const failedTagChars = pendingBuffer
              thinkBuffer += failedTagChars
              yield createStreamEvent.reasoning(failedTagChars)
              pendingBuffer = ''
              thinkState = 'inside'
              processedChar = true
            } else {
              processedChar = true
            }
          }

          // --- 函数调用标签处理 ---
          else if (
            !supportsFunctionCall &&
            tools.length > 0 &&
            (funcState === 'inside' || funcState === 'end')
          ) {
            processedChar = true // 假设已处理，除非下面的逻辑改变状态
            if (funcState === 'inside') {
              if (pendingBuffer.endsWith(funcEndMarker)) {
                funcState = 'none'
                funcCallBuffer += pendingBuffer.slice(0, -funcEndMarker.length)
                pendingBuffer = ''
                toolUseDetected = true

                const parsedCalls = this.parseFunctionCalls(
                  `${funcStartMarker}${funcCallBuffer}${funcEndMarker}`,
                  `non-native-${this.provider.id}`
                )
                for (const parsedCall of parsedCalls) {
                  yield {
                    type: 'tool_call_start',
                    tool_call_id: parsedCall.id,
                    tool_call_name: parsedCall.function.name
                  }
                  yield {
                    type: 'tool_call_chunk',
                    tool_call_id: parsedCall.id,
                    tool_call_arguments_chunk: parsedCall.function.arguments
                  }
                  yield {
                    type: 'tool_call_end',
                    tool_call_id: parsedCall.id,
                    tool_call_arguments_complete: parsedCall.function.arguments
                  }
                }
                funcCallBuffer = ''
              } else if (funcEndMarker.startsWith(pendingBuffer)) {
                funcState = 'end'
              } else if (pendingBuffer.length >= funcEndMarker.length) {
                const charsToAdd = pendingBuffer.slice(0, -funcEndMarker.length + 1)
                funcCallBuffer += charsToAdd
                pendingBuffer = pendingBuffer.slice(-funcEndMarker.length + 1)
                if (funcEndMarker.startsWith(pendingBuffer)) {
                  funcState = 'end'
                } else {
                  funcCallBuffer += pendingBuffer
                  pendingBuffer = ''
                  funcState = 'inside'
                }
              } else {
                funcCallBuffer += char
                pendingBuffer = ''
              }
            } else {
              // funcState === 'end'
              if (pendingBuffer.endsWith(funcEndMarker)) {
                funcState = 'none'
                pendingBuffer = ''
                toolUseDetected = true

                const parsedCalls = this.parseFunctionCalls(
                  `${funcStartMarker}${funcCallBuffer}${funcEndMarker}`,
                  `non-native-${this.provider.id}`
                )
                for (const parsedCall of parsedCalls) {
                  yield {
                    type: 'tool_call_start',
                    tool_call_id: parsedCall.id,
                    tool_call_name: parsedCall.function.name
                  }
                  yield {
                    type: 'tool_call_chunk',
                    tool_call_id: parsedCall.id,
                    tool_call_arguments_chunk: parsedCall.function.arguments
                  }
                  yield {
                    type: 'tool_call_end',
                    tool_call_id: parsedCall.id,
                    tool_call_arguments_complete: parsedCall.function.arguments
                  }
                }
                funcCallBuffer = ''
              } else if (!funcEndMarker.startsWith(pendingBuffer)) {
                funcCallBuffer += pendingBuffer
                pendingBuffer = ''
                funcState = 'inside'
              }
            }
          }

          // --- 处理一般文本/标签检测（当不在任何标签内时）---
          if (!processedChar) {
            let potentialThink = thinkStartMarker.startsWith(pendingBuffer)
            let potentialFunc =
              !supportsFunctionCall && tools.length > 0 && funcStartMarker.startsWith(pendingBuffer)
            const matchedThink = pendingBuffer.endsWith(thinkStartMarker)
            const matchedFunc =
              !supportsFunctionCall && tools.length > 0 && pendingBuffer.endsWith(funcStartMarker)

            // 检查代码块标记
            let codeBlockDetected = false
            for (const marker of codeBlockMarkers) {
              if (pendingBuffer.endsWith(marker)) {
                codeBlockDetected = true
                break
              }
            }

            // --- 首先处理完整匹配 ---
            if (matchedThink) {
              const textBefore = pendingBuffer.slice(0, -thinkStartMarker.length)
              if (textBefore) {
                yield createStreamEvent.text(textBefore)
              }
              thinkState = 'inside'
              funcState = 'none' // 重置其他状态
              pendingBuffer = ''
            } else if (matchedFunc) {
              const textBefore = pendingBuffer.slice(0, -funcStartMarker.length)
              if (textBefore) {
                yield createStreamEvent.text(textBefore)
              }
              funcState = 'inside'
              thinkState = 'none' // 重置其他状态
              pendingBuffer = ''
            } else if (codeBlockDetected) {
              // 找到代码块开始标记，提取前面的文本
              let markerText = ''
              for (const marker of codeBlockMarkers) {
                if (pendingBuffer.endsWith(marker)) {
                  markerText = marker
                  break
                }
              }

              const textBefore = pendingBuffer.slice(0, -markerText.length)
              if (textBefore) {
                yield createStreamEvent.text(textBefore)
              }

              isInCodeBlock = true
              codeBlockBuffer = ''
              pendingBuffer = ''
            }
            // --- 处理部分匹配（继续累积）---
            else if (potentialThink || potentialFunc) {
              // 如果可能匹配任一标签，只保留缓冲区并等待更多字符
              thinkState = potentialThink ? 'start' : 'none'
              funcState = potentialFunc ? 'start' : 'none'
            }
            // --- 处理不匹配/失败 ---
            else if (pendingBuffer.length > 0) {
              // 缓冲区不以'<'开头，或以'<'开头但不再匹配任何标签的开始
              const charToYield = pendingBuffer[0]
              yield createStreamEvent.text(charToYield)
              pendingBuffer = pendingBuffer.slice(1)
              // 使用缩短的缓冲区立即重新评估潜在匹配
              potentialThink =
                pendingBuffer.length > 0 && thinkStartMarker.startsWith(pendingBuffer)
              potentialFunc =
                pendingBuffer.length > 0 &&
                !supportsFunctionCall &&
                tools.length > 0 &&
                funcStartMarker.startsWith(pendingBuffer)
              thinkState = potentialThink ? 'start' : 'none'
              funcState = potentialFunc ? 'start' : 'none'
            }
          }
        } // 字符循环结束
      } // 块循环结束

      // --- 完成处理 ---

      // 输出缓冲区中剩余的文本
      if (pendingBuffer) {
        // 根据最终状态决定如何输出
        if (thinkState === 'inside' || thinkState === 'end') {
          yield { type: 'reasoning', reasoning_content: pendingBuffer }
          thinkBuffer += pendingBuffer
        } else if (funcState === 'inside' || funcState === 'end') {
          // 将剩余内容添加到函数缓冲区 - 稍后处理
          funcCallBuffer += pendingBuffer
        } else {
          yield createStreamEvent.text(pendingBuffer)
        }
        pendingBuffer = ''
      }

      // 处理不完整的非原生函数调用
      if (funcCallBuffer) {
        const potentialContent = `${funcStartMarker}${funcCallBuffer}`
        try {
          const parsedCalls = this.parseFunctionCalls(
            potentialContent,
            `non-native-incomplete-${this.provider.id}`
          )
          if (parsedCalls.length > 0) {
            toolUseDetected = true
            for (const parsedCall of parsedCalls) {
              yield {
                type: 'tool_call_start',
                tool_call_id: parsedCall.id + '-incomplete',
                tool_call_name: parsedCall.function.name
              }
              yield {
                type: 'tool_call_chunk',
                tool_call_id: parsedCall.id + '-incomplete',
                tool_call_arguments_chunk: parsedCall.function.arguments
              }
              yield {
                type: 'tool_call_end',
                tool_call_id: parsedCall.id + '-incomplete',
                tool_call_arguments_complete: parsedCall.function.arguments
              }
            }
          } else {
            // 如果解析失败或没有结果，将缓冲区作为文本输出
            yield createStreamEvent.text(potentialContent)
          }
        } catch (e) {
          console.error('Error parsing incomplete function call buffer:', e)
          yield { type: 'text', content: potentialContent }
        }
        funcCallBuffer = ''
      }

      // 处理不完整的代码块
      if (isInCodeBlock && codeBlockBuffer) {
        yield {
          type: 'text',
          content: '```' + codeBlockBuffer
        }
      }

      // 最终检查和发出原生工具调用
      if (supportsFunctionCall && toolUseDetected) {
        for (const toolId in nativeToolCalls) {
          const tool = nativeToolCalls[toolId]
          if (tool.name && tool.arguments && !tool.completed) {
            try {
              JSON.parse(tool.arguments) // 检查有效性
              yield {
                type: 'tool_call_end',
                tool_call_id: toolId,
                tool_call_arguments_complete: tool.arguments
              }
            } catch (e) {
              console.error(
                `[handleChatCompletion] Tool ${toolId} parameter parsing error: ${tool.arguments}`,
                e
              )
              yield {
                type: 'tool_call_end',
                tool_call_id: toolId,
                tool_call_arguments_complete: tool.arguments
              }
            }
          }
        }
      }

      // 记录状态警告
      if (thinkState !== 'none') console.warn(`Stream ended in thinkState: ${thinkState}`)
      if (funcState !== 'none') console.warn(`Stream ended in funcState: ${funcState}`)

      // 输出使用情况
      if (usage) {
        yield createStreamEvent.usage(usage)
      }

      // 如果检测到工具使用，则覆盖停止原因
      const finalStopReason = toolUseDetected ? 'tool_use' : stopReason
      yield createStreamEvent.stop(finalStopReason)
    } catch (error: unknown) {
      yield createStreamEvent.error(error instanceof Error ? error.message : String(error))
      yield createStreamEvent.stop('error')
    }
  }

  // 用于包装不支持函数调用的提示词
  private prepareFunctionCallPrompt(messages: Message[], mcpTools: MCPToolDefinition[]): Message[] {
    // 创建消息副本
    const result = [...messages]

    const functionCallPrompt = this.getFunctionCallWrapPrompt(mcpTools)
    const userMessageIndex = result.findLastIndex((message) => message.role === 'user')

    if (userMessageIndex !== -1) {
      const userMessage = result[userMessageIndex]
      // 添加提示词到用户消息
      result[userMessageIndex] = {
        ...userMessage,
        content: `${functionCallPrompt}\n\n${userMessage.content || ''}`
      }
    }

    return result
  }

  // 解析函数调用标签
  protected parseFunctionCalls(
    response: string,
    fallbackIdPrefix: string = 'ollama-tool'
  ): Array<{ id: string; type: string; function: { name: string; arguments: string } }> {
    try {
      // 使用非贪婪模式匹配function_call标签对
      const functionCallMatches = response.match(/<function_call>([\s\S]*?)<\/function_call>/gs)
      if (!functionCallMatches) {
        return []
      }

      const toolCalls = functionCallMatches
        .map((match, index) => {
          const content = match.replace(/<\/?function_call>/g, '').trim()
          try {
            // 尝试解析JSON
            let parsedCall
            try {
              parsedCall = JSON.parse(content)
            } catch {
              // 尝试修复格式问题
              const repaired = content
                .replace(/,\s*}/g, '}') // 移除对象末尾的逗号
                .replace(/,\s*\]/g, ']') // 移除数组末尾的逗号
                .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":') // 确保所有键都有双引号

              parsedCall = JSON.parse(repaired)
            }

            // 提取函数名和参数
            let functionName, functionArgs

            if (parsedCall.function_call && typeof parsedCall.function_call === 'object') {
              functionName = parsedCall.function_call.name
              functionArgs = parsedCall.function_call.arguments
            } else if (parsedCall.name && parsedCall.arguments !== undefined) {
              functionName = parsedCall.name
              functionArgs = parsedCall.arguments
            } else if (
              parsedCall.function &&
              typeof parsedCall.function === 'object' &&
              parsedCall.function.name
            ) {
              functionName = parsedCall.function.name
              functionArgs = parsedCall.function.arguments
            } else {
              return null
            }

            // 确保参数是字符串
            if (typeof functionArgs !== 'string') {
              functionArgs = JSON.stringify(functionArgs)
            }

            // 生成唯一ID
            const id = parsedCall.id || `${fallbackIdPrefix}-${index}-${Date.now()}`

            return {
              id: String(id),
              type: 'function',
              function: {
                name: String(functionName),
                arguments: functionArgs
              }
            }
          } catch {
            return null
          }
        })
        .filter((call) => call !== null) as Array<{
        id: string
        type: string
        function: { name: string; arguments: string }
      }>

      return toolCalls
    } catch {
      return []
    }
  }

  public onProxyResolved(): void {
    console.log('ollama onProxyResolved')
  }

  async getEmbeddings(modelId: string, texts: string[]): Promise<number[][]> {
    // Ollama embedding API: 只支持单条文本
    const results: number[][] = []
    for (const text of texts) {
      const resp = await this.ollama.embeddings({
        model: modelId,
        prompt: text
      })
      if (resp && Array.isArray(resp.embedding)) {
        results.push(resp.embedding)
      } else {
        results.push([])
      }
    }
    return results
  }

  async getDimensions(modelId: string): Promise<LLM_EMBEDDING_ATTRS> {
    const res = await this.getEmbeddings(modelId, [EMBEDDING_TEST_KEY])
    return {
      dimensions: res[0].length,
      normalized: isNormalized(res[0])
    }
  }
}
