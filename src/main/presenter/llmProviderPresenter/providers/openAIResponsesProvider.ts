import {
  LLM_PROVIDER,
  LLMResponse,
  MODEL_META,
  MCPToolDefinition,
  LLMCoreStreamEvent,
  ModelConfig,
  ChatMessage,
  IConfigPresenter
} from '@shared/presenter'
import { createStreamEvent } from '@shared/types/core/llm-events'
import { BaseLLMProvider, SUMMARY_TITLES_PROMPT } from '../baseProvider'
import OpenAI, { AzureOpenAI } from 'openai'
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

// 添加支持的图片尺寸常量
const SUPPORTED_IMAGE_SIZES = {
  SQUARE: '1024x1024',
  LANDSCAPE: '1536x1024',
  PORTRAIT: '1024x1536'
} as const

// 添加可设置尺寸的模型列表
const SIZE_CONFIGURABLE_MODELS = ['gpt-image-1', 'gpt-4o-image', 'gpt-4o-all']

export class OpenAIResponsesProvider extends BaseLLMProvider {
  protected openai!: OpenAI
  private isNoModelsApi: boolean = false
  // 添加不支持 OpenAI 标准接口的供应商黑名单
  private static readonly NO_MODELS_API_LIST: string[] = []

  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
    this.createOpenAIClient()
    if (OpenAIResponsesProvider.NO_MODELS_API_LIST.includes(this.provider.id.toLowerCase())) {
      this.isNoModelsApi = true
    }
    this.init()
  }

  private createOpenAIClient(): void {
    // Get proxy configuration
    const proxyUrl = proxyConfig.getProxyUrl()
    const fetchOptions: { dispatcher?: ProxyAgent } = {}

    if (proxyUrl) {
      console.log(`[OpenAI Responses Provider] Using proxy: ${proxyUrl}`)
      const proxyAgent = new ProxyAgent(proxyUrl)
      fetchOptions.dispatcher = proxyAgent
    }

    if (this.provider.id === 'azure-openai') {
      try {
        const apiVersion = this.configPresenter.getSetting<string>('azureApiVersion')
        this.openai = new AzureOpenAI({
          apiKey: this.provider.apiKey,
          baseURL: this.provider.baseUrl,
          apiVersion: apiVersion || '2024-02-01',
          defaultHeaders: {
            ...this.defaultHeaders
          },
          fetchOptions
        })
      } catch (e) {
        console.warn('create azure openai failed', e)
      }
    } else {
      this.openai = new OpenAI({
        apiKey: this.provider.apiKey,
        baseURL: this.provider.baseUrl,
        defaultHeaders: {
          ...this.defaultHeaders
        },
        fetchOptions
      })
    }
  }

  public onProxyResolved(): void {
    this.createOpenAIClient()
  }

  // 实现BaseLLMProvider中的抽象方法fetchProviderModels
  protected async fetchProviderModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    // 检查供应商是否在黑名单中
    if (this.isNoModelsApi) {
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
  protected formatMessages(messages: ChatMessage[]): OpenAI.Responses.ResponseInput {
    const result: OpenAI.Responses.ResponseInput = []

    for (const msg of messages) {
      if (msg.role === 'tool') {
        result.push({
          type: 'function_call_output',
          call_id: msg.tool_call_id || '',
          output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        })
        continue
      }

      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const toolCall of msg.tool_calls) {
          result.push({
            type: 'function_call',
            call_id: toolCall.id,
            name: toolCall.function.name,
            arguments: toolCall.function.arguments
          })
        }
        continue
      }

      const content: OpenAI.Responses.ResponseInputMessageContentList = []

      if (msg.content !== undefined) {
        if (typeof msg.content === 'string') {
          content.push({
            //@ts-ignore api 和 sdk 定义不同
            type: msg.role === 'assistant' ? 'output_text' : 'input_text',
            text: msg.content
          })
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'text' && part.text) {
              content.push({
                //@ts-ignore api 和 sdk 定义不同
                type: msg.role === 'assistant' ? 'output_text' : 'input_text',
                text: part.text
              })
            }
            if (part.type === 'image_url' && part.image_url?.url) {
              content.push({
                type: 'input_image',
                image_url: part.image_url.url,
                detail: 'auto'
              })
            }
          }
        }
      }

      result.push({
        role: msg.role as 'system' | 'user' | 'assistant',
        content
      })
    }

    return result
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

    const formattedMessages = this.formatMessages(messages)
    const requestParams: OpenAI.Responses.ResponseCreateParams = {
      model: modelId,
      input: formattedMessages,
      temperature: temperature,
      max_output_tokens: maxTokens,
      stream: false
    }

    const modelConfig = this.configPresenter.getModelConfig(modelId, this.provider.id)
    if (modelConfig.reasoningEffort) {
      ;(requestParams as any).reasoning = {
        effort: modelConfig.reasoningEffort
      }
    }

    // verbosity 仅支持 GPT-5 系列模型
    if (modelId.includes('gpt-5') && modelConfig.verbosity) {
      ;(requestParams as any).text = {
        verbosity: modelConfig.verbosity
      }
    }

    OPENAI_REASONING_MODELS.forEach((noTempId) => {
      if (modelId.startsWith(noTempId)) {
        delete requestParams.temperature
      }
    })

    const response = await this.openai.responses.create(requestParams)
    const resultResp: LLMResponse = {
      content: ''
    }

    if (response.status === 'completed' && response.output.length > 0) {
      const message = response.output[0]
      if (message.type === 'message' && message.content) {
        const textContent = message.content.find((content) => content.type === 'output_text')
        if (textContent && 'text' in textContent) {
          resultResp.content = textContent.text
        }
      }
    }

    // 处理 reasoning 内容
    if (response.reasoning?.summary) {
      resultResp.reasoning_content = response.reasoning.summary
    }

    return resultResp
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
            // 直接使用 devicePresenter 缓存 base64 数据
            imageUrl = await presenter.devicePresenter.cacheImage(
              base64Data.startsWith('data:image/png;base64,')
                ? base64Data
                : 'data:image/png;base64,' + base64Data
            )
          } else {
            // 原有的 URL 处理逻辑
            imageUrl = result.data[0]?.url || ''
          }

          const cachedUrl = await presenter.devicePresenter.cacheImage(imageUrl)

          // 返回缓存后的URL
          yield createStreamEvent.imageData({
            data: cachedUrl,
            mimeType: 'deepchat/image-url'
          })

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
            '[handleImgGeneration] Failed to cache image, using original URL:',
            cacheError
          )
          yield createStreamEvent.imageData({
            data: result.data[0]?.url || result.data[0]?.b64_json || '',
            mimeType: 'deepchat/image-url'
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
   * 处理 OpenAI Responses 聊天补全模型请求的内部方法。
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
    const tools = mcpTools || []
    const supportsFunctionCall = modelConfig?.functionCall || false
    let processedMessages = this.formatMessages(messages)
    if (tools.length > 0 && !supportsFunctionCall) {
      processedMessages = this.prepareFunctionCallPrompt(processedMessages, tools)
    }
    const apiTools =
      tools.length > 0 && supportsFunctionCall
        ? await presenter.mcpPresenter.mcpToolsToOpenAIResponsesTools(tools, this.provider.id)
        : undefined

    const requestParams: OpenAI.Responses.ResponseCreateParams = {
      model: modelId,
      input: processedMessages,
      temperature,
      max_output_tokens: maxTokens,
      stream: true
    }

    // 如果模型支持函数调用且有工具,添加 tools 参数
    if (tools.length > 0 && supportsFunctionCall && apiTools) {
      requestParams.tools = apiTools
    }
    if (modelConfig.reasoningEffort) {
      ;(requestParams as any).reasoning = {
        effort: modelConfig.reasoningEffort
      }
    }

    // verbosity 仅支持 GPT-5 系列模型
    if (modelId.includes('gpt-5') && modelConfig.verbosity) {
      ;(requestParams as any).text = {
        verbosity: modelConfig.verbosity
      }
    }

    OPENAI_REASONING_MODELS.forEach((noTempId) => {
      if (modelId.startsWith(noTempId)) delete requestParams.temperature
    })

    const stream = await this.openai.responses.create(requestParams)

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
    const stopReason: LLMCoreStreamEvent['stop_reason'] = 'complete'
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
      // 处理函数调用相关事件
      if (supportsFunctionCall && tools.length > 0) {
        if (chunk.type === 'response.output_item.added') {
          const item = chunk.item
          if (item.type === 'function_call') {
            toolUseDetected = true
            const id = item.call_id
            if (id) {
              nativeToolCalls[id] = {
                name: item.name,
                arguments: item.arguments || '',
                completed: false
              }
              yield {
                type: 'tool_call_start',
                tool_call_id: id,
                tool_call_name: item.name
              }
            }
          }
        } else if (chunk.type === 'response.function_call_arguments.delta') {
          const itemId = chunk.item_id
          const delta = chunk.delta
          const toolCall = nativeToolCalls[itemId]
          if (toolCall) {
            toolCall.arguments += delta
            yield {
              type: 'tool_call_chunk',
              tool_call_id: itemId,
              tool_call_arguments_chunk: delta
            }
          }
        } else if (chunk.type === 'response.function_call_arguments.done') {
          const itemId = chunk.item_id
          const argsData = chunk.arguments
          const toolCall = nativeToolCalls[itemId]
          if (toolCall) {
            toolCall.arguments = argsData
            toolCall.completed = true
            yield {
              type: 'tool_call_end',
              tool_call_id: itemId,
              tool_call_arguments_complete: argsData
            }
          }
        } else if (chunk.type === 'response.output_item.done') {
          const item = chunk.item
          if (item.type === 'function_call') {
            const toolCall = nativeToolCalls[item.call_id]
            if (toolCall && !toolCall.completed) {
              toolCall.completed = true
              yield {
                type: 'tool_call_end',
                tool_call_id: item.call_id,
                tool_call_arguments_complete: item.arguments
              }
            }
          }
        }
      }

      // 处理文本增量
      if (chunk.type === 'response.output_text.delta') {
        const content = chunk.delta
        for (const char of content) {
          pendingBuffer += char
          let processedChar = false

          // --- Thinking Tag Processing (Inside or End states) ---
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
                  `[handleChatCompletion] Non-native <function_call> end tag detected. Buffer to parse:`,
                  funcCallBuffer
                )
                const parsedCalls = this.parseFunctionCalls(
                  `${funcStartMarker}${funcCallBuffer}${funcEndMarker}`
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
                  `[handleChatCompletion] Non-native <function_call> end tag detected (from end state). Buffer to parse:`,
                  funcCallBuffer
                )
                const parsedCalls = this.parseFunctionCalls(
                  `${funcStartMarker}${funcCallBuffer}${funcEndMarker}`
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
                yield createStreamEvent.text(textBefore)
              }
              console.log(
                '[handleChatCompletion] <think> start tag matched. Entering inside state.'
              )
              thinkState = 'inside'
              funcState = 'none' // Reset other state
              pendingBuffer = ''
            } else if (matchedFunc) {
              const textBefore = pendingBuffer.slice(0, -funcStartMarker.length)
              if (textBefore) {
                yield createStreamEvent.text(textBefore)
              }
              console.log(
                '[handleChatCompletion] Non-native <function_call> start tag detected. Entering inside state.'
              )
              funcState = 'inside'
              thinkState = 'none' // Reset other state
              pendingBuffer = ''
            }
            // --- Handle Partial Matches (Keep Accumulating) ---
            else if (potentialThink || potentialFunc) {
              // If potentially matching either, just keep the buffer and wait for more chars
              // Update state but don't yield anything
              thinkState = potentialThink ? 'start' : 'none'
              funcState = potentialFunc ? 'start' : 'none'
            }
            // --- Handle No Match / Failure ---
            else if (pendingBuffer.length > 0) {
              // Buffer doesn't start with '<', or starts with '<' but doesn't match start of either tag anymore
              const charToYield = pendingBuffer[0]
              yield createStreamEvent.text(charToYield)
              pendingBuffer = pendingBuffer.slice(1)
              // Re-evaluate potential matches with the shortened buffer immediately
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
        }
      }

      if (chunk.type === 'response.completed') {
        const response = chunk.response
        if (response.usage) {
          usage = {
            prompt_tokens: response.usage.input_tokens || 0,
            completion_tokens: response.usage.output_tokens || 0,
            total_tokens: response.usage.total_tokens || 0
          }
          yield createStreamEvent.usage(usage)
        }

        if (response.reasoning?.summary) {
          yield createStreamEvent.reasoning(response.reasoning.summary)
        }

        yield createStreamEvent.stop(toolUseDetected ? 'tool_use' : stopReason)
        return
      }

      if ('error' in chunk) {
        const errorChunk = chunk as { error: { message?: string } }
        yield createStreamEvent.error(errorChunk.error?.message || 'Unknown error occurred')
        yield createStreamEvent.stop('error')
        return
      }
    }

    // --- Finalization ---
    // Yield any remaining text in the buffer
    if (pendingBuffer) {
      console.warn('[handleChatCompletion] Finalizing with non-empty pendingBuffer:', pendingBuffer)
      // Decide how to yield based on final state
      if (thinkState === 'inside' || thinkState === 'end') {
        yield createStreamEvent.reasoning(pendingBuffer)
        thinkBuffer += pendingBuffer
      } else if (funcState === 'inside' || funcState === 'end') {
        // Add remaining to func buffer - it will be handled below
        funcCallBuffer += pendingBuffer
      } else {
        yield createStreamEvent.text(pendingBuffer)
      }
      pendingBuffer = ''
    }

    // Yield remaining reasoning content
    if (thinkBuffer) {
      console.warn(
        '[handleChatCompletion] Finalizing with non-empty thinkBuffer (should have been yielded):',
        thinkBuffer
      )
    }

    // Handle incomplete non-native function call
    if (funcCallBuffer) {
      console.warn(
        '[handleChatCompletion] Finalizing with non-empty function call buffer (likely incomplete tag):',
        funcCallBuffer
      )
      // Attempt to parse what we have, might fail
      const potentialContent = `${funcStartMarker}${funcCallBuffer}`
      try {
        const parsedCalls = this.parseFunctionCalls(potentialContent)
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
          console.log(
            '[handleChatCompletion] Incomplete function call buffer parsing yielded no calls. Emitting as text.'
          )
          yield createStreamEvent.text(potentialContent)
        }
      } catch (e) {
        console.error('[handleChatCompletion] Error parsing incomplete function call buffer:', e)
        yield createStreamEvent.text(potentialContent)
      }
      funcCallBuffer = ''
    }
  }

  private prepareFunctionCallPrompt(
    messages: OpenAI.Responses.ResponseInput,
    mcpTools: MCPToolDefinition[]
  ): OpenAI.Responses.ResponseInput {
    console.log('prepareFunc')
    // 创建消息副本而不是直接修改原始消息
    const result = [...messages]

    const functionCallPrompt = this.getFunctionCallWrapPrompt(mcpTools)

    // 找到最后一条用户消息
    const lastUserMessageIndex = result.findLastIndex(
      (message) => 'role' in message && message.role === 'user'
    )

    if (lastUserMessageIndex !== -1) {
      const userMessage = result[lastUserMessageIndex]
      if ('content' in userMessage) {
        if (Array.isArray(userMessage.content)) {
          // 创建新的 content 数组
          const newContent: OpenAI.Responses.ResponseInputMessageContentList = []
          let hasAddedPrompt = false

          // 遍历现有的 content 数组
          for (const content of userMessage.content) {
            if (content.type === 'input_text' && !hasAddedPrompt) {
              // 为第一个文本内容添加提示词
              newContent.push({
                type: 'input_text',
                text: `${functionCallPrompt}\n\n${content.text}`
              } as OpenAI.Responses.ResponseInputText)
              hasAddedPrompt = true
            } else if (content.type === 'input_text' || content.type === 'input_image') {
              // 其他内容直接复制
              newContent.push(content as OpenAI.Responses.ResponseInputContent)
            }
          }

          // 如果没有找到文本内容，在开头添加提示词
          if (!hasAddedPrompt) {
            newContent.unshift({
              type: 'input_text',
              text: functionCallPrompt
            } as OpenAI.Responses.ResponseInputText)
          }

          // 更新消息的 content
          result[lastUserMessageIndex] = {
            ...userMessage,
            content: newContent
          } as OpenAI.Responses.ResponseInput[number]
        } else if (typeof userMessage.content === 'string') {
          // 如果 content 是字符串，直接添加提示词
          result[lastUserMessageIndex] = {
            ...userMessage,
            content: [
              {
                type: 'input_text',
                text: `${functionCallPrompt}\n\n${userMessage.content}`
              } as OpenAI.Responses.ResponseInputText
            ]
          } as OpenAI.Responses.ResponseInput[number]
        }
      }
    }

    return result
  }

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
      console.error('OpenAIResponsesProvider check failed:', error)

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

  protected parseFunctionCalls(
    response: string,
    fallbackIdPrefix: string = 'tool-call'
  ): Array<{ id: string; type: string; function: { name: string; arguments: string } }> {
    try {
      // 使用非贪婪模式匹配function_call标签对，能够处理多行内容
      const functionCallMatches = response.match(/<function_call>([\s\S]*?)<\/function_call>/gs)
      if (!functionCallMatches) {
        return []
      }

      const toolCalls = functionCallMatches
        .map((match, index) => {
          const content = match.replace(/<\/?function_call>/g, '').trim()
          if (!content) {
            return null // Skip empty content between tags
          }

          try {
            let parsedCall
            let repairedJson: string | undefined
            try {
              // 首先尝试标准 JSON 解析
              parsedCall = JSON.parse(content)
            } catch {
              try {
                // 如果标准解析失败，使用 jsonrepair 进行修复
                repairedJson = jsonrepair(content)
                parsedCall = JSON.parse(repairedJson)
              } catch (repairError) {
                console.error(
                  `[parseFunctionCalls] Failed to parse content for match ${index} even with jsonrepair:`,
                  repairError,
                  'Original content:',
                  content,
                  'Repaired content attempt:',
                  repairedJson ?? 'N/A'
                )
                return null // Skip this malformed call
              }
            }

            // 提取名称和参数，处理各种可能的结构
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
              // 尝试在单个键下查找函数调用结构
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

              if (!functionName) {
                console.error(
                  '[parseFunctionCalls] Could not determine function name from parsed call:',
                  parsedCall
                )
                return null
              }
            }

            // 确保参数是字符串格式
            if (typeof functionArgs !== 'string') {
              try {
                functionArgs = JSON.stringify(functionArgs)
              } catch (stringifyError) {
                console.error(
                  '[parseFunctionCalls] Failed to stringify function arguments:',
                  stringifyError,
                  functionArgs
                )
                functionArgs = '{"error": "failed to stringify arguments"}'
              }
            }

            // 生成唯一ID
            const id = parsedCall.id || functionName || `${fallbackIdPrefix}-${index}-${Date.now()}`

            return {
              id: String(id),
              type: 'function',
              function: {
                name: String(functionName),
                arguments: functionArgs
              }
            }
          } catch (processingError) {
            console.error(
              '[parseFunctionCalls] Error processing parsed function call JSON:',
              processingError,
              'Content:',
              content
            )
            return null
          }
        })
        .filter(
          (
            call
          ): call is { id: string; type: string; function: { name: string; arguments: string } } =>
            call !== null &&
            typeof call.id === 'string' &&
            typeof call.function === 'object' &&
            call.function !== null &&
            typeof call.function.name === 'string' &&
            typeof call.function.arguments === 'string'
        )

      return toolCalls
    } catch (error) {
      console.error(
        '[parseFunctionCalls] Unexpected error during execution:',
        error,
        'Input:',
        response
      )
      return []
    }
  }
}
