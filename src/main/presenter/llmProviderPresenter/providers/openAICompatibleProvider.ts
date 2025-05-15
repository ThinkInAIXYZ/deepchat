import {
  LLM_PROVIDER,
  LLMResponse,
  MODEL_META,
  MCPToolDefinition,
  LLMCoreStreamEvent,
  ModelConfig,
  ChatMessage
} from '@shared/presenter'
import { BaseLLMProvider } from '../baseProvider'
import OpenAI, { AzureOpenAI } from 'openai'
import {
  ChatCompletionAssistantMessageParam,
  ChatCompletionContentPart,
  ChatCompletionContentPartText,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam
} from 'openai/resources'
import { ConfigPresenter } from '../../configPresenter'
import { proxyConfig } from '../../proxyConfig'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { presenter } from '@/presenter'
import { eventBus } from '@/eventbus'
import { NOTIFICATION_EVENTS } from '@/events'
import { jsonrepair } from 'jsonrepair'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'

const OPENAI_REASONING_MODELS = ['o3-mini', 'o3-preview', 'o1-mini', 'o1-pro', 'o1-preview', 'o1']
const OPENAI_IMAGE_GENERATION_MODELS = [
  'gpt-4o-all',
  'gpt-4o-image',
  'gpt-image-1',
  'dall-e-3',
  'dall-e-2'
]

// 添加支持的图片尺寸常量
const SUPPORTED_IMAGE_SIZES = {
  SQUARE: '1024x1024',
  LANDSCAPE: '1536x1024',
  PORTRAIT: '1024x1536'
} as const

// 添加可设置尺寸的模型列表
const SIZE_CONFIGURABLE_MODELS = ['gpt-image-1', 'gpt-4o-image', 'gpt-4o-all']

export class OpenAICompatibleProvider extends BaseLLMProvider {
  protected openai!: OpenAI
  private isNoModelsApi: boolean = false
  // 添加不支持 OpenAI 标准接口的供应商黑名单
  private static readonly NO_MODELS_API_LIST: string[] = []

  constructor(provider: LLM_PROVIDER, configPresenter: ConfigPresenter) {
    super(provider, configPresenter)
    const proxyUrl = proxyConfig.getProxyUrl()
    if (provider.id === 'azure-openai') {
      try {
        const apiVersion = this.configPresenter.getSetting<string>('azureApiVersion')
        this.openai = new AzureOpenAI({
          apiKey: this.provider.apiKey,
          baseURL: this.provider.baseUrl,
          apiVersion: apiVersion || '2024-02-01',
          httpAgent: proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined,
          defaultHeaders: {
            ...this.defaultHeaders
          }
        })
      } catch (e) {
        console.warn('create azue openai failed', e)
      }
    } else {
      this.openai = new OpenAI({
        apiKey: this.provider.apiKey,
        baseURL: this.provider.baseUrl,
        httpAgent: proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined,
        defaultHeaders: {
          ...this.defaultHeaders
        }
      })
    }
    if (OpenAICompatibleProvider.NO_MODELS_API_LIST.includes(this.provider.id.toLowerCase())) {
      this.isNoModelsApi = true
    }
    this.init()
  }

  public onProxyResolved(): void {
    const proxyUrl = proxyConfig.getProxyUrl()
    this.openai = new OpenAI({
      apiKey: this.provider.apiKey,
      baseURL: this.provider.baseUrl,
      httpAgent: proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined
    })
  }

  // 实现BaseLLMProvider中的抽象方法fetchProviderModels
  protected async fetchProviderModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    // 检查供应商是否在黑名单中
    if (this.isNoModelsApi) {
      // console.log(`Provider ${this.provider.name} does not support OpenAI models API`)
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

  /**
   * User消息，上层会根据是否存在 vision 去插入 image_url
   * Ass 消息，需要判断一下，把图片转换成正确的上下文，因为模型可以切换
   * @param messages
   * @returns
   */
  protected formatMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
    return messages.map((msg) => {
      // 处理基本消息结构
      const baseMessage: Partial<ChatCompletionMessageParam> = {
        role: msg.role as 'system' | 'user' | 'assistant' | 'tool'
      }

      // 处理content转换为字符串
      if (msg.content !== undefined && msg.role !== 'user') {
        if (typeof msg.content === 'string') {
          baseMessage.content = msg.content
        } else if (Array.isArray(msg.content)) {
          // 处理多模态内容数组
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
    const requestParams: OpenAI.Chat.ChatCompletionCreateParams = {
      messages: this.formatMessages(messages),
      model: modelId,
      stream: false,
      temperature: temperature,
      max_tokens: maxTokens
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

  // [NEW] Core stream method implementation based on character processing
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
    // console.log('messages', JSON.stringify(messages))
    // --- [NEW] Handle Image Generation Models ---
    if (OPENAI_IMAGE_GENERATION_MODELS.includes(modelId)) {
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
        console.error('[coreStream] Could not extract prompt for image generation.')
        yield { type: 'error', error_message: 'Could not extract prompt for image generation.' }
        yield { type: 'stop', stop_reason: 'error' }
        return
      }

      try {
        let result

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
              console.warn('Failed to detect image dimensions, using default size:', error)
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
            console.error('Failed to delete temporary file:', e)
          }
        } else {
          // 使用原来的 images.generate 接口处理没有图片的请求
          console.log(`[coreStream] Generating image with model ${modelId} and prompt: "${prompt}"`)
          const params: OpenAI.Images.ImageGenerateParams = {
            model: modelId,
            prompt: prompt,
            n: 1,
            output_format: 'png'
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
            let imageUrl: string
            if (result.data[0]?.b64_json) {
              // 处理 base64 数据
              const base64Data = result.data[0].b64_json
              // 创建临时文件
              const tempImagePath = path.join(
                app.getPath('userData'),
                'images',
                `temp_${Date.now()}.png`
              )
              // 将 base64 数据写入文件
              const imageBuffer = Buffer.from(base64Data, 'base64')
              fs.writeFileSync(tempImagePath, imageBuffer)
              // 使用 imgcache:// 协议
              imageUrl = `imgcache://${path.basename(tempImagePath)}`
            } else {
              // 原有的 URL 处理逻辑
              imageUrl = result.data[0]?.url
            }

            const cachedUrl = await presenter.devicePresenter.cacheImage(imageUrl)

            // 返回缓存后的URL
            yield {
              type: 'image_data',
              image_data: {
                data: cachedUrl,
                mimeType: 'deepchat/image-url'
              }
            }

            // 处理 usage 信息
            if (result.usage) {
              yield {
                type: 'usage',
                usage: {
                  prompt_tokens: result.usage.input_tokens || 0,
                  completion_tokens: result.usage.output_tokens || 0,
                  total_tokens: result.usage.total_tokens || 0
                }
              }
            }

            yield { type: 'stop', stop_reason: 'complete' }
          } catch (cacheError) {
            // 缓存失败时降级为使用原始URL
            console.warn('[coreStream] Failed to cache image, using original URL:', cacheError)
            yield {
              type: 'image_data',
              image_data: {
                data: result.data[0]?.url || result.data[0]?.b64_json,
                mimeType: 'deepchat/image-url'
              }
            }
            yield { type: 'stop', stop_reason: 'complete' }
          }
        } else {
          console.error('[coreStream] No image data received from API.', result)
          yield { type: 'error', error_message: 'No image data received from API.' }
          yield { type: 'stop', stop_reason: 'error' }
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('[coreStream] Error during image generation:', errorMessage)
        yield { type: 'error', error_message: `Image generation failed: ${errorMessage}` }
        yield { type: 'stop', stop_reason: 'error' }
      }
      return // Stop execution here for image models
    }
    // --- End Image Generation Handling ---

    const tools = mcpTools || []
    const supportsFunctionCall = modelConfig?.functionCall || false
    let processedMessages = [...this.formatMessages(messages)] as ChatCompletionMessageParam[]
    if (tools.length > 0 && !supportsFunctionCall) {
      processedMessages = this.prepareFunctionCallPrompt(processedMessages, tools)
    }
    const apiTools =
      tools.length > 0 && supportsFunctionCall
        ? await presenter.mcpPresenter.mcpToolsToOpenAITools(tools, this.provider.id)
        : undefined
    const requestParams: OpenAI.Chat.ChatCompletionCreateParams = {
      messages: processedMessages,
      model: modelId,
      stream: true,
      temperature,
      max_tokens: maxTokens
    }

    // 添加stream_options，适用于/v1/chat/completions
    // 诸如qwen等模型需要，如不添加则无法获取token usages
    requestParams.stream_options = { include_usage: true }  

    OPENAI_REASONING_MODELS.forEach((noTempId) => {
      if (modelId.startsWith(noTempId)) delete requestParams.temperature
    })
    if (apiTools && apiTools.length > 0 && supportsFunctionCall) requestParams.tools = apiTools

    const stream = await this.openai.chat.completions.create(requestParams)

    // --- State Variables ---
    type TagState = 'none' | 'start' | 'inside' | 'end'
    let thinkState: TagState = 'none'
    let funcState: TagState = 'none' // Only relevant if !supportsFunctionCall

    let pendingBuffer = '' // Buffer for tag matching and potential text output
    let thinkBuffer = '' // Buffer for reasoning content
    let funcCallBuffer = '' // Buffer for non-native function call content

    const thinkStartMarker = '<think>'
    const thinkEndMarker = '</think>'
    const funcStartMarker = '<function_call>'
    const funcEndMarker = '</function_call>'

    const nativeToolCalls: Record<
      string,
      { name: string; arguments: string; completed?: boolean }
    > = {}
    const indexToIdMap: Record<number, string> = {}
    let stopReason: LLMCoreStreamEvent['stop_reason'] = 'complete'
    let toolUseDetected = false
    let usage:
      | {
          prompt_tokens: number
          completion_tokens: number
          total_tokens: number
        }
      | undefined = undefined
    // --- Stream Processing Loop ---
    for await (const chunk of stream) {
      // console.log('chunk', JSON.stringify(chunk))
      const choice = chunk.choices[0]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delta = choice?.delta as any
      const currentContent = delta?.content || ''

      // 1. Handle Non-Content Events First
      if (chunk.usage) {
        usage = chunk.usage
      }
      if (delta?.reasoning_content || delta?.reasoning) {
        // Yield native reasoning content directly
        yield { type: 'reasoning', reasoning_content: delta.reasoning_content || delta.reasoning }
        continue
      }
      if (supportsFunctionCall && delta?.tool_calls?.length > 0) {
        toolUseDetected = true
        // console.log('Handling native tool_calls', JSON.stringify(delta.tool_calls))
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
              '[coreStream] Received tool call delta chunk without id/mapping:',
              toolCallDelta
            )
            continue
          }

          if (currentToolCallId) {
            if (!nativeToolCalls[currentToolCallId]) {
              nativeToolCalls[currentToolCallId] = { name: '', arguments: '', completed: false }
              // console.log(`[coreStream] Initialized nativeToolCalls entry for id ${currentToolCallId}`)
            }

            const currentCallState = nativeToolCalls[currentToolCallId]

            // Handle complete tool call in one chunk
            if (functionName && argumentChunk && !currentCallState.completed) {
              // console.log(`[coreStream] Handling complete tool call ${currentToolCallId} in one chunk.`)
              if (!currentCallState.name) {
                currentCallState.name = functionName
                yield {
                  type: 'tool_call_start',
                  tool_call_id: currentToolCallId,
                  tool_call_name: functionName
                }
              }
              currentCallState.arguments += argumentChunk
              yield {
                type: 'tool_call_chunk',
                tool_call_id: currentToolCallId,
                tool_call_arguments_chunk: argumentChunk
              }
              currentCallState.completed = true
              yield {
                type: 'tool_call_end',
                tool_call_id: currentToolCallId,
                tool_call_arguments_complete: currentCallState.arguments
              }
              continue
            }

            // Handle incremental updates
            // console.log(`[coreStream] Handling incremental update for ${currentToolCallId}.`)
            if (functionName && !currentCallState.name) {
              currentCallState.name = functionName
              yield {
                type: 'tool_call_start',
                tool_call_id: currentToolCallId,
                tool_call_name: functionName
              }
            }
            if (argumentChunk) {
              currentCallState.arguments += argumentChunk
              yield {
                type: 'tool_call_chunk',
                tool_call_id: currentToolCallId,
                tool_call_arguments_chunk: argumentChunk
              }
            }
          }
        }
        continue // Continue to next chunk after processing tool calls
      }
      if (choice?.finish_reason) {
        const reasonFromAPI = choice.finish_reason
        // console.log('Finish Reason from API:', reasonFromAPI)
        if (reasonFromAPI === 'tool_calls') {
          stopReason = 'tool_use'
          toolUseDetected = true
        } else if (toolUseDetected) {
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
          console.warn(`Unhandled finish reason: ${reasonFromAPI}`)
          stopReason = 'error'
        }
        continue // Process content within the same chunk if any
      }
      if (!currentContent) continue

      // 2. Process content character by character
      for (const char of currentContent) {
        pendingBuffer += char
        let processedChar = false // Flag if character was handled by state logic
        // console.log('currentStatus', pendingBuffer, thinkState, funcState, char)
        // --- State Machine Logic ---

        // --- Thinking Tag Processing (Inside or End states) ---
        if (thinkState === 'inside') {
          if (pendingBuffer.endsWith(thinkEndMarker)) {
            thinkState = 'none'
            if (thinkBuffer) {
              yield { type: 'reasoning', reasoning_content: thinkBuffer }
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
              yield { type: 'reasoning', reasoning_content: charsToYield }
            }
            pendingBuffer = pendingBuffer.slice(-thinkEndMarker.length + 1)
            if (thinkEndMarker.startsWith(pendingBuffer)) {
              thinkState = 'end'
            } else {
              thinkBuffer += pendingBuffer
              yield { type: 'reasoning', reasoning_content: pendingBuffer }
              pendingBuffer = ''
              thinkState = 'inside'
            }
            processedChar = true
          } else {
            thinkBuffer += char
            yield { type: 'reasoning', reasoning_content: char }
            pendingBuffer = ''
            processedChar = true
          }
        } else if (thinkState === 'end') {
          if (pendingBuffer.endsWith(thinkEndMarker)) {
            thinkState = 'none'
            if (thinkBuffer) {
              yield { type: 'reasoning', reasoning_content: thinkBuffer }
              thinkBuffer = ''
            }
            pendingBuffer = ''
            processedChar = true
          } else if (!thinkEndMarker.startsWith(pendingBuffer)) {
            const failedTagChars = pendingBuffer
            thinkBuffer += failedTagChars
            yield { type: 'reasoning', reasoning_content: failedTagChars }
            pendingBuffer = ''
            thinkState = 'inside'
            processedChar = true
          } else {
            processedChar = true
          }
        }
        // --- Function Call Tag Processing (Inside or End states, if applicable) ---
        else if (
          !supportsFunctionCall &&
          tools.length > 0 &&
          (funcState === 'inside' || funcState === 'end')
        ) {
          processedChar = true // Assume processed unless logic below changes state back
          if (funcState === 'inside') {
            if (pendingBuffer.endsWith(funcEndMarker)) {
              funcState = 'none'
              funcCallBuffer += pendingBuffer.slice(0, -funcEndMarker.length)
              pendingBuffer = ''
              toolUseDetected = true
              console.log(
                `[coreStream] Non-native <function_call> end tag detected. Buffer to parse:`,
                funcCallBuffer
              )
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
              console.log(
                `[coreStream] Non-native <function_call> end tag detected (from end state). Buffer to parse:`,
                funcCallBuffer
              )
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

        // --- General Text / Start Tag Detection (When not inside any tag) ---
        // This block handles thinkState/funcState being 'none' or 'start'
        if (!processedChar) {
          let potentialThink = thinkStartMarker.startsWith(pendingBuffer)
          let potentialFunc =
            !supportsFunctionCall && tools.length > 0 && funcStartMarker.startsWith(pendingBuffer)
          const matchedThink = pendingBuffer.endsWith(thinkStartMarker)
          const matchedFunc =
            !supportsFunctionCall && tools.length > 0 && pendingBuffer.endsWith(funcStartMarker)

          // --- Handle Full Matches First ---
          if (matchedThink) {
            const textBefore = pendingBuffer.slice(0, -thinkStartMarker.length)
            if (textBefore) {
              yield { type: 'text', content: textBefore }
            }
            console.log('[coreStream] <think> start tag matched. Entering inside state.')
            thinkState = 'inside'
            funcState = 'none' // Reset other state
            pendingBuffer = ''
            // Don't set processedChar = true, let loop continue naturally
          } else if (matchedFunc) {
            const textBefore = pendingBuffer.slice(0, -funcStartMarker.length)
            if (textBefore) {
              yield { type: 'text', content: textBefore }
            }
            console.log(
              '[coreStream] Non-native <function_call> start tag detected. Entering inside state.'
            )
            funcState = 'inside'
            thinkState = 'none' // Reset other state
            pendingBuffer = ''
            // Don't set processedChar = true, let loop continue naturally
          }
          // --- Handle Partial Matches (Keep Accumulating) ---
          else if (potentialThink || potentialFunc) {
            // If potentially matching either, just keep the buffer and wait for more chars
            // Update state but don't yield anything
            thinkState = potentialThink ? 'start' : 'none'
            funcState = potentialFunc ? 'start' : 'none'
            // Character processed by accumulating into buffer for potential tag match
            // processedChar = true; // No need to set this, we want loop to naturally continue adding chars
          }
          // --- Handle No Match / Failure ---
          else if (pendingBuffer.length > 0) {
            // Buffer doesn't start with '<', or starts with '<' but doesn't match start of either tag anymore
            const charToYield = pendingBuffer[0]
            yield { type: 'text', content: charToYield }
            pendingBuffer = pendingBuffer.slice(1)
            // Re-evaluate potential matches with the shortened buffer immediately
            potentialThink = pendingBuffer.length > 0 && thinkStartMarker.startsWith(pendingBuffer)
            potentialFunc =
              pendingBuffer.length > 0 &&
              !supportsFunctionCall &&
              tools.length > 0 &&
              funcStartMarker.startsWith(pendingBuffer)
            thinkState = potentialThink ? 'start' : 'none'
            funcState = potentialFunc ? 'start' : 'none'
            // Yielded a char, buffer changed, loop continues
          }
          // If pendingBuffer became empty after slice, states will be none, next char starts fresh.
        }

        // Note: Removed the separate logic blocks for thinkState === 'start' and funcState === 'start'
        // as their logic is now integrated into the block above.

        // --- Yield and Clear Pending Buffer (This was part of old logic, likely not needed now) ---
        // if (yieldBufferAs && pendingBuffer) { ... }
        // if (clearPendingBuffer) { pendingBuffer = ''; }
      } // End character loop
    } // End chunk loop

    // --- Finalization ---

    // Yield any remaining text in the buffer
    if (pendingBuffer) {
      console.warn('[coreStream] Finalizing with non-empty pendingBuffer:', pendingBuffer)
      // Decide how to yield based on final state
      if (thinkState === 'inside' || thinkState === 'end') {
        yield { type: 'reasoning', reasoning_content: pendingBuffer }
        thinkBuffer += pendingBuffer
      } else if (funcState === 'inside' || funcState === 'end') {
        // Add remaining to func buffer - it will be handled below
        funcCallBuffer += pendingBuffer
      } else {
        yield { type: 'text', content: pendingBuffer }
      }
      pendingBuffer = ''
    }

    // Yield remaining reasoning content
    if (thinkBuffer) {
      // console.log('[coreStream] Yielding remaining reasoning buffer:', thinkBuffer)
      // No yield here, reasoning is yielded char by char or on tag close
      console.warn(
        '[coreStream] Finalizing with non-empty thinkBuffer (should have been yielded):',
        thinkBuffer
      )
    }

    // Handle incomplete non-native function call
    if (funcCallBuffer) {
      console.warn(
        '[coreStream] Finalizing with non-empty function call buffer (likely incomplete tag):',
        funcCallBuffer // Log incomplete buffer
      )
      // Attempt to parse what we have, might fail
      const potentialContent = `${funcStartMarker}${funcCallBuffer}` // Assume tag started
      try {
        const parsedCalls = this.parseFunctionCalls(
          potentialContent, // Parse potentially incomplete content
          `non-native-incomplete-${this.provider.id}`
        )
        if (parsedCalls.length > 0) {
          toolUseDetected = true // Mark tool use even if incomplete parse
          for (const parsedCall of parsedCalls) {
            yield {
              type: 'tool_call_start',
              tool_call_id: parsedCall.id + '-incomplete', // Mark ID
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
              tool_call_arguments_complete: parsedCall.function.arguments // Send potentially partial args
            }
          }
        } else {
          console.log(
            '[coreStream] Incomplete function call buffer parsing yielded no calls. Emitting as text.'
          )
          // If parsing failed or yielded nothing, output buffer as text
          yield { type: 'text', content: potentialContent }
        }
      } catch (e) {
        console.error('Error parsing incomplete function call buffer:', e)
        yield { type: 'text', content: potentialContent } // Yield as text on error
      }
      funcCallBuffer = ''
    }

    // Final check and emission for native tool calls
    if (supportsFunctionCall && toolUseDetected) {
      // console.log('[coreStream] Stream finished. Finalizing native tool calls:', JSON.stringify(nativeToolCalls))
      for (const toolId in nativeToolCalls) {
        const tool = nativeToolCalls[toolId]
        // console.log(`[coreStream] Finalizing tool ${toolId}: Name='${tool.name}', Args='${tool.arguments}', Completed=${tool.completed}`)
        if (tool.name && tool.arguments && !tool.completed) {
          // console.log(`[coreStream] Sending tool_call_end for ${toolId} during finalization.`)
          try {
            JSON.parse(tool.arguments) // Check validity
            yield {
              type: 'tool_call_end',
              tool_call_id: toolId,
              tool_call_arguments_complete: tool.arguments
            }
          } catch (e) {
            console.error(
              `[coreStream] Error parsing arguments for tool ${toolId} during finalization: ${tool.arguments}`,
              e
            )
            yield {
              type: 'tool_call_end',
              tool_call_id: toolId,
              tool_call_arguments_complete: tool.arguments // Send as received
            }
          }
        } else if (!tool.completed) {
          console.warn(
            `[coreStream] Tool call ${toolId} is incomplete and will not have an end event during finalization. Name: ${tool.name}, Args: ${tool.arguments}`
          )
        }
      }
    }

    // Log state warnings
    if (thinkState !== 'none') console.warn(`Stream ended while in thinkState: ${thinkState}`)
    if (funcState !== 'none') console.warn(`Stream ended while in funcState: ${funcState}`)
    if (usage) {
      yield { type: 'usage', usage: usage }
    }
    // Override stop reason if tool use was detected
    const finalStopReason = toolUseDetected ? 'tool_use' : stopReason
    // console.log(`[coreStream] Final Stop Reason Calculation: toolUseDetected=${toolUseDetected}, apiStopReason=${stopReason}, finalStopReason=${finalStopReason}`)

    yield { type: 'stop', stop_reason: finalStopReason }
  }

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
              // console.warn(
              //   `[parseFunctionCalls] Standard JSON.parse failed for match ${index}, attempting jsonrepair. Error:`,
              //   (initialParseError as Error).message
              // ) // Log failure and attempt repair
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
            const id = parsedCall.id || functionName || `${fallbackIdPrefix}-${index}-${Date.now()}`
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
        // Use a reasonable timeout
        const models = await this.fetchOpenAIModels({ timeout: 5000 }) // Increased timeout slightly
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

      eventBus.emit(NOTIFICATION_EVENTS.SHOW_ERROR, {
        title: 'API Check Failed', // More specific title
        message: errorMessage,
        id: `openai-check-error-${Date.now()}`,
        type: 'error'
      })
      return { isOk: false, errorMsg: errorMessage }
    }
  }
  public async summaryTitles(messages: ChatMessage[], modelId: string): Promise<string> {
    const systemPrompt = `You need to summarize the user's conversation into a title of no more than 10 words, with the title language matching the user's primary language, without using punctuation or other special symbols`
    const fullMessage: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: messages.map((m) => `${m.role}: ${m.content}`).join('\n') }
    ]
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
}
