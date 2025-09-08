import { presenter } from '@/presenter'
import {
  Content,
  FunctionCallingConfigMode,
  GenerateContentParameters,
  GenerateContentResponseUsageMetadata,
  GenerationConfig,
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  Modality,
  Part,
  SafetySetting
} from '@google/genai'
import { ModelType } from '@shared/model'
import {
  ChatMessage,
  IConfigPresenter,
  LLM_PROVIDER,
  LLMCoreStreamEvent,
  LLMResponse,
  MCPToolDefinition,
  MODEL_META,
  ModelConfig
} from '@shared/presenter'
import { createStreamEvent } from '@shared/types/core/llm-events'
import { BaseLLMProvider, SUMMARY_TITLES_PROMPT } from '../baseProvider'
import { eventBus, SendTarget } from '@/eventbus'
import { CONFIG_EVENTS } from '@/events'

// Mapping from simple keys to API HarmCategory constants
const keyToHarmCategoryMap: Record<string, HarmCategory> = {
  harassment: HarmCategory.HARM_CATEGORY_HARASSMENT,
  hateSpeech: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  sexuallyExplicit: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  dangerousContent: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT
}

// Value mapping from config storage to API HarmBlockThreshold constants
// Assuming config stores 'BLOCK_NONE', 'BLOCK_LOW_AND_ABOVE', etc. directly
const valueToHarmBlockThresholdMap: Record<string, HarmBlockThreshold> = {
  BLOCK_NONE: HarmBlockThreshold.BLOCK_NONE,
  BLOCK_LOW_AND_ABOVE: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
  BLOCK_MEDIUM_AND_ABOVE: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  BLOCK_ONLY_HIGH: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  HARM_BLOCK_THRESHOLD_UNSPECIFIED: HarmBlockThreshold.HARM_BLOCK_THRESHOLD_UNSPECIFIED
}
const safetySettingKeys = Object.keys(keyToHarmCategoryMap)

export class GeminiProvider extends BaseLLMProvider {
  private genAI: GoogleGenAI

  // Define static model configuration
  private static readonly GEMINI_MODELS: MODEL_META[] = [
    {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      group: 'default',
      providerId: 'gemini',
      isCustom: false,
      contextLength: 1048576,
      maxTokens: 65535,
      vision: true,
      functionCall: true,
      reasoning: true
    },
    {
      id: 'models/gemini-2.5-flash-lite-preview-06-17',
      name: 'Gemini 2.5 Flash-Lite Preview',
      group: 'default',
      providerId: 'gemini',
      isCustom: false,
      contextLength: 1048576,
      maxTokens: 65535,
      vision: true,
      functionCall: true,
      reasoning: true
    },
    {
      id: 'models/gemini-2.5-flash-lite',
      name: 'Gemini 2.5 Flash-Lite',
      group: 'default',
      providerId: 'gemini',
      isCustom: false,
      contextLength: 1048576,
      maxTokens: 65535,
      vision: true,
      functionCall: true,
      reasoning: true
    },
    {
      id: 'models/gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      group: 'default',
      providerId: 'gemini',
      isCustom: false,
      contextLength: 1048576,
      maxTokens: 65535,
      vision: true,
      functionCall: true,
      reasoning: true
    },
    {
      id: 'models/gemini-2.0-flash-preview-image-generation',
      name: 'Gemini 2.0 Flash Preview Image Generation',
      group: 'default',
      providerId: 'gemini',
      isCustom: false,
      contextLength: 32000,
      maxTokens: 8192,
      vision: true,
      functionCall: false,
      reasoning: false,
      type: ModelType.ImageGeneration
    },
    {
      id: 'models/gemini-2.0-flash-lite',
      name: 'Gemini 2.0 Flash Lite',
      group: 'default',
      providerId: 'gemini',
      isCustom: false,
      contextLength: 1048576,
      maxTokens: 8191,
      vision: true,
      functionCall: true,
      reasoning: false
    },
    {
      id: 'models/gemini-2.0-flash',
      name: 'Gemini 2.0 Flash',
      group: 'default',
      providerId: 'gemini',
      isCustom: false,
      contextLength: 1048576,
      maxTokens: 8191,
      vision: true,
      functionCall: true,
      reasoning: true
    },
    {
      id: 'models/gemini-1.5-flash',
      name: 'Gemini 1.5 Flash',
      group: 'default',
      providerId: 'gemini',
      isCustom: false,
      contextLength: 1048576,
      maxTokens: 8191,
      vision: true,
      functionCall: true,
      reasoning: false
    }
  ]

  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
    this.genAI = new GoogleGenAI({
      apiKey: this.provider.apiKey,
      httpOptions: { baseUrl: this.provider.baseUrl }
    })
    this.init()
  }

  public onProxyResolved(): void {
    this.init()
  }

  // Implement abstract method fetchProviderModels from BaseLLMProvider
  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    try {
      const modelsResponse = await this.genAI.models.list()
      // console.log('gemini models response:', modelsResponse)

      // 将 pager 转换为数组
      const models: any[] = []
      for await (const model of modelsResponse) {
        models.push(model)
      }

      if (models.length === 0) {
        console.warn('No models found in Gemini API response, using static models')
        return GeminiProvider.GEMINI_MODELS.map((model) => ({
          ...model,
          providerId: this.provider.id
        }))
      }

      // 映射 API 返回的模型数据
      const apiModels: MODEL_META[] = models
        .filter((model: any) => {
          // Filter out embedding models and other non-chat models
          const name = model.name.toLowerCase()
          return (
            !name.includes('embedding') &&
            !name.includes('aqa') &&
            !name.includes('text-embedding') &&
            !name.includes('gemma-3n-e4b-it')
          ) // Filter out specific small models
        })
        .map((model: any) => {
          const modelName = model.name
          const displayName = model.displayName

          // Determine model functionality support
          const isVisionModel =
            displayName.toLowerCase().includes('vision') || modelName.includes('gemini-') // Gemini series generally support vision

          const isFunctionCallSupported =
            !modelName.includes('gemma-3') && !modelName.includes('flash-image-preview') // Gemma models and flash-image-preview do not support function calls

          // Determine if reasoning (thinking) is supported
          const isReasoningSupported =
            modelName.includes('thinking') ||
            (modelName.includes('2.5') && !modelName.includes('flash-image-preview')) ||
            modelName.includes('2.0-flash') ||
            modelName.includes('exp-1206')

          // Determine model type
          let modelType = ModelType.Chat
          if (modelName.includes('image-generation')) {
            modelType = ModelType.ImageGeneration
          }

          // Determine model group
          let group = 'default'
          if (modelName.includes('exp') || modelName.includes('preview')) {
            group = 'experimental'
          } else if (modelName.includes('gemma')) {
            group = 'gemma'
          }

          return {
            id: modelName,
            name: displayName,
            group,
            providerId: this.provider.id,
            isCustom: false,
            contextLength: model.inputTokenLimit,
            maxTokens: model.outputTokenLimit,
            vision: isVisionModel,
            functionCall: isFunctionCallSupported,
            reasoning: isReasoningSupported,
            ...(modelType !== ModelType.Chat && { type: modelType })
          } as MODEL_META
        })

      // console.log('Mapped Gemini models:', apiModels)
      return apiModels
    } catch (error) {
      console.warn('Failed to fetch models from Gemini API:', error)
      // If API call fails, fallback to static model list
      return GeminiProvider.GEMINI_MODELS.map((model) => ({
        ...model,
        providerId: this.provider.id
      }))
    }
  }

  // Implement summaryTitles abstract method from BaseLLMProvider
  public async summaryTitles(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string
  ): Promise<string> {
    console.log('gemini ignore modelId', modelId)
    // Use Gemini API to generate conversation titles
    try {
      const conversationText = messages.map((m) => `${m.role}: ${m.content}`).join('\n')
      const prompt = `${SUMMARY_TITLES_PROMPT}\n\n${conversationText}`

      const result = await this.genAI.models.generateContent({
        model: modelId,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: this.getGenerationConfig(0.4, undefined, modelId, false)
      })

      return result.text?.trim() || 'New Conversation'
    } catch (error) {
      console.error('Failed to generate conversation title:', error)
      return 'New Conversation'
    }
  }

  // Override fetchModels method since Gemini doesn't have a model fetching API
  async fetchModels(): Promise<MODEL_META[]> {
    // Gemini没有获取模型的API，直接使用init方法中的硬编码模型列表
    return this.models
  }

  // Override check method to use the first default model for testing
  async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      if (!this.provider.apiKey) {
        return { isOk: false, errorMsg: 'Missing API key' }
      }

      // Use the first model for simple testing
      const result = await this.genAI.models.generateContent({
        model: 'models/gemini-1.5-flash-8b',
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }]
      })
      return { isOk: result && result.text ? true : false, errorMsg: null }
    } catch (error) {
      console.error('Provider check failed:', this.provider.name, error)
      return { isOk: false, errorMsg: error instanceof Error ? error.message : String(error) }
    }
  }

  protected async init() {
    if (this.provider.enable) {
      try {
        this.isInitialized = true
        // Use API to get model list, fallback to static list if failed
        this.models = await this.fetchProviderModels()
        await this.autoEnableModelsIfNeeded()
        // Gemini is relatively slow, special compensation
        eventBus.sendToRenderer(
          CONFIG_EVENTS.MODEL_LIST_CHANGED,
          SendTarget.ALL_WINDOWS,
          this.provider.id
        )
        console.info('Provider initialized successfully:', this.provider.name)
      } catch (error) {
        console.warn('Provider initialization failed:', this.provider.name, error)
      }
    }
  }

  /**
   * 重写 autoEnableModelsIfNeeded 方法
   * 只自动启用与 GEMINI_MODELS 中定义的推荐模型相匹配的模型
   */
  protected async autoEnableModelsIfNeeded() {
    if (!this.models || this.models.length === 0) return
    const providerId = this.provider.id

    // 检查是否有自定义模型
    const customModels = this.configPresenter.getCustomModels(providerId)
    if (customModels && customModels.length > 0) return

    // 检查是否有任何模型的状态被手动修改过
    const hasManuallyModifiedModels = this.models.some((model) =>
      this.configPresenter.getModelStatus(providerId, model.id)
    )
    if (hasManuallyModifiedModels) return

    // 检查是否有任何已启用的模型
    const hasEnabledModels = this.models.some((model) =>
      this.configPresenter.getModelStatus(providerId, model.id)
    )

    // 不再自动启用模型，让用户手动选择启用需要的模型
    if (!hasEnabledModels) {
      console.info(
        `Provider ${this.provider.name} models loaded, please manually enable the models you need`
      )
    }
  }

  // Helper function to get and format safety settings
  private async getFormattedSafetySettings(): Promise<SafetySetting[] | undefined> {
    const safetySettings: SafetySetting[] = []

    for (const key of safetySettingKeys) {
      try {
        // Use configPresenter to get the setting value for the 'gemini' provider
        // Assuming getSetting returns the string value like 'BLOCK_MEDIUM_AND_ABOVE'
        const settingValue =
          (await this.configPresenter.getSetting<string>(
            `geminiSafety_${key}` // Match the key used in settings store
          )) || 'HARM_BLOCK_THRESHOLD_UNSPECIFIED' // Default if not set

        const threshold = valueToHarmBlockThresholdMap[settingValue]
        const category = keyToHarmCategoryMap[key]

        // Only add if threshold is defined, category is defined, and threshold is not BLOCK_NONE
        if (
          threshold &&
          category &&
          threshold !== 'BLOCK_NONE' &&
          threshold !== 'HARM_BLOCK_THRESHOLD_UNSPECIFIED'
        ) {
          safetySettings.push({ category, threshold })
        }
      } catch (error) {
        console.warn(`Failed to retrieve or map safety setting for ${key}:`, error)
      }
    }

    return safetySettings.length > 0 ? safetySettings : undefined
  }

  // 判断模型是否支持 thinkingBudget
  private supportsThinkingBudget(modelId: string): boolean {
    return (
      modelId.includes('gemini-2.5-pro') ||
      modelId.includes('gemini-2.5-flash') ||
      modelId.includes('gemini-2.5-flash-lite')
    )
  }

  // 获取生成配置，不再创建模型实例
  private getGenerationConfig(
    temperature?: number,
    maxTokens?: number,
    modelId?: string,
    reasoning?: boolean,
    thinkingBudget?: number
  ): GenerationConfig {
    const generationConfig: GenerationConfig = {
      temperature,
      maxOutputTokens: maxTokens
    }

    // 从当前模型列表中查找指定的模型
    if (modelId && this.models) {
      const model = this.models.find((m) => m.id === modelId)
      if (model && model.type === ModelType.ImageGeneration) {
        generationConfig.responseModalities = [Modality.TEXT, Modality.IMAGE]
      }
    }

    // 正确配置思考功能
    if (reasoning) {
      generationConfig.thinkingConfig = {
        includeThoughts: true
      }

      // 仅对支持 thinkingBudget 的 Gemini 2.5 系列模型添加 thinkingBudget 参数
      if (modelId && this.supportsThinkingBudget(modelId) && thinkingBudget !== undefined) {
        generationConfig.thinkingConfig.thinkingBudget = thinkingBudget
      }
    }

    return generationConfig
  }

  // 将 ChatMessage 转换为 Gemini 格式的消息
  private formatGeminiMessages(messages: ChatMessage[]): {
    systemInstruction: string
    contents: Content[]
  } {
    // 提取系统消息
    const systemMessages = messages.filter((msg) => msg.role === 'system')
    let systemContent = ''
    if (systemMessages.length > 0) {
      systemContent = systemMessages.map((msg) => msg.content).join('\n')
    }

    // 创建Gemini内容数组
    const formattedContents: Content[] = []

    // 处理非系统消息
    const nonSystemMessages = messages.filter((msg) => msg.role !== 'system')
    for (let i = 0; i < nonSystemMessages.length; i++) {
      const message = nonSystemMessages[i]

      // 检查是否是带有tool_calls的assistant消息
      if (message.role === 'assistant' && 'tool_calls' in message) {
        // 处理tool_calls消息
        for (const toolCall of message.tool_calls || []) {
          // 添加模型发出的函数调用
          formattedContents.push({
            role: 'model',
            parts: [
              {
                functionCall: {
                  name: toolCall.function.name,
                  args: JSON.parse(toolCall.function.arguments || '{}')
                }
              }
            ]
          })

          // 查找对应的工具响应消息
          const nextMessage = i + 1 < nonSystemMessages.length ? nonSystemMessages[i + 1] : null
          if (
            nextMessage &&
            nextMessage.role === 'tool' &&
            'tool_call_id' in nextMessage &&
            nextMessage.tool_call_id === toolCall.id
          ) {
            // 添加用户角色的函数响应
            formattedContents.push({
              role: 'user',
              parts: [
                {
                  functionResponse: {
                    name: toolCall.function.name,
                    response: {
                      result:
                        typeof nextMessage.content === 'string'
                          ? nextMessage.content
                          : JSON.stringify(nextMessage.content)
                    }
                  }
                }
              ]
            })

            // 跳过下一条消息，因为已经处理过了
            i++
          }
        }
        continue
      }

      // 为每条消息创建parts数组
      const parts: Part[] = []

      // 检查消息是否包含工具调用或工具响应
      if (message.role === 'tool' && Array.isArray(message.content)) {
        // 处理工具消息
        for (const part of message.content) {
          // @ts-ignore - 处理类型兼容性
          if (part.type === 'function_call' && part.function_call) {
            // 处理函数调用
            parts.push({
              // @ts-ignore - 处理类型兼容性
              functionCall: {
                // @ts-ignore - 处理类型兼容性
                name: part.function_call.name || '',
                // @ts-ignore - 处理类型兼容性
                args: part.function_call.arguments ? JSON.parse(part.function_call.arguments) : {}
              }
            })
            // @ts-ignore - 处理类型兼容性
          } else if (part.type === 'function_response') {
            // 处理函数响应
            // @ts-ignore - 处理类型兼容性
            parts.push({ text: part.function_response || '' })
          }
        }
      } else if (typeof message.content === 'string') {
        // 处理消息内容 - 可能是字符串或包含图片的数组
        // 处理纯文本消息
        // 只添加非空文本
        if (message.content.trim() !== '') {
          parts.push({ text: message.content })
        }
      } else if (Array.isArray(message.content)) {
        // 处理多模态消息（带图片等）
        for (const part of message.content) {
          if (part.type === 'text') {
            // 只添加非空文本
            if (part.text && part.text.trim() !== '') {
              parts.push({ text: part.text })
            }
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
        } else if (message.role === 'tool') {
          // 工具消息作为用户消息处理
          role = 'user'
        }

        formattedContents.push({
          role: role,
          parts: parts
        })
      }
    }

    return { systemInstruction: systemContent, contents: formattedContents }
  }

  // 处理 Gemini API 响应，支持新旧格式的思考内容
  private processGeminiResponse(result: any): LLMResponse {
    const resultResp: LLMResponse = {
      content: ''
    }

    let textContent = ''
    let thoughtContent = ''

    // 检查是否有候选响应和 parts
    if (result.candidates && result.candidates[0]?.content?.parts) {
      for (const part of result.candidates[0].content.parts) {
        // 检查是否是思考内容 (新格式)
        if ((part as any).thought === true && part.text) {
          thoughtContent += part.text
        } else if (part.text) {
          textContent += part.text
        }
      }
    } else {
      // 回退到使用 result.text
      textContent = result.text || ''
    }

    // 如果没有检测到新格式的思考内容，检查旧格式的 <think> 标签
    if (!thoughtContent && textContent.includes('<think>')) {
      const thinkStart = textContent.indexOf('<think>')
      const thinkEnd = textContent.indexOf('</think>')

      if (thinkEnd > thinkStart) {
        // 提取reasoning_content
        thoughtContent = textContent.substring(thinkStart + 7, thinkEnd).trim()

        // 合并<think>前后的普通内容
        const beforeThink = textContent.substring(0, thinkStart).trim()
        const afterThink = textContent.substring(thinkEnd + 8).trim()
        textContent = [beforeThink, afterThink].filter(Boolean).join('\n')
      }
    }

    resultResp.content = textContent
    if (thoughtContent) {
      resultResp.reasoning_content = thoughtContent
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
    try {
      if (!this.genAI) {
        throw new Error('Google Generative AI client is not initialized')
      }

      const { systemInstruction, contents } = this.formatGeminiMessages(messages)

      // 创建基本请求参数
      const generationConfig: GenerationConfig = {
        temperature: temperature || 0.7,
        maxOutputTokens: maxTokens
      }

      // 执行请求
      const requestParams: GenerateContentParameters = {
        model: modelId,
        contents,
        config: generationConfig
      }

      if (systemInstruction) {
        requestParams.config = {
          ...generationConfig,
          systemInstruction
        }
      }

      const result = await this.genAI.models.generateContent(requestParams)

      const resultResp: LLMResponse = {
        content: ''
      }

      // 尝试获取tokens信息 - 使用新SDK的usageMetadata结构
      try {
        if (result.usageMetadata) {
          const usage = result.usageMetadata
          resultResp.totalUsage = {
            prompt_tokens: usage.promptTokenCount || 0,
            completion_tokens: usage.candidatesTokenCount || 0,
            total_tokens: usage.totalTokenCount || 0
          }
        } else {
          // 估算token数量 - 简单方法，可以根据实际需要调整
          const promptText = messages.map((m) => m.content).join(' ')
          const responseText = result.text || ''

          // 简单估算: 英文约1个token/4个字符，中文约1个token/1.5个字符
          const estimateTokens = (text: string): number => {
            const chineseCharCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length
            const otherCharCount = text.length - chineseCharCount
            return Math.ceil(chineseCharCount / 1.5 + otherCharCount / 4)
          }

          const promptTokens = estimateTokens(promptText)
          const completionTokens = estimateTokens(responseText)

          resultResp.totalUsage = {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens
          }
        }
      } catch (e) {
        console.warn('Failed to estimate token count for Gemini response', e)
      }

      // 处理响应内容，支持新格式的思考内容
      let textContent = ''
      let thoughtContent = ''

      // 检查是否有候选响应和 parts
      if (result.candidates && result.candidates[0]?.content?.parts) {
        for (const part of result.candidates[0].content.parts) {
          // 检查是否是思考内容 (新格式)
          if ((part as any).thought === true && part.text) {
            thoughtContent += part.text
          } else if (part.text) {
            textContent += part.text
          }
        }
      } else {
        // 回退到使用 result.text
        textContent = result.text || ''
      }

      // 如果没有检测到新格式的思考内容，检查旧格式的 <think> 标签
      if (!thoughtContent && textContent.includes('<think>')) {
        const thinkStart = textContent.indexOf('<think>')
        const thinkEnd = textContent.indexOf('</think>')

        if (thinkEnd > thinkStart) {
          // 提取reasoning_content
          thoughtContent = textContent.substring(thinkStart + 7, thinkEnd).trim()

          // 合并<think>前后的普通内容
          const beforeThink = textContent.substring(0, thinkStart).trim()
          const afterThink = textContent.substring(thinkEnd + 8).trim()
          textContent = [beforeThink, afterThink].filter(Boolean).join('\n')
        }
      }

      resultResp.content = textContent
      if (thoughtContent) {
        resultResp.reasoning_content = thoughtContent
      }

      return resultResp
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
      const prompt = `Please generate a concise summary for the following content:\n\n${text}`

      const result = await this.genAI.models.generateContent({
        model: modelId,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: this.getGenerationConfig(temperature, maxTokens, modelId, false)
      })

      return this.processGeminiResponse(result)
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
      const result = await this.genAI.models.generateContent({
        model: modelId,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: this.getGenerationConfig(temperature, maxTokens, modelId, false)
      })

      return this.processGeminiResponse(result)
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
      const prompt = `Based on the following context, please provide up to 5 reasonable suggestion options, each not exceeding 100 characters. Please return in JSON array format without other explanations:\n\n${context}`

      const result = await this.genAI.models.generateContent({
        model: modelId,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: this.getGenerationConfig(temperature, maxTokens, modelId, false)
      })

      const responseText = result.text || ''

      // 尝试从响应中解析出JSON数组
      try {
        const cleanedText = responseText.replace(/```json|```/g, '').trim()
        const suggestions = JSON.parse(cleanedText)
        if (Array.isArray(suggestions)) {
          return suggestions.map((item) => item.toString())
        }
      } catch (parseError) {
        console.error('Gemini suggestions parseError:', parseError)
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

      // If all fail, return a default prompt
      return ['Unable to generate suggestions']
    } catch (error) {
      console.error('Gemini suggestions error:', error)
      return ['Error occurred, unable to get suggestions']
    }
  }
  /**
   * 核心流式处理方法
   * 实现BaseLLMProvider中的抽象方法
   */
  async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    mcpTools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    if (!this.isInitialized) throw new Error('Provider not initialized')
    if (!modelId) throw new Error('Model ID is required')
    console.log('modelConfig', modelConfig, modelId)

    // 检查是否是图片生成模型
    const isImageGenerationModel = modelConfig?.type === ModelType.ImageGeneration

    // 如果是图片生成模型，使用特殊处理
    if (isImageGenerationModel) {
      yield* this.handleImageGenerationStream(messages, modelId, temperature, maxTokens)
      return
    }

    const safetySettings = await this.getFormattedSafetySettings()
    console.log('safetySettings', safetySettings)

    // 将MCP工具转换为Gemini格式的工具（所有Gemini模型都支持原生工具调用）
    const geminiTools =
      mcpTools.length > 0
        ? await presenter.mcpPresenter.mcpToolsToGeminiTools(mcpTools, this.provider.id)
        : undefined

    // 格式化消息为Gemini格式
    const formattedParts = this.formatGeminiMessages(messages)

    // 创建请求参数
    const requestParams: GenerateContentParameters = {
      model: modelId,
      contents: formattedParts.contents,
      config: this.getGenerationConfig(
        temperature,
        maxTokens,
        modelId,
        modelConfig.reasoning,
        modelConfig.thinkingBudget
      )
    }
    console.log('requestParams', requestParams)
    if (formattedParts.systemInstruction) {
      requestParams.config = {
        ...requestParams.config,
        systemInstruction: formattedParts.systemInstruction
      }
    }

    // 添加工具配置
    if (geminiTools && geminiTools.length > 0) {
      requestParams.config = {
        ...requestParams.config,
        tools: geminiTools,
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.AUTO // 允许模型自动决定是否调用工具
          }
        }
      }
    }

    // 添加安全设置
    if (safetySettings) {
      requestParams.config = {
        ...requestParams.config,
        safetySettings
      }
    }

    // 发送流式请求
    const result = await this.genAI.models.generateContentStream(requestParams)

    // 状态变量
    let buffer = ''
    let isInThinkTag = false
    let toolUseDetected = false
    let usageMetadata: GenerateContentResponseUsageMetadata | undefined
    let isNewThoughtFormatDetected = modelConfig.reasoning === true

    // 流处理循环
    for await (const chunk of result) {
      // 处理用量统计
      if (chunk.usageMetadata) {
        usageMetadata = chunk.usageMetadata
      }

      console.log('chunk.candidates', JSON.stringify(chunk.candidates, null, 2))
      // 检查是否包含函数调用
      if (chunk.candidates && chunk.candidates[0]?.content?.parts?.[0]?.functionCall) {
        const functionCall = chunk.candidates[0].content.parts[0].functionCall
        const functionName = functionCall.name
        const functionArgs = functionCall.args || {}
        const toolCallId = `gemini-tool-${Date.now()}`

        toolUseDetected = true

        // 发送工具调用开始事件
        yield createStreamEvent.toolCallStart(toolCallId, functionName || '')

        // 发送工具调用参数
        const argsString = JSON.stringify(functionArgs)
        yield createStreamEvent.toolCallChunk(toolCallId, argsString)

        // 发送工具调用结束事件
        yield createStreamEvent.toolCallEnd(toolCallId, argsString)

        // 设置停止原因为工具使用
        break
      }

      // 处理内容块
      let content = ''
      let thoughtContent = ''

      // 处理文本和图像内容
      if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
        for (const part of chunk.candidates[0].content.parts) {
          // 检查是否是思考内容 (新格式)
          if ((part as any).thought === true && part.text) {
            isNewThoughtFormatDetected = true
            thoughtContent += part.text
          } else if (part.text) {
            content += part.text
          } else if (part.inlineData && part.inlineData.data && part.inlineData.mimeType) {
            // 处理图像数据
            yield createStreamEvent.imageData({
              data: part.inlineData.data,
              mimeType: part.inlineData.mimeType
            })
          }
        }
      } else {
        // 兼容处理
        content = chunk.text || ''
      }

      // 如果检测到思考内容，直接发送
      if (thoughtContent) {
        yield createStreamEvent.reasoning(thoughtContent)
      }

      if (!content) continue

      if (isNewThoughtFormatDetected) {
        yield createStreamEvent.text(content)
      } else {
        buffer += content

        if (buffer.includes('<think>') && !isInThinkTag) {
          const thinkStart = buffer.indexOf('<think>')
          if (thinkStart > 0) {
            yield createStreamEvent.text(buffer.substring(0, thinkStart))
          }
          buffer = buffer.substring(thinkStart + 7)
          isInThinkTag = true
        }

        if (isInThinkTag && buffer.includes('</think>')) {
          const thinkEnd = buffer.indexOf('</think>')
          const reasoningContent = buffer.substring(0, thinkEnd)
          if (reasoningContent) {
            yield createStreamEvent.reasoning(reasoningContent)
          }
          buffer = buffer.substring(thinkEnd + 8)
          isInThinkTag = false
        }

        if (!isInThinkTag && buffer) {
          yield createStreamEvent.text(buffer)
          buffer = ''
        }
      }
    }

    if (usageMetadata) {
      yield createStreamEvent.usage({
        prompt_tokens: usageMetadata.promptTokenCount || 0,
        completion_tokens: usageMetadata.candidatesTokenCount || 0,
        total_tokens: usageMetadata.totalTokenCount || 0
      })
    }

    // 处理剩余缓冲区内容
    if (!isNewThoughtFormatDetected && buffer) {
      if (isInThinkTag) {
        yield createStreamEvent.reasoning(buffer)
      } else {
        yield createStreamEvent.text(buffer)
      }
    }

    // 发送停止事件
    yield createStreamEvent.stop(toolUseDetected ? 'tool_use' : 'complete')
  }

  /**
   * 处理图片生成模型的流式输出
   */
  private async *handleImageGenerationStream(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMCoreStreamEvent> {
    try {
      // 提取用户消息并构建parts数组
      const userMessage = messages.findLast((msg) => msg.role === 'user')
      if (!userMessage) {
        throw new Error('No user message found for image generation')
      }

      // 构建包含文本和图片的parts数组，参考formatGeminiMessages的逻辑
      const parts: Part[] = []

      if (typeof userMessage.content === 'string') {
        // 处理纯文本消息
        if (userMessage.content.trim() !== '') {
          parts.push({ text: userMessage.content })
        }
      } else if (Array.isArray(userMessage.content)) {
        // 处理多模态消息（带图片等）
        for (const part of userMessage.content) {
          if (part.type === 'text') {
            // 只添加非空文本
            if (part.text && part.text.trim() !== '') {
              parts.push({ text: part.text })
            }
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

      // 如果没有有效的parts，抛出错误
      if (parts.length === 0) {
        throw new Error('No valid content found for image generation')
      }

      // 发送生成请求
      const result = await this.genAI.models.generateContentStream({
        model: modelId,
        contents: [{ role: 'user', parts }],
        config: this.getGenerationConfig(temperature, maxTokens, modelId, false) // 图像生成不需要reasoning
      })

      // 处理流式响应
      for await (const chunk of result) {
        if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
          for (const part of chunk.candidates[0].content.parts) {
            if (part.text) {
              // 输出文本内容
              yield createStreamEvent.text(part.text)
            } else if (part.inlineData) {
              // 输出图像数据
              yield createStreamEvent.imageData({
                data: part.inlineData.data || '',
                mimeType: part.inlineData.mimeType || ''
              })
            }
          }
        }
      }

      // 发送停止事件
      yield createStreamEvent.stop('complete')
    } catch (error) {
      console.error('Image generation stream error:', error)
      yield createStreamEvent.error(
        error instanceof Error ? error.message : 'Image generation failed'
      )
      yield createStreamEvent.stop('error')
    }
  }

  async getEmbeddings(modelId: string, texts: string[]): Promise<number[][]> {
    if (!this.genAI) throw new Error('Google Generative AI client is not initialized')
    // Gemini embedContent 支持批量输入
    const resp = await this.genAI.models.embedContent({
      model: modelId,
      contents: texts.map((text) => ({
        parts: [{ text }]
      }))
    })
    // resp.embeddings?: ContentEmbedding[]
    if (resp && Array.isArray(resp.embeddings)) {
      return resp.embeddings.map((e) => (Array.isArray(e.values) ? e.values : []))
    }
    // 若无返回，抛出异常
    throw new Error('Gemini embedding API did not return embeddings')
  }
}
