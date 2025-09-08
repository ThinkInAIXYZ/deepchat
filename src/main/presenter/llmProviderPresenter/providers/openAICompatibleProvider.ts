import { EMBEDDING_TEST_KEY, isNormalized } from '@/utils/vector'
import {
  LLM_PROVIDER,
  LLMResponse,
  MODEL_META,
  MCPToolDefinition,
  LLMCoreStreamEvent,
  ModelConfig,
  ChatMessage,
  LLM_EMBEDDING_ATTRS,
  IConfigPresenter
} from '@shared/presenter'
import { createStreamEvent } from '@shared/types/core/llm-events'
import { BaseLLMProvider, SUMMARY_TITLES_PROMPT } from '../baseProvider'
import OpenAI, { AzureOpenAI } from 'openai'
import {
  ChatCompletionAssistantMessageParam,
  ChatCompletionContentPart,
  ChatCompletionContentPartText,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam
} from 'openai/resources'
import { presenter } from '@/presenter'
import { eventBus, SendTarget } from '@/eventbus'
import { NOTIFICATION_EVENTS } from '@/events'
import { jsonrepair } from 'jsonrepair'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'
import { proxyConfig } from '../../proxyConfig'
import { ProxyAgent } from 'undici'

const OPENAI_REASONING_MODELS = [
  'o4-mini',
  'o1-pro',
  'o3',
  'o3-pro',
  'o3-mini',
  'o3-preview',
  'o1-mini',
  'o1-pro',
  'o1-preview',
  'o1',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-5-chat'
]
const OPENAI_IMAGE_GENERATION_MODELS = [
  'gpt-4o-all',
  'gpt-4o-image',
  'gpt-image-1',
  'dall-e-3',
  'dall-e-2'
]

// Add supported image size constants
const SUPPORTED_IMAGE_SIZES = {
  SQUARE: '1024x1024',
  LANDSCAPE: '1536x1024',
  PORTRAIT: '1024x1536'
} as const

// Add list of models with configurable sizes
const SIZE_CONFIGURABLE_MODELS = ['gpt-image-1', 'gpt-4o-image', 'gpt-4o-all']

export class OpenAICompatibleProvider extends BaseLLMProvider {
  protected openai!: OpenAI
  protected isNoModelsApi: boolean = false
  // Add blacklist of providers that don't support OpenAI standard interface
  private static readonly NO_MODELS_API_LIST: string[] = []

  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
    this.createOpenAIClient()
    if (OpenAICompatibleProvider.NO_MODELS_API_LIST.includes(this.provider.id.toLowerCase())) {
      this.isNoModelsApi = true
    }
    this.init()
  }

  protected createOpenAIClient(): void {
    // Get proxy configuration
    const proxyUrl = proxyConfig.getProxyUrl()
    const fetchOptions: { dispatcher?: ProxyAgent } = {}

    if (proxyUrl) {
      console.log(`[OpenAI Compatible Provider] Using proxy: ${proxyUrl}`)
      const proxyAgent = new ProxyAgent(proxyUrl)
      fetchOptions.dispatcher = proxyAgent
    }

    // Check if this is official OpenAI or Azure OpenAI
    const isOfficialOpenAI = this.isOfficialOpenAIService()
    const isAzureOpenAI = this.provider.id === 'azure-openai'

    // Only use custom fetch for third-party services to avoid triggering 403
    // Keep original behavior for official OpenAI and Azure OpenAI for best compatibility
    const shouldUseCleanFetch = !isOfficialOpenAI && !isAzureOpenAI
    const customFetch = shouldUseCleanFetch ? this.createCleanFetch() : undefined

    if (isAzureOpenAI) {
      try {
        const apiVersion = this.configPresenter.getSetting<string>('azureApiVersion')
        const azureConfig: any = {
          apiKey: this.provider.apiKey,
          baseURL: this.provider.baseUrl,
          apiVersion: apiVersion || '2024-02-01',
          defaultHeaders: {
            ...this.defaultHeaders
          }
        }

        // Use fetchOptions for proxy (original behavior for Azure)
        if (fetchOptions.dispatcher) {
          azureConfig.fetchOptions = fetchOptions
        }

        this.openai = new AzureOpenAI(azureConfig)
      } catch (e) {
        console.warn('create azure openai failed', e)
      }
    } else {
      const openaiConfig: any = {
        apiKey: this.provider.apiKey,
        baseURL: this.provider.baseUrl,
        defaultHeaders: {
          ...this.defaultHeaders
        }
      }

      if (customFetch) {
        // Third-party service: use custom fetch to avoid 403
        openaiConfig.fetch = customFetch
        // Also apply proxy via fetchOptions for third-party services
        if (fetchOptions.dispatcher) {
          openaiConfig.fetchOptions = fetchOptions
        }
        console.log(
          `[OpenAI Compatible Provider] Using custom fetch for third-party service: ${this.provider.baseUrl}`
        )
      } else {
        // Official OpenAI: use original behavior with fetchOptions
        if (fetchOptions.dispatcher) {
          openaiConfig.fetchOptions = fetchOptions
        }
        console.log(`[OpenAI Compatible Provider] Using original fetch for official OpenAI`)
      }

      this.openai = new OpenAI(openaiConfig)
    }
  }

  /**
   * Check if this is the official OpenAI service by provider ID
   */
  private isOfficialOpenAIService(): boolean {
    return this.provider.id === 'openai'
  }

  /**
   * Creates a custom fetch function that removes OpenAI SDK headers that may trigger 403
   * This ensures all OpenAI SDK requests (including streaming) use clean headers
   */
  private createCleanFetch() {
    return async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      // Create a copy of init to avoid modifying the original
      const cleanInit = { ...init }

      if (cleanInit.headers) {
        // Convert headers to a plain object for easier manipulation
        const headers = new Headers(cleanInit.headers)
        const cleanHeaders: Record<string, string> = {}

        // Only keep essential headers, remove SDK-specific ones that trigger 403
        const allowedHeaders = [
          'authorization',
          'content-type',
          'accept',
          'http-referer',
          'x-title'
        ]

        headers.forEach((value, key) => {
          const lowerKey = key.toLowerCase()
          // Keep only allowed headers and avoid X-Stainless-* headers
          if (
            allowedHeaders.includes(lowerKey) ||
            (!lowerKey.startsWith('x-stainless-') &&
              !lowerKey.includes('user-agent') &&
              !lowerKey.includes('openai-'))
          ) {
            cleanHeaders[key] = value
          }
        })

        // Ensure we have Authorization header
        if (!cleanHeaders['Authorization'] && !cleanHeaders['authorization']) {
          cleanHeaders['Authorization'] = `Bearer ${this.provider.apiKey}`
        }

        // Add our default headers
        Object.assign(cleanHeaders, this.defaultHeaders)

        cleanInit.headers = cleanHeaders
      }

      // Use regular fetch - proxy is already handled by OpenAI SDK's fetchOptions
      return fetch(url, cleanInit)
    }
  }

  public onProxyResolved(): void {
    this.createOpenAIClient()
  }

  // Implement abstract method fetchProviderModels from BaseLLMProvider
  protected async fetchProviderModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    // Check if provider is in blacklist
    if (this.isNoModelsApi) {
      // console.log(`Provider ${this.provider.name} does not support OpenAI models API`)
      return this.models
    }
    return this.fetchOpenAIModels(options)
  }

  protected async fetchOpenAIModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    // Now using the clean fetch function via OpenAI SDK
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

  /**
   * User messages: Upper layer will insert image_url based on whether vision exists
   * Assistant messages: Need to judge and convert images to correct context, as models can be switched
   * @param messages
   * @returns
   */
  protected formatMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
    return messages.map((msg) => {
      // Handle basic message structure
      const baseMessage: Partial<ChatCompletionMessageParam> = {
        role: msg.role as 'system' | 'user' | 'assistant' | 'tool'
      }

      // Handle content conversion to string
      if (msg.content !== undefined && msg.role !== 'user') {
        if (typeof msg.content === 'string') {
          baseMessage.content = msg.content
        } else if (Array.isArray(msg.content)) {
          // Handle multimodal content arrays
          const textParts: string[] = []
          for (const part of msg.content) {
            if (part.type === 'text' && part.text) {
              textParts.push(part.text)
            }
            if (part.type === 'image_url' && part.image_url?.url) {
              textParts.push(`image: ${part.image_url.url}`)
            }
          }
          baseMessage.content = textParts.join('\n')
        }
      }
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          baseMessage.content = msg.content
        } else if (Array.isArray(msg.content)) {
          baseMessage.content = msg.content as ChatCompletionContentPart[]
        }
      }

      if (msg.role === 'assistant' && msg.tool_calls) {
        ;(baseMessage as ChatCompletionAssistantMessageParam).tool_calls = msg.tool_calls
      }
      if (msg.role === 'tool') {
        ;(baseMessage as ChatCompletionToolMessageParam).tool_call_id = msg.tool_call_id || ''
      }

      return baseMessage as ChatCompletionMessageParam
    })
  }

  // OpenAI completion method
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
    const requestParams: OpenAI.Chat.ChatCompletionCreateParams = {
      messages: this.formatMessages(messages),
      model: modelId,
      stream: false,
      temperature: temperature,
      ...(modelId.startsWith('o1') ||
      modelId.startsWith('o3') ||
      modelId.startsWith('o4') ||
      modelId.includes('gpt-5')
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens })
    }
    OPENAI_REASONING_MODELS.forEach((noTempId) => {
      if (modelId.startsWith(noTempId)) {
        delete requestParams.temperature
      }
    })
    const completion = await this.openai.chat.completions.create(requestParams)

    const message = completion.choices[0].message as ChatCompletionMessage & {
      reasoning_content?: string
    }
    const resultResp: LLMResponse = {
      content: ''
    }

    // Handle native reasoning_content
    if (message.reasoning_content) {
      resultResp.reasoning_content = message.reasoning_content
      resultResp.content = message.content || ''
      return resultResp
    }

    // Handle <think> tags
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

  ///////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * 处理图片生成模型请求的内部方法。
   * @param messages 聊天消息数组。
   * @param modelId 模型ID。
   * @returns AsyncGenerator<LLMCoreStreamEvent> 流式事件。
   */
  private async *handleImgGeneration(
    messages: ChatMessage[],
    modelId: string
  ): AsyncGenerator<LLMCoreStreamEvent> {
    // 获取最后几条消息，检查是否有图片
    let prompt = ''
    const imageUrls: string[] = []
    // 获取最后的用户消息内容作为提示词
    const lastUserMessage = messages.findLast((m) => m.role === 'user')

    if (lastUserMessage?.content) {
      if (typeof lastUserMessage.content === 'string') {
        prompt = lastUserMessage.content
      } else if (Array.isArray(lastUserMessage.content)) {
        // 处理多模态内容，提取文本
        const textParts: string[] = []
        for (const part of lastUserMessage.content) {
          if (part.type === 'text' && part.text) {
            textParts.push(part.text)
          }
        }
        prompt = textParts.join('\n')
      }
    }

    // 检查最后几条消息中是否有图片
    // 通常我们只需要检查最后两条消息：最近的用户消息和最近的助手消息
    const lastMessages = messages.slice(-2)
    for (const message of lastMessages) {
      if (message.content) {
        if (Array.isArray(message.content)) {
          for (const part of message.content) {
            if (part.type === 'image_url' && part.image_url?.url) {
              imageUrls.push(part.image_url.url)
            }
          }
        }
      }
    }

    if (!prompt) {
      console.error('[handleImgGeneration] Could not extract prompt for image generation.')
      yield createStreamEvent.error('Could not extract prompt for image generation.')
      yield createStreamEvent.stop('error')
      return
    }

    try {
      let result: OpenAI.Images.ImagesResponse

      if (imageUrls.length > 0) {
        // 使用 images.edit 接口处理带有图片的请求
        let imageBuffer: Buffer

        if (imageUrls[0].startsWith('imgcache://')) {
          const filePath = imageUrls[0].slice('imgcache://'.length)
          const fullPath = path.join(app.getPath('userData'), 'images', filePath)
          imageBuffer = fs.readFileSync(fullPath)
        } else {
          const imageResponse = await fetch(imageUrls[0])
          const imageBlob = await imageResponse.blob()
          imageBuffer = Buffer.from(await imageBlob.arrayBuffer())
        }

        // 创建临时文件
        const imagePath = `/tmp/openai_image_${Date.now()}.png`
        await new Promise<void>((resolve, reject) => {
          fs.writeFile(imagePath, imageBuffer, (err: Error | null) => {
            if (err) {
              reject(err)
            } else {
              resolve()
            }
          })
        })

        // 使用文件路径创建 Readable 流
        const imageFile = fs.createReadStream(imagePath)
        const params: OpenAI.Images.ImageEditParams = {
          model: modelId,
          image: imageFile,
          prompt: prompt,
          n: 1
        }

        // 如果是支持尺寸配置的模型，检测图片尺寸并设置合适的参数
        if (SIZE_CONFIGURABLE_MODELS.includes(modelId)) {
          try {
            const metadata = await sharp(imageBuffer).metadata()
            if (metadata.width && metadata.height) {
              const aspectRatio = metadata.width / metadata.height

              // 根据宽高比选择最接近的尺寸
              if (Math.abs(aspectRatio - 1) < 0.1) {
                // 接近正方形
                params.size = SUPPORTED_IMAGE_SIZES.SQUARE
              } else if (aspectRatio > 1) {
                // 横向图片
                params.size = SUPPORTED_IMAGE_SIZES.LANDSCAPE
              } else {
                // 纵向图片
                params.size = SUPPORTED_IMAGE_SIZES.PORTRAIT
              }
            } else {
              // 如果无法获取宽高，使用默认参数
              params.size = '1024x1536'
            }
            params.quality = 'high'
          } catch (error) {
            console.warn(
              '[handleImgGeneration] Failed to detect image dimensions, using default size:',
              error
            )
            // 检测失败时使用默认参数
            params.size = '1024x1536'
            params.quality = 'high'
          }
        }

        result = await this.openai.images.edit(params)

        // 清理临时文件
        try {
          fs.unlinkSync(imagePath)
        } catch (e) {
          console.error('[handleImgGeneration] Failed to delete temporary file:', e)
        }
      } else {
        // 使用原来的 images.generate 接口处理没有图片的请求
        console.log(
          `[handleImgGeneration] Generating image with model ${modelId} and prompt: "${prompt}"`
        )
        const params: OpenAI.Images.ImageGenerateParams = {
          model: modelId,
          prompt: prompt,
          n: 1,
          response_format: 'b64_json' // 请求 base64 格式
        }
        if (modelId === 'gpt-image-1' || modelId === 'gpt-4o-image' || modelId === 'gpt-4o-all') {
          params.size = '1024x1536'
          params.quality = 'high'
        }
        result = await this.openai.images.generate(params, {
          timeout: 300_000
        })
      }

      if (result.data && (result.data[0]?.url || result.data[0]?.b64_json)) {
        // 使用devicePresenter缓存图片URL
        try {
          let imageUrl: string = ''
          if (result.data[0]?.b64_json) {
            // 处理 base64 数据
            const base64Data = result.data[0].b64_json
            // 直接使用 devicePresenter 缓存 base64 数据
            imageUrl = await presenter.devicePresenter.cacheImage(
              base64Data.startsWith('data:image/png;base64,')
                ? base64Data
                : 'data:image/png;base64,' + base64Data
            )
          } else {
            // 原有的 URL 处理逻辑
            imageUrl = result.data[0]?.url || ''
            imageUrl = await presenter.devicePresenter.cacheImage(imageUrl)
          }

          // 返回缓存后的URL
          yield createStreamEvent.imageData({ data: imageUrl, mimeType: 'deepchat/image-url' })

          // 处理 usage 信息
          if (result.usage) {
            yield createStreamEvent.usage({
              prompt_tokens: result.usage.input_tokens || 0,
              completion_tokens: result.usage.output_tokens || 0,
              total_tokens: result.usage.total_tokens || 0
            })
          }

          yield createStreamEvent.stop('complete')
        } catch (cacheError) {
          // 缓存失败时降级为使用原始URL
          console.warn(
            '[handleImgGeneration] Failed to cache image, using original data/URL:',
            cacheError
          )
          yield createStreamEvent.imageData({
            data: result.data[0]?.url || result.data[0]?.b64_json || '',
            mimeType: result.data[0]?.url ? 'deepchat/image-url' : 'deepchat/image-base64'
          })
          yield createStreamEvent.stop('complete')
        }
      } else {
        console.error('[handleImgGeneration] No image data received from API.', result)
        yield createStreamEvent.error('No image data received from API.')
        yield createStreamEvent.stop('error')
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[handleImgGeneration] Error during image generation:', errorMessage)
      yield createStreamEvent.error(`Image generation failed: ${errorMessage}`)
      yield createStreamEvent.stop('error')
    }
  }

  ///////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * 处理 OpenAI 聊天补全模型请求的内部方法。
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
    //-----------------------------------------------------------------------------------------------------
    // 为 OpenAI 聊天补全准备消息和工具
    const tools = mcpTools || []
    const supportsFunctionCall = modelConfig?.functionCall || false // 判断是否支持原生函数调用
    let processedMessages = [...this.formatMessages(messages)] as ChatCompletionMessageParam[]

    // 如果不支持原生函数调用但存在工具，则准备非原生函数调用提示
    if (tools.length > 0 && !supportsFunctionCall) {
      processedMessages = this.prepareFunctionCallPrompt(processedMessages, tools)
    }

    // 如果支持原生函数调用，则转换工具定义为 OpenAI 格式
    const apiTools =
      tools.length > 0 && supportsFunctionCall
        ? await presenter.mcpPresenter.mcpToolsToOpenAITools(tools, this.provider.id)
        : undefined

    // 构建请求参数
    const requestParams: OpenAI.Chat.ChatCompletionCreateParams = {
      messages: processedMessages,
      model: modelId,
      stream: true,
      temperature,
      ...(modelId.startsWith('o1') ||
      modelId.startsWith('o3') ||
      modelId.startsWith('o4') ||
      modelId.includes('gpt-5')
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens })
    }

    // 添加 stream_options 以获取 token usages（适用于如 Qwen 等模型）
    requestParams.stream_options = { include_usage: true }

    // 防止某些模型（如 Qwen）以 JSON 形式输出结果正文，Grok 系列模型和供应商无需设置
    if (this.provider.id.toLowerCase().includes('dashscope')) {
      requestParams.response_format = { type: 'text' }
    }

    // openrouter deepseek-v3-0324:free 特定模型处理
    if (
      this.provider.id.toLowerCase().includes('openrouter') &&
      modelId.startsWith('deepseek/deepseek-chat-v3-0324:free')
    ) {
      // 限定服务供应商为chutes，sorry for hack...
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(requestParams as any).provider = {
        only: ['chutes']
      }
    }

    if (modelConfig.reasoningEffort) {
      ;(requestParams as any).reasoning_effort = modelConfig.reasoningEffort
    }

    // verbosity 仅支持 GPT-5 系列模型
    if (modelId.includes('gpt-5') && modelConfig.verbosity) {
      ;(requestParams as any).verbosity = modelConfig.verbosity
    }

    // 移除推理模型的温度参数
    OPENAI_REASONING_MODELS.forEach((noTempId) => {
      if (modelId.startsWith(noTempId)) delete requestParams.temperature
    })

    // 如果存在 API 工具且支持函数调用，则添加到请求参数中
    if (apiTools && apiTools.length > 0 && supportsFunctionCall) requestParams.tools = apiTools

    // 发起 OpenAI 聊天补全请求
    const stream = await this.openai.chat.completions.create(requestParams)

    //-----------------------------------------------------------------------------------------------------
    // 流处理状态定义 (已将相关变量声明提升到顶部，确保可见性)
    let pendingBuffer = '' // 累积来自 delta.content 的字符，用于匹配标签和内容
    let currentTextOutputBuffer = '' // 用于累积在所有标签之外的纯文本，准备输出

    const thinkStartMarker = '<think>'
    const thinkEndMarker = '</think>'
    const funcStartMarker = '<function_call>'
    const funcEndMarker = '</function_call>'

    // 标记当前解析状态
    let inThinkBlock = false // 是否在 <think> 块内部
    let inFunctionCallBlock = false // 是否在 <function_call> 块内部（非原生）

    // 定义一个辅助函数，检查 buffer 是否可能是任何已知标签的有效前缀
    const hasPotentialMarkerPrefix = (buffer: string) => {
      return (
        thinkStartMarker.startsWith(buffer) ||
        thinkEndMarker.startsWith(buffer) ||
        funcStartMarker.startsWith(buffer) ||
        funcEndMarker.startsWith(buffer)
      )
    }

    const nativeToolCalls: Record<
      string,
      { name: string; arguments: string; completed?: boolean }
    > = {}
    const indexToIdMap: Record<number, string> = {}
    let stopReason: LLMCoreStreamEvent['stop_reason'] = 'complete'
    let toolUseDetected = false // 标记是否检测到工具使用（原生或非原生）
    let usage:
      | {
          prompt_tokens: number
          completion_tokens: number
          total_tokens: number
        }
      | undefined = undefined

    //-----------------------------------------------------------------------------------------------------
    // 流处理循环
    for await (const chunk of stream) {
      // console.log('[handleChatCompletion] chunk', JSON.stringify(chunk))
      const choice = chunk.choices[0]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delta = choice?.delta as any
      const currentContent = delta?.content || ''

      // 1. 处理非内容事件 (如 usage, reasoning, tool_calls)
      if (chunk.usage) {
        usage = chunk.usage
      }

      // 原生 reasoning 内容处理（直接产出）
      if (delta?.reasoning_content || delta?.reasoning) {
        yield createStreamEvent.reasoning(delta.reasoning_content || delta.reasoning)
        continue
      }

      // 处理图片数据（OpenRouter Gemini 格式）
      if (delta?.images && Array.isArray(delta.images)) {
        for (const image of delta.images) {
          if (image.type === 'image_url' && image.image_url?.url) {
            try {
              const cachedUrl = await presenter.devicePresenter.cacheImage(image.image_url.url)
              yield createStreamEvent.imageData({ data: cachedUrl, mimeType: 'deepchat/image-url' })
            } catch (cacheError) {
              console.warn('[handleChatCompletion] Failed to cache image:', cacheError)
              yield createStreamEvent.imageData({
                data: image.image_url.url,
                mimeType: 'deepchat/image-url'
              })
            }
          }
        }
        continue
      }

      // 处理 Gemini 原生格式的图片数据（inlineData）
      if (delta?.content?.parts && Array.isArray(delta.content.parts)) {
        for (const part of delta.content.parts) {
          if (part.inlineData && part.inlineData.data) {
            yield createStreamEvent.imageData({
              data: part.inlineData.data,
              mimeType: part.inlineData.mimeType || 'image/png'
            })
          }
        }
        continue
      }

      // 处理 content 中直接包含 base64 图片的情况
      let processedCurrentContent = currentContent
      if (currentContent && currentContent.includes('![image](data:image/')) {
        try {
          // 使用正则表达式匹配 markdown 格式的 base64 图片
          const base64ImageRegex = /!\[image\]\((data:image\/[^;]+;base64,[^)]+)\)/g
          let hasImages = false

          let match
          while ((match = base64ImageRegex.exec(currentContent)) !== null) {
            const base64Data = match[1] // 完整的 data:image/...;base64,... 格式

            try {
              // 缓存图片并获取URL
              const cachedUrl = await presenter.devicePresenter.cacheImage(base64Data)

              // 发送图片数据事件
              yield createStreamEvent.imageData({ data: cachedUrl, mimeType: 'deepchat/image-url' })

              // 从内容中完全移除图片部分，避免重复显示（image_data事件已经处理了图片显示）
              processedCurrentContent = processedCurrentContent.replace(match[0], '')
              hasImages = true

              console.log(
                `[handleChatCompletion] Successfully cached base64 image from content and removed from text`
              )
            } catch (cacheError) {
              console.warn(
                '[handleChatCompletion] Failed to cache base64 image from content:',
                cacheError
              )
              // 缓存失败时保持原始内容不变
            }
          }

          // 如果处理了图片，清理多余的空行并记录日志
          if (hasImages) {
            // 清理移除图片后可能留下的多余空行
            processedCurrentContent = processedCurrentContent.replace(/\n\s*\n/g, '\n').trim()
            console.log(
              `[handleChatCompletion] Processed ${currentContent.length} chars -> ${processedCurrentContent.length} chars (images removed)`
            )
          }
        } catch (error) {
          console.error('[handleChatCompletion] Error processing base64 images in content:', error)
          // 处理失败时继续正常流程
        }
      }

      // 原生 tool_calls 处理
      if (supportsFunctionCall && delta?.tool_calls?.length > 0) {
        toolUseDetected = true
        // console.log('[handleChatCompletion] Handling native tool_calls', JSON.stringify(delta.tool_calls))
        for (const toolCallDelta of delta.tool_calls) {
          const id = toolCallDelta.id ? toolCallDelta.id : toolCallDelta.function?.name
          const index = toolCallDelta.index
          const functionName = toolCallDelta.function?.name
          const argumentChunk = toolCallDelta.function?.arguments

          let currentToolCallId: string | undefined = undefined

          if (id) {
            currentToolCallId = id
            if (index !== undefined) indexToIdMap[index] = id
          } else if (index !== undefined && indexToIdMap[index]) {
            currentToolCallId = indexToIdMap[index]
          } else {
            console.warn(
              '[handleChatCompletion] Received tool call delta chunk without id/mapping:',
              toolCallDelta
            )
            continue
          }

          if (currentToolCallId) {
            if (!nativeToolCalls[currentToolCallId]) {
              nativeToolCalls[currentToolCallId] = { name: '', arguments: '', completed: false }
              // console.log(`[handleChatCompletion] Initialized nativeToolCalls entry for id ${currentToolCallId}`)
            }

            const currentCallState = nativeToolCalls[currentToolCallId]

            // 处理增量更新
            // console.log(`[handleChatCompletion] Handling incremental update for ${currentToolCallId}.`)
            if (functionName && !currentCallState.name) {
              currentCallState.name = functionName
              yield createStreamEvent.toolCallStart(currentToolCallId, functionName)
            }
            if (argumentChunk) {
              currentCallState.arguments += argumentChunk
              yield createStreamEvent.toolCallChunk(currentToolCallId, argumentChunk)
            }
          }
        }
        continue // 处理完原生工具调用后继续下一个 chunk
      }

      // 处理停止原因
      if (choice?.finish_reason) {
        const reasonFromAPI = choice.finish_reason
        // console.log('[handleChatCompletion] Finish Reason from API:', reasonFromAPI)
        if (reasonFromAPI === 'tool_calls') {
          stopReason = 'tool_use'
          toolUseDetected = true
        } else if (toolUseDetected) {
          // 如果之前已经有工具调用，那么 finish_reason 'stop' 意味着工具调用完成
          stopReason =
            reasonFromAPI === 'stop'
              ? 'complete'
              : reasonFromAPI === 'length'
                ? 'max_tokens'
                : 'error'
        } else if (reasonFromAPI === 'stop') {
          stopReason = 'complete'
        } else if (reasonFromAPI === 'length') {
          stopReason = 'max_tokens'
        } else {
          console.warn(`[handleChatCompletion] Unhandled finish reason: ${reasonFromAPI}`)
          stopReason = 'error'
        }
        /*
        choice {
          finish_reason: 'stop',
          delta: { content: '！' },
          index: 0,
          logprobs: null
        }
        */
        // continue
      }

      // 如果没有内容，则继续下一个 chunk
      if (!processedCurrentContent) continue

      // 2. 字符级流式处理内容
      for (const char of processedCurrentContent) {
        pendingBuffer += char

        // 循环处理 pendingBuffer 直到它为空，或者不足以继续匹配
        while (pendingBuffer.length > 0) {
          if (inThinkBlock) {
            // 在 <think> 内部，所有内容都视为 reasoning
            if (
              pendingBuffer.length >= thinkEndMarker.length &&
              pendingBuffer.endsWith(thinkEndMarker)
            ) {
              const content = pendingBuffer.slice(0, -thinkEndMarker.length)
              if (content) {
                yield createStreamEvent.reasoning(content)
              }
              inThinkBlock = false
              pendingBuffer = '' // 清空 buffer，退出当前 while 循环
            } else {
              // 如果 pendingBuffer 长度不足以匹配 </think>，或者已经超过 </think> 长度但不是其有效前缀
              // 意味着 pendingBuffer 的首字符是推理内容的一部分，可以产出。
              // 否则，pendingBuffer 是 </think> 的有效前缀，继续累积等待完整标签。
              if (
                pendingBuffer.length > thinkEndMarker.length ||
                !thinkEndMarker.startsWith(pendingBuffer)
              ) {
                const charToYield = pendingBuffer[0]
                pendingBuffer = pendingBuffer.slice(1)
                yield createStreamEvent.reasoning(charToYield)
              } else {
                break // 跳出 while 循环，等待更多字符以形成完整的结束标签
              }
            }
          } else if (inFunctionCallBlock) {
            // 在非原生 <function_call> 内部
            if (
              pendingBuffer.length >= funcEndMarker.length &&
              pendingBuffer.endsWith(funcEndMarker)
            ) {
              const content = pendingBuffer.slice(0, -funcEndMarker.length)
              // 解析非原生函数调用
              const parsedCalls = this.parseFunctionCalls(
                `${funcStartMarker}${content}${funcEndMarker}`, // 确保完整标签以进行解析
                `non-native-${this.provider.id}`
              )
              for (const parsedCall of parsedCalls) {
                yield createStreamEvent.toolCallStart(parsedCall.id, parsedCall.function.name)
                yield createStreamEvent.toolCallChunk(parsedCall.id, parsedCall.function.arguments)
                yield createStreamEvent.toolCallEnd(parsedCall.id, parsedCall.function.arguments)
              }
              toolUseDetected = true // 标记检测到工具使用
              inFunctionCallBlock = false
              pendingBuffer = '' // 清空 buffer，退出当前 while 循环
            } else {
              // 在 <function_call> 内部，直到结束标签出现前，所有内容都应无条件累积。
              // 不进行字符产出，因为函数调用参数需要完整性。
              // 仅等待完整标签的出现。
              break // 跳出 while 循环，等待更多字符以形成完整的结束标签
            }
          } else {
            // 不在任何特殊块内部，检查开始标签或输出纯文本
            // 优先尝试匹配完整的开始标签
            if (
              pendingBuffer.length >= thinkStartMarker.length &&
              pendingBuffer.endsWith(thinkStartMarker)
            ) {
              const textBeforeTag = pendingBuffer.slice(0, -thinkStartMarker.length)
              if (textBeforeTag) {
                currentTextOutputBuffer += textBeforeTag
                yield createStreamEvent.text(currentTextOutputBuffer)
                currentTextOutputBuffer = ''
              }
              inThinkBlock = true
              pendingBuffer = '' // 清空 buffer，继续内层 while 循环
            } else if (
              pendingBuffer.length >= funcStartMarker.length &&
              pendingBuffer.endsWith(funcStartMarker)
            ) {
              const textBeforeTag = pendingBuffer.slice(0, -funcStartMarker.length)
              if (textBeforeTag) {
                currentTextOutputBuffer += textBeforeTag
                yield createStreamEvent.text(currentTextOutputBuffer)
                currentTextOutputBuffer = ''
              }
              inFunctionCallBlock = true
              pendingBuffer = '' // 清空 buffer，继续内层 while 循环
            } else {
              // 如果没有匹配到完整的开始标签，并且 pendingBuffer 不再是任何已知标签的有效前缀，
              // 那么 pendingBuffer 的首字符就是纯文本，可以安全产出。
              // 否则，pendingBuffer 仍可能是某个标签的有效前缀，继续累积。
              if (!hasPotentialMarkerPrefix(pendingBuffer)) {
                const charToYield = pendingBuffer[0]
                pendingBuffer = pendingBuffer.slice(1)
                currentTextOutputBuffer += charToYield
                yield createStreamEvent.text(currentTextOutputBuffer)
                currentTextOutputBuffer = ''
              } else {
                break // 跳出 while 循环，等待更多字符以形成完整的标签
              }
            }
          }
        } // 字符循环内部的 while 循环结束
      } // 字符循环结束
    } // chunk 循环结束

    //-----------------------------------------------------------------------------------------------------
    // 最终处理：流结束时处理任何剩余的缓冲内容
    // 1. 处理 pendingBuffer 中剩余的任何内容
    if (pendingBuffer.length > 0) {
      if (inThinkBlock) {
        // 如果流结束时 <think> 未闭合，将其内容作为 reasoning 产出
        console.warn(
          `[handleChatCompletion] Stream ended while inside unclosed <think> tag. Remaining content: "${pendingBuffer}"`
        )
        yield createStreamEvent.reasoning(pendingBuffer)
      } else if (inFunctionCallBlock) {
        // 如果流结束时非原生函数调用未闭合，尝试解析并作为工具调用事件（不发出 end 事件）
        console.warn(
          `[handleChatCompletion] Stream ended while inside unclosed <function_call> tag. Content: "${pendingBuffer}"`
        )
        const parsedCalls = this.parseFunctionCalls(
          `${funcStartMarker}${pendingBuffer}`, // 只尝试解析已有的部分，即使不完整，并以incomplete标记，以便下游发现
          `non-native-incomplete-${this.provider.id}`
        )
        if (parsedCalls.length > 0) {
          for (const parsedCall of parsedCalls) {
            yield createStreamEvent.toolCallStart(
              parsedCall.id + '-incomplete',
              parsedCall.function.name
            )
            yield createStreamEvent.toolCallChunk(
              parsedCall.id + '-incomplete',
              parsedCall.function.arguments || ''
            )
            // 不会发出 tool_call_end，因为标签未闭合
            // 不发出 tool_call_end 的理由在于，提醒下游发现未完成的function调用
          }
          toolUseDetected = true
        } else {
          // 如果解析失败，则作为纯文本输出，并附带开始标签
          yield createStreamEvent.text(`${funcStartMarker}${pendingBuffer}`)
        }
      } else {
        // 否则，作为普通纯文本输出
        currentTextOutputBuffer += pendingBuffer
      }
      pendingBuffer = ''
    }

    // 2. 处理 currentTextOutputBuffer 中剩余的任何纯文本
    if (currentTextOutputBuffer) {
      yield createStreamEvent.text(currentTextOutputBuffer)
      currentTextOutputBuffer = ''
    }

    // 3. 最终检查和产出原生工具调用
    // 这里假设原生工具调用在流结束时其 arguments 都已完整。
    if (supportsFunctionCall && toolUseDetected) {
      for (const toolId in nativeToolCalls) {
        const tool = nativeToolCalls[toolId]
        // 只有当工具名称和参数都存在且未标记为已完成时才尝试结束事件
        if (tool.name && tool.arguments && !tool.completed) {
          try {
            JSON.parse(tool.arguments) // 检查参数是否是有效的 JSON
            yield createStreamEvent.toolCallEnd(toolId, tool.arguments)
            tool.completed = true // 标记为已完成
          } catch (e) {
            console.error(
              `[handleChatCompletion] Error parsing arguments for native tool ${toolId} during finalization: ${tool.arguments}`,
              e
            )
            // 即使解析失败，也尝试发送，以提供尽可能多的信息
            yield createStreamEvent.toolCallEnd(toolId, tool.arguments)
            tool.completed = true // 标记为已完成
          }
        } else if (!tool.completed) {
          // 记录警告，如果工具调用不完整且未被处理
          console.warn(
            `[handleChatCompletion] Native tool call ${toolId} is incomplete and will not have an end event during finalization. Name: ${tool.name}, Args: ${tool.arguments}`
          )
        }
      }
    }

    // 4. 产出 usage 信息
    if (usage) {
      yield createStreamEvent.usage(usage)
    }

    // 5. 产出最终停止原因
    const finalStopReason = toolUseDetected ? 'tool_use' : stopReason
    yield createStreamEvent.stop(finalStopReason)
  }

  ///////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * 核心流处理方法，根据模型类型分发请求。
   * @param messages 聊天消息数组。
   * @param modelId 模型ID。
   * @param modelConfig 模型配置。
   * @param temperature 温度参数。
   * @param maxTokens 最大 token 数。
   * @param mcpTools MCP 工具定义数组。
   * @returns AsyncGenerator<LLMCoreStreamEvent> 流式事件。
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

    if (OPENAI_IMAGE_GENERATION_MODELS.includes(modelId)) {
      yield* this.handleImgGeneration(messages, modelId)
    } else {
      yield* this.handleChatCompletion(
        messages,
        modelId,
        modelConfig,
        temperature,
        maxTokens,
        mcpTools
      )
    }
  }

  ///////////////////////////////////////////////////////////////////////////////////////////////////////
  // ... [prepareFunctionCallPrompt remains unchanged] ...
  private prepareFunctionCallPrompt(
    messages: ChatCompletionMessageParam[],
    mcpTools: MCPToolDefinition[]
  ): ChatCompletionMessageParam[] {
    // 创建消息副本而不是直接修改原始消息
    const result = messages.map((message) => ({ ...message }))

    const functionCallPrompt = this.getFunctionCallWrapPrompt(mcpTools)
    const userMessage = result.findLast((message) => message.role === 'user')

    if (userMessage?.role === 'user') {
      if (Array.isArray(userMessage.content)) {
        // 创建content数组的深拷贝
        userMessage.content = [...userMessage.content]
        const firstTextIndex = userMessage.content.findIndex((content) => content.type === 'text')
        if (firstTextIndex !== -1) {
          // 创建文本内容的副本
          const textContent = {
            ...userMessage.content[firstTextIndex]
          } as ChatCompletionContentPartText
          textContent.text = `${functionCallPrompt}\n\n${(userMessage.content[firstTextIndex] as ChatCompletionContentPartText).text}`
          userMessage.content[firstTextIndex] = textContent
        }
      } else {
        userMessage.content = `${functionCallPrompt}\n\n${userMessage.content}`
      }
    }
    return result
  }

  // Updated parseFunctionCalls signature and implementation
  protected parseFunctionCalls(
    response: string,
    // Pass a prefix for creating fallback IDs
    fallbackIdPrefix: string = 'tool-call'
  ): Array<{ id: string; type: string; function: { name: string; arguments: string } }> {
    // console.log('[parseFunctionCalls] Received raw response:', response) // Log raw input
    try {
      // 使用非贪婪模式匹配function_call标签对，能够处理多行内容
      const functionCallMatches = response.match(/<function_call>([\s\S]*?)<\/function_call>/gs)
      if (!functionCallMatches) {
        // console.log('[parseFunctionCalls] No <function_call> tags found.') // Log no match
        return []
      }
      // console.log(`[parseFunctionCalls] Found ${functionCallMatches.length} potential matches.`) // Log match count

      const toolCalls = functionCallMatches
        .map((match, index) => {
          // console.log(`[parseFunctionCalls] Processing match ${index}:`, match) // Log each match
          // Add index for unique fallback ID generation
          const content = match.replace(/<\/?function_call>/g, '').trim() // Fixed regex escaping
          // console.log(`[parseFunctionCalls] Extracted content for match ${index}:`, content) // Log extracted content
          if (!content) {
            // console.log(`[parseFunctionCalls] Match ${index} has empty content, skipping.`)
            return null // Skip empty content between tags
          }

          try {
            let parsedCall
            let repairedJson: string | undefined
            try {
              // Attempt standard JSON parse first
              parsedCall = JSON.parse(content)
              // console.log(`[parseFunctionCalls] Standard JSON.parse successful for match ${index}.`) // Log success
            } catch (initialParseError) {
              console.warn(
                `[parseFunctionCalls] Standard JSON.parse failed for match ${index}, attempting jsonrepair. Error:`,
                (initialParseError as Error).message
              ) // Log failure and attempt repair
              try {
                // Fallback to jsonrepair for robustness
                repairedJson = jsonrepair(content)
                // console.log(
                //   `[parseFunctionCalls] jsonrepair result for match ${index}:`,
                //   repairedJson
                // ) // Log repaired JSON
                parsedCall = JSON.parse(repairedJson)
                // console.log(
                //   `[parseFunctionCalls] JSON.parse successful after jsonrepair for match ${index}.`
                // ) // Log repair success
              } catch (repairError) {
                console.error(
                  `[parseFunctionCalls] Failed to parse content for match ${index} even with jsonrepair:`,
                  repairError,
                  'Original content:',
                  content,
                  'Repaired content attempt:',
                  repairedJson ?? 'N/A'
                ) // Log final failure
                return null // Skip this malformed call
              }
            }
            // console.log(`[parseFunctionCalls] Parsed object for match ${index}:`, parsedCall) // Log parsed object

            // Extract name and arguments, handling various potential structures
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
              // Attempt to find the function call structure if nested under a single key
              const keys = Object.keys(parsedCall)
              if (keys.length === 1) {
                const potentialToolCall = parsedCall[keys[0]]
                if (potentialToolCall && typeof potentialToolCall === 'object') {
                  if (potentialToolCall.name && potentialToolCall.arguments !== undefined) {
                    functionName = potentialToolCall.name
                    functionArgs = potentialToolCall.arguments
                  } else if (
                    potentialToolCall.function &&
                    typeof potentialToolCall.function === 'object' &&
                    potentialToolCall.function.name
                  ) {
                    functionName = potentialToolCall.function.name
                    functionArgs = potentialToolCall.function.arguments
                  }
                }
              }

              // If still not found, log an error
              if (!functionName) {
                console.error(
                  '[parseFunctionCalls] Could not determine function name from parsed call:',
                  parsedCall
                ) // Log name extraction failure
                return null
              }
            }
            // console.log(
            //   `[parseFunctionCalls] Extracted for match ${index}: Name='${functionName}', Args=`,
            //   functionArgs
            // ) // Log extracted name/args

            // Ensure arguments are stringified if they are not already
            if (typeof functionArgs !== 'string') {
              // console.log(
              //   `[parseFunctionCalls] Arguments for match ${index} are not a string, stringifying.`
              // ) // Log stringify attempt
              try {
                functionArgs = JSON.stringify(functionArgs)
              } catch (stringifyError) {
                console.error(
                  '[parseFunctionCalls] Failed to stringify function arguments:',
                  stringifyError,
                  functionArgs
                ) // Log stringify failure
                functionArgs = '{"error": "failed to stringify arguments"}'
              }
            }

            // Generate a unique ID if not provided in the parsed content
            const id =
              parsedCall.id ??
              (functionName
                ? `${functionName}-${index}-${Date.now()}`
                : `${fallbackIdPrefix}-${index}-${Date.now()}`)

            // console.log(
            //   `[parseFunctionCalls] Finalizing tool call for match ${index}: ID='${id}', Name='${functionName}', Args='${functionArgs}'`
            // ) // Log final object details

            return {
              id: String(id), // Ensure ID is string
              type: 'function', // Standardize type
              function: {
                name: String(functionName), // Ensure name is string
                arguments: functionArgs // Already ensured string
              }
            }
          } catch (processingError) {
            // Catch errors during the extraction/validation logic
            console.error(
              '[parseFunctionCalls] Error processing parsed function call JSON:',
              processingError,
              'Content:',
              content
            ) // Log processing error
            return null // Skip this call on error
          }
        })
        .filter(
          (
            call
          ): call is { id: string; type: string; function: { name: string; arguments: string } } => // Type guard ensures correct structure
            call !== null &&
            typeof call.id === 'string' &&
            typeof call.function === 'object' &&
            call.function !== null &&
            typeof call.function.name === 'string' &&
            typeof call.function.arguments === 'string'
        )
      console.log(`[parseFunctionCalls] Returning ${toolCalls.length} parsed tool calls.`) // Log final count
      return toolCalls
    } catch (error) {
      console.error(
        '[parseFunctionCalls] Unexpected error during execution:',
        error,
        'Input:',
        response
      ) // Log unexpected error
      return [] // Return empty array on unexpected errors
    }
  }

  // ... [check, summaryTitles, completions, summaries, generateText, suggestions remain unchanged] ...
  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      if (!this.isNoModelsApi) {
        // Use unified timeout configuration from base class
        const models = await this.fetchOpenAIModels({ timeout: this.getModelFetchTimeout() })
        this.models = models // Store fetched models
      }
      // Potentially add a simple API call test here if needed, e.g., list models even for no-API list to check key/endpoint
      return { isOk: true, errorMsg: null }
    } catch (error: unknown) {
      // Use unknown for type safety
      let errorMessage = 'An unknown error occurred during provider check.'
      if (error instanceof Error) {
        errorMessage = error.message
      } else if (typeof error === 'string') {
        errorMessage = error
      }
      // Optionally log the full error object for debugging
      console.error('OpenAICompatibleProvider check failed:', error)

      eventBus.sendToRenderer(NOTIFICATION_EVENTS.SHOW_ERROR, SendTarget.ALL_WINDOWS, {
        title: 'API Check Failed', // More specific title
        message: errorMessage,
        id: `openai-check-error-${Date.now()}`,
        type: 'error'
      })
      return { isOk: false, errorMsg: errorMessage }
    }
  }
  public async summaryTitles(messages: ChatMessage[], modelId: string): Promise<string> {
    const summaryText = `${SUMMARY_TITLES_PROMPT}\n\n${messages.map((m) => `${m.role}: ${m.content}`).join('\n')}`
    const fullMessage: ChatMessage[] = [{ role: 'user', content: summaryText }]
    const response = await this.openAICompletion(fullMessage, modelId, 0.5)
    return response.content.replace(/["']/g, '').trim()
  }
  async completions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    // Simple completion, no specific system prompt needed unless required by base class or future design
    return this.openAICompletion(messages, modelId, temperature, maxTokens)
  }
  async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    const systemPrompt = `Summarize the following text concisely:`
    // Create messages based on the input text
    const requestMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text } // Use the input text directly
    ]
    return this.openAICompletion(requestMessages, modelId, temperature, maxTokens)
  }
  async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    // Use the prompt directly as the user message content
    const requestMessages: ChatMessage[] = [{ role: 'user', content: prompt }]
    // Note: formatMessages might not be needed here if it's just a single prompt string,
    // but keeping it for consistency in case formatMessages adds system prompts or other logic.
    return this.openAICompletion(requestMessages, modelId, temperature, maxTokens)
  }
  async suggestions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string[]> {
    const systemPrompt = `Based on the last user message in the conversation history, provide 3 brief, relevant follow-up suggestions or questions. Output ONLY the suggestions, each on a new line. Do not include numbering, bullet points, or introductory text like "Here are some suggestions:".`
    const lastUserMessage = messages.filter((m) => m.role === 'user').pop() // Get the most recent user message

    if (!lastUserMessage) {
      console.warn('suggestions called without user messages.')
      return [] // Return empty array if no user message found
    }

    // Provide some context if possible, e.g., last few messages
    const contextMessages = messages.slice(-5) // Last 5 messages as context

    const requestMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      // Include context leading up to the last user message
      ...contextMessages
    ]

    try {
      const response = await this.openAICompletion(
        requestMessages,
        modelId,
        temperature ?? 0.7,
        maxTokens ?? 60
      ) // Adjusted temp/tokens
      // Split, trim, and filter results robustly
      return response.content
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.match(/^[0-9.\-*\s]*/)) // Fixed regex range
    } catch (error) {
      console.error('Failed to get suggestions:', error)
      return [] // Return empty on error
    }
  }

  async getEmbeddings(modelId: string, texts: string[]): Promise<number[][]> {
    if (!this.isInitialized) throw new Error('Provider not initialized')
    if (!modelId) throw new Error('Model ID is required')
    // OpenAI embeddings API
    const response = await this.openai.embeddings.create({
      model: modelId,
      input: texts,
      encoding_format: 'float'
    })
    // 兼容 OpenAI 返回格式
    return response.data.map((item) => item.embedding)
  }

  async getDimensions(modelId: string): Promise<LLM_EMBEDDING_ATTRS> {
    switch (modelId) {
      case 'text-embedding-3-small':
      case 'text-embedding-ada-002':
        return {
          dimensions: 1536,
          normalized: true
        }
      case 'text-embedding-3-large':
        return {
          dimensions: 3072,
          normalized: true
        }
      default:
        try {
          const embeddings = await this.getEmbeddings(modelId, [EMBEDDING_TEST_KEY])
          return {
            dimensions: embeddings[0].length,
            normalized: isNormalized(embeddings[0])
          }
        } catch (error) {
          console.error(
            `[OpenAICompatibleProvider] Failed to get dimensions for model ${modelId}:`,
            error
          )
          // Return sensible defaults or rethrow
          throw new Error(
            `Unable to determine embedding dimensions for model ${modelId}: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        }
    }
  }
}
