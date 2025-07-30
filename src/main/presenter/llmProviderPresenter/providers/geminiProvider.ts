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
  LLM_PROVIDER,
  LLMCoreStreamEvent,
  LLMResponse,
  MCPToolDefinition,
  MODEL_META,
  ModelConfig
} from '@shared/presenter'
import { ConfigPresenter } from '../../configPresenter'
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

  // 定义静态的模型配置
  private static readonly GEMINI_MODELS: MODEL_META[] = [
    {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      group: 'default',
      providerId: 'gemini',
      isCustom: false,
      contextLength: 1048576,
      maxTokens: 65536,
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
      maxTokens: 65536,
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
      contextLength: 1_000_000,
      maxTokens: 64_000,
      vision: true,
      functionCall: true,
      reasoning: true
    },
    {
      id: 'models/gemini-2.0-flash',
      name: 'Gemini 2.0 Flash',
      group: 'default',
      providerId: 'gemini',
      isCustom: false,
      contextLength: 1_048_576,
      maxTokens: 8192,
      vision: true,
      functionCall: true,
      reasoning: true
    },
    {
      id: 'models/gemini-2.0-flash-lite',
      name: 'Gemini 2.0 Flash Lite',
      group: 'default',
      providerId: 'gemini',
      isCustom: false,
      contextLength: 1_048_576,
      maxTokens: 8192,
      vision: true,
      functionCall: true,
      reasoning: false
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
      functionCall: true,
      reasoning: false,
      type: ModelType.ImageGeneration
    },
    {
      id: 'models/gemini-1.5-flash',
      name: 'Gemini 1.5 Flash',
      group: 'default',
      providerId: 'gemini',
      isCustom: false,
      contextLength: 1_048_576,
      maxTokens: 8192,
      vision: true,
      functionCall: true,
      reasoning: false
    }
  ]

  constructor(provider: LLM_PROVIDER, configPresenter: ConfigPresenter) {
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

  // 实现BaseLLMProvider中的抽象方法fetchProviderModels
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
          // 过滤掉嵌入模型和其他非聊天模型
          const name = model.name.toLowerCase()
          return (
            !name.includes('embedding') &&
            !name.includes('aqa') &&
            !name.includes('text-embedding') &&
            !name.includes('gemma-3n-e4b-it')
          ) // 过滤掉特定的小模型
        })
        .map((model: any) => {
          const modelName = model.name
          const displayName = model.displayName

          // 判断模型功能支持
          const isVisionModel =
            displayName.toLowerCase().includes('vision') || modelName.includes('gemini-') // Gemini 系列一般都支持视觉

          const isFunctionCallSupported = !modelName.includes('gemma-3') // Gemma 模型不支持函数调用

          // 判断是否支持推理（thinking）
          const isReasoningSupported =
            modelName.includes('thinking') ||
            modelName.includes('2.5') ||
            modelName.includes('2.0-flash') ||
            modelName.includes('exp-1206')

          // 判断模型类型
          let modelType = ModelType.Chat
          if (modelName.includes('image-generation')) {
            modelType = ModelType.ImageGeneration
          }

          // 确定模型分组
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
      // 如果 API 调用失败，回退到静态模型列表
      return GeminiProvider.GEMINI_MODELS.map((model) => ({
        ...model,
        providerId: this.provider.id
      }))
    }
  }

  // 实现BaseLLMProvider中的summaryTitles抽象方法
  public async summaryTitles(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string
  ): Promise<string> {
    console.log('gemini ignore modelId', modelId)
    // 使用Gemini API生成对话标题
    try {
      const conversationText = messages.map((m) => `${m.role}: ${m.content}`).join('\n')
      const prompt = `${SUMMARY_TITLES_PROMPT}\n\n${conversationText}`

      const result = await this.genAI.models.generateContent({
        model: modelId,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: this.getGenerationConfig(0.4, undefined, modelId, false)
      })

      return result.text?.trim() || '新对话'
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
        // 使用API获取模型列表，如果失败则回退到静态列表
        this.models = await this.fetchProviderModels()
        await this.autoEnableModelsIfNeeded()
        // gemini 比较慢，特殊补偿一下
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

    // 如果没有任何已启用的模型，则自动启用推荐的模型
    if (!hasEnabledModels) {
      // 提取推荐模型ID列表
      const recommendedModelIds = GeminiProvider.GEMINI_MODELS.map((model) => model.id)

      // 过滤出匹配推荐列表的模型
      const modelsToEnable = this.models.filter((model) => {
        return this.isModelRecommended(model.id, recommendedModelIds)
      })

      if (modelsToEnable.length > 0) {
        console.info(
          `Auto enabling ${modelsToEnable.length} recommended models for provider: ${this.provider.name}`
        )
        modelsToEnable.forEach((model) => {
          console.info(`Enabling recommended model: ${model.id}`)
          this.configPresenter.enableModel(providerId, model.id)
        })
      } else {
        console.warn(`No recommended models found for provider: ${this.provider.name}`)
      }
    }
  }

  /**
   * 检查模型ID是否与推荐模型列表匹配（模糊匹配）
   * @param modelId 要检查的模型ID
   * @param recommendedIds 推荐模型ID列表
   * @returns 是否匹配
   */
  private isModelRecommended(modelId: string, recommendedIds: string[]): boolean {
    // 标准化模型ID，移除 models/ 前缀进行比较
    const normalizeId = (id: string) => id.replace(/^models\//, '')
    const normalizedModelId = normalizeId(modelId)

    return recommendedIds.some((recommendedId) => {
      const normalizedRecommendedId = normalizeId(recommendedId)

      // 精确匹配
      if (normalizedModelId === normalizedRecommendedId) {
        return true
      }

      // 模糊匹配：检查是否包含核心模型名称
      // 例如 "gemini-2.5-pro" 匹配 "gemini-2.5-pro-experimental"
      if (
        normalizedModelId.includes(normalizedRecommendedId) ||
        normalizedRecommendedId.includes(normalizedModelId)
      ) {
        return true
      }

      // 版本匹配：检查基础模型名称是否相同
      // 例如 "gemini-2.5-flash" 匹配 "gemini-2.5-flash-8b"
      const getBaseModelName = (id: string) => {
        // 移除版本号、实验标识等后缀
        return id
          .replace(/-\d+$/, '') // 移除末尾数字
          .replace(/-latest$/, '') // 移除 -latest
          .replace(/-exp.*$/, '') // 移除实验版本标识
          .replace(/-preview.*$/, '') // 移除预览版本标识
          .replace(/-\d{3,}$/, '') // 移除长数字版本号
      }

      const baseModelId = getBaseModelName(normalizedModelId)
      const baseRecommendedId = getBaseModelName(normalizedRecommendedId)

      return baseModelId === baseRecommendedId
    })
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
      const prompt = `请为以下内容生成一个简洁的摘要：\n\n${text}`

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
      const prompt = `根据以下上下文，请提供最多5个合理的建议选项，每个选项不超过100个字符。请以JSON数组格式返回，不要有其他说明：\n\n${context}`

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

      // 如果都失败了，返回一个默认提示
      return ['无法生成建议']
    } catch (error) {
      console.error('Gemini suggestions error:', error)
      return ['发生错误，无法获取建议']
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
    const isImageGenerationModel = modelId === 'models/gemini-2.0-flash-preview-image-generation'

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
        yield {
          type: 'tool_call_start',
          tool_call_id: toolCallId,
          tool_call_name: functionName
        }

        // 发送工具调用参数
        const argsString = JSON.stringify(functionArgs)
        yield {
          type: 'tool_call_chunk',
          tool_call_id: toolCallId,
          tool_call_arguments_chunk: argsString
        }

        // 发送工具调用结束事件
        yield {
          type: 'tool_call_end',
          tool_call_id: toolCallId,
          tool_call_arguments_complete: argsString
        }

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
            thoughtContent += part.text
          } else if (part.text) {
            content += part.text
          } else if (part.inlineData && part.inlineData.data && part.inlineData.mimeType) {
            // 处理图像数据
            yield {
              type: 'image_data',
              image_data: {
                data: part.inlineData.data,
                mimeType: part.inlineData.mimeType
              }
            }
          }
        }
      } else {
        // 兼容处理
        content = chunk.text || ''
      }

      // 如果检测到思考内容，直接发送
      if (thoughtContent) {
        yield {
          type: 'reasoning',
          reasoning_content: thoughtContent
        }
        thoughtContent = '' // 清空已发送的思考内容
      }

      if (!content) continue

      buffer += content

      // 处理思考标签
      if (buffer.includes('<think>') && !isInThinkTag) {
        const thinkStart = buffer.indexOf('<think>')

        // 发送<think>标签前的文本
        if (thinkStart > 0) {
          yield {
            type: 'text',
            content: buffer.substring(0, thinkStart)
          }
        }

        buffer = buffer.substring(thinkStart + 7)
        isInThinkTag = true
        continue
      }

      // 处理思考标签结束
      if (isInThinkTag && buffer.includes('</think>')) {
        const thinkEnd = buffer.indexOf('</think>')
        const reasoningContent = buffer.substring(0, thinkEnd)

        // 发送推理内容
        if (reasoningContent) {
          yield {
            type: 'reasoning',
            reasoning_content: reasoningContent
          }
        }

        buffer = buffer.substring(thinkEnd + 8)
        isInThinkTag = false

        // 如果还有剩余内容，继续处理
        if (buffer) {
          yield {
            type: 'text',
            content: buffer
          }
          buffer = ''
        }

        continue
      }

      // 如果在思考标签内，不输出内容
      if (isInThinkTag) {
        continue
      }

      // 正常输出文本内容
      yield {
        type: 'text',
        content: content
      }

      // 内容已经发送，清空buffer避免重复
      buffer = ''
    }

    if (usageMetadata) {
      yield {
        type: 'usage',
        usage: {
          prompt_tokens: usageMetadata.promptTokenCount || 0,
          completion_tokens: usageMetadata.candidatesTokenCount || 0,
          total_tokens: usageMetadata.totalTokenCount || 0
        }
      }
    }

    // 处理剩余缓冲区内容
    if (buffer) {
      if (isInThinkTag) {
        yield {
          type: 'reasoning',
          reasoning_content: buffer
        }
      } else {
        yield {
          type: 'text',
          content: buffer
        }
      }
    }

    // 发送停止事件
    yield { type: 'stop', stop_reason: toolUseDetected ? 'tool_use' : 'complete' }
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
      // 提取用户提示词
      const userMessage = messages.findLast((msg) => msg.role === 'user')
      if (!userMessage) {
        throw new Error('No user message found for image generation')
      }

      const prompt =
        typeof userMessage.content === 'string'
          ? userMessage.content
          : userMessage.content && Array.isArray(userMessage.content)
            ? userMessage.content
                .filter((c) => c.type === 'text')
                .map((c) => c.text)
                .join('\n')
            : ''

      // 发送生成请求
      const result = await this.genAI.models.generateContentStream({
        model: modelId,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: this.getGenerationConfig(temperature, maxTokens, modelId, false) // 图像生成不需要reasoning
      })

      // 处理流式响应
      for await (const chunk of result) {
        if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
          for (const part of chunk.candidates[0].content.parts) {
            if (part.text) {
              // 输出文本内容
              yield {
                type: 'text',
                content: part.text
              }
            } else if (part.inlineData) {
              // 输出图像数据
              yield {
                type: 'image_data',
                image_data: {
                  data: part.inlineData.data || '',
                  mimeType: part.inlineData.mimeType || ''
                }
              }
            }
          }
        }
      }

      // 发送停止事件
      yield { type: 'stop', stop_reason: 'complete' }
    } catch (error) {
      console.error('Image generation stream error:', error)
      yield {
        type: 'error',
        error_message: error instanceof Error ? error.message : '图像生成失败'
      }
      yield { type: 'stop', stop_reason: 'error' }
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
