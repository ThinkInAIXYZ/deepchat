import {
  LLMResponse,
  MODEL_META,
  LLMCoreStreamEvent,
  ModelConfig,
  MCPToolDefinition,
  ChatMessage,
  AWS_BEDROCK_PROVIDER,
  IConfigPresenter
} from '@shared/presenter'
import { createStreamEvent } from '@shared/types/core/llm-events'
import { BaseLLMProvider, SUMMARY_TITLES_PROMPT } from '../baseProvider'
import { presenter } from '@/presenter'
import { BedrockClient, ListFoundationModelsCommand } from '@aws-sdk/client-bedrock'
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelCommandOutput,
  InvokeModelWithResponseStreamCommand
} from '@aws-sdk/client-bedrock-runtime'
import Anthropic from '@anthropic-ai/sdk'
import { Usage } from '@anthropic-ai/sdk/resources/messages'

export class AwsBedrockProvider extends BaseLLMProvider {
  private bedrock!: BedrockClient
  private bedrockRuntime!: BedrockRuntimeClient
  private defaultModel = 'anthropic.claude-3-5-sonnet-20240620-v1:0'

  constructor(provider: AWS_BEDROCK_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
    this.init()
  }

  public onProxyResolved(): void {
    this.init()
  }

  protected async init() {
    if (this.provider.enable) {
      try {
        const provider = this.provider as AWS_BEDROCK_PROVIDER
        const accessKeyId = provider.credential?.accessKeyId || process.env.BEDROCK_ACCESS_KEY_ID
        const secretAccessKey =
          provider.credential?.secretAccessKey || process.env.BEDROCK_SECRET_ACCESS_KEY
        const region = provider.credential?.region || process.env.BEDROCK_REGION

        if (!accessKeyId || !secretAccessKey || !region) {
          throw new Error('Access Key Id, Secret Access Key and Region are all needed.')
        }

        this.bedrock = new BedrockClient({
          credentials: { accessKeyId, secretAccessKey },
          region
        })

        this.bedrockRuntime = new BedrockRuntimeClient({
          credentials: { accessKeyId, secretAccessKey },
          region
        })

        await super.init()
      } catch (error) {
        console.error('Failed to initialize AWS Bedrock provider:', error)
      }
    }
  }

  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    try {
      const region = await this.bedrock.config.region()
      const command = new ListFoundationModelsCommand({})
      const response = await this.bedrock.send(command)
      const models = response.modelSummaries

      return (
        models
          ?.filter((m) => m.modelId && /^anthropic.claude-[a-z0-9-]+(:\d+)$/g.test(m.modelId))
          ?.filter((m) => m.modelLifecycle?.status === 'ACTIVE')
          ?.filter((m) => m.inferenceTypesSupported && m.inferenceTypesSupported.length > 0)
          .map<MODEL_META>((m) => ({
            id: `${m.inferenceTypesSupported?.includes('ON_DEMAND') ? m.modelId! : `${region.split('-')[0]}.${m.modelId}`}`,
            name: m.modelId?.replace('anthropic.', '') || '<Unknown>',
            providerId: this.provider.id,
            maxTokens: 64_000,
            group: `AWS Bedrock Claude - ${m.modelId?.includes('opus') ? 'opus' : m.modelId?.includes('sonnet') ? 'sonnet' : m.modelId?.includes('haiku') ? 'haiku' : 'other'}`,
            isCustom: false,
            contextLength: 200_000,
            vision: false,
            functionCall: false,
            reasoning: false
          })) || []
      )
    } catch (error) {
      console.error('获取AWS Bedrock Anthropic模型列表出错:', error)
    }

    // 如果API请求失败或返回数据解析失败，返回默认模型列表
    console.log('从API获取模型列表失败，使用默认模型配置')
    return [
      {
        id: 'anthropic.claude-sonnet-4-20250514-v1:0',
        name: 'AWS Bedrock Claude Sonnet 4',
        providerId: this.provider.id,
        maxTokens: 64_000,
        group: 'Bedrock Claude 4',
        isCustom: false,
        contextLength: 200000,
        vision: true,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'anthropic.claude-3-7-sonnet-20250219-v1:0',
        name: 'AWS Bedrock Claude 3.7 Sonnet',
        providerId: this.provider.id,
        maxTokens: 64_000,
        group: 'Bedrock Claude 3.7',
        isCustom: false,
        contextLength: 200000,
        vision: true,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        name: 'AWS Bedrock Claude 3.5 Sonnet',
        providerId: this.provider.id,
        maxTokens: 8192,
        group: 'Bedrock Claude 3.5',
        isCustom: false,
        contextLength: 200000,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        name: 'AWS Bedrock Claude 3.5 Sonnet (Legacy)',
        providerId: this.provider.id,
        maxTokens: 8192,
        group: 'Bedrock Claude 3.5',
        isCustom: false,
        contextLength: 200000,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'anthropic.claude-3-haiku-20240307-v1:0',
        name: 'AWS Bedrock Claude 3 Haiku',
        providerId: this.provider.id,
        maxTokens: 8192,
        group: 'Bedrock Claude 3',
        isCustom: false,
        contextLength: 200000,
        vision: true,
        functionCall: true,
        reasoning: false
      }
    ]
  }

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      if (!this.bedrockRuntime) {
        return { isOk: false, errorMsg: '未初始化 AWS Bedrock SDK' }
      }

      // 发送一个简单请求来检查 API 连接状态
      // Prepare the payload for the Messages API request.
      const payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hi' }]
          }
        ]
      }
      const command = new InvokeModelCommand({
        contentType: 'application/json',
        body: JSON.stringify(payload),
        modelId: this.defaultModel
      })
      const apiResponse = await this.bedrockRuntime.send(command)

      // Decode and return the response(s)
      const decodedResponseBody = new TextDecoder().decode(apiResponse.body)
      /** @type {MessagesResponseBody} */
      const responseBody = JSON.parse(decodedResponseBody)
      const responseText = responseBody.content[0].text

      return { isOk: responseText.length > 0, errorMsg: null }
    } catch (error: unknown) {
      console.error('AWS Bedrock Claude API check failed:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { isOk: false, errorMsg: `API 检查失败: ${errorMessage}` }
    }
  }

  // 依赖 generateText
  public async summaryTitles(messages: ChatMessage[], modelId: string): Promise<string> {
    const prompt = `${SUMMARY_TITLES_PROMPT}\n\n${messages.map((m) => `${m.role}: ${m.content}`).join('\n')}`
    const response = await this.generateText(prompt, modelId, 0.3, 50)

    return response.content.trim()
  }

  // 依赖 generateText
  async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number,
    systemPrompt?: string
  ): Promise<LLMResponse> {
    const prompt = `请对以下内容进行摘要:

${text}

请提供一个简洁明了的摘要。`

    return this.generateText(prompt, modelId, temperature, maxTokens, systemPrompt)
  }

  async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number,
    systemPrompt?: string
  ): Promise<LLMResponse> {
    try {
      const payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: prompt }]
          }
        ]
      }
      const command = new InvokeModelCommand({
        contentType: 'application/json',
        body: JSON.stringify(payload),
        modelId
      })

      const response = await this.bedrockRuntime.send(command)

      // Decode and return the response(s)
      const decodedResponseBody = new TextDecoder().decode(response.body)
      /** @type {MessagesResponseBody} */
      const responseBody = JSON.parse(decodedResponseBody)
      return { content: responseBody.content[0].text, reasoning_content: undefined }
    } catch (error) {
      console.error('AWS Bedrock generate text error:', error)
      throw error
    }
  }

  private formatMessages(messages: ChatMessage[]): {
    system?: string
    messages: Anthropic.MessageParam[]
  } {
    // console.log('开始格式化消息，总消息数:', messages.length)

    // 提取系统消息
    let systemContent = ''
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemContent +=
          (typeof msg.content === 'string'
            ? msg.content
            : msg.content && Array.isArray(msg.content)
              ? msg.content
                  .filter((c) => c.type === 'text')
                  .map((c) => c.text || '')
                  .join('\n')
              : '') + '\n'
      }
    }

    // 定义消息组和内容块的类型
    type ContentBlock = Anthropic.ContentBlockParam
    type ToolCall = { id: string; function: { name: string; arguments?: string } }
    type MessageGroup = {
      role: string
      contents: ContentBlock[]
      toolCalls?: string[]
      hasToolUse?: boolean
    }

    // 预处理：对消息进行分组
    // 新的逻辑：每个assistant消息如果包含tool_calls，就单独成组
    const messageGroups: MessageGroup[] = []
    let currentGroup: MessageGroup | null = null

    // 用于跟踪tool_calls和tool响应的匹配
    const toolResponseMap = new Map<string, ContentBlock>()

    // 第一阶段：建立初始分组和收集工具响应
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (msg.role === 'system') continue // 系统消息已处理

      // console.log(
      //   `处理第${i + 1}条消息, 角色:${msg.role}`,
      //   msg.content
      //     ? typeof msg.content === 'string'
      //       ? '内容长度:' + msg.content.length
      //       : '数组内容长度:' + (Array.isArray(msg.content) ? msg.content.length : 0)
      //     : '无内容'
      // )

      // 处理工具响应，将其与对应的工具调用关联
      if (msg.role === 'tool' && 'tool_call_id' in msg) {
        const toolCallId = msg.tool_call_id as string
        const responseContent =
          typeof msg.content === 'string'
            ? msg.content
            : Array.isArray(msg.content)
              ? JSON.stringify(msg.content)
              : ''

        toolResponseMap.set(toolCallId, {
          type: 'tool_result',
          tool_use_id: toolCallId,
          content: responseContent
        } as ContentBlock)

        // console.log('记录tool响应，tool_call_id:', toolCallId)
        continue
      }

      // 处理用户消息 - 开始新组
      if (msg.role === 'user') {
        if (currentGroup) {
          messageGroups.push(currentGroup)
        }

        let formattedContent: ContentBlock[] = []
        if (typeof msg.content === 'string') {
          formattedContent = [{ type: 'text', text: msg.content }]
        } else if (msg.content && Array.isArray(msg.content)) {
          formattedContent = msg.content.map((c) => {
            if (c.type === 'image_url' && c.image_url) {
              return {
                type: 'image',
                source: c.image_url.url.startsWith('data:image')
                  ? {
                      type: 'base64',
                      data: c.image_url.url.split(',')[1],
                      media_type: c.image_url.url.split(';')[0].split(':')[1] as
                        | 'image/jpeg'
                        | 'image/png'
                        | 'image/gif'
                        | 'image/webp'
                    }
                  : { type: 'url', url: c.image_url.url }
              } as ContentBlock
            } else {
              return { type: 'text', text: c.text || '' } as ContentBlock
            }
          })
        }

        currentGroup = {
          role: 'user',
          contents: formattedContent
        }

        // console.log('开始新的用户消息组')
        continue
      }

      // 处理assistant消息 - 添加到当前组或开始新组
      if (msg.role === 'assistant') {
        // 检查是否需要新建一个组：
        // 1. 当前还没有组
        // 2. 当前组不是assistant
        // 3. 当前组是assistant但包含了工具调用
        const shouldCreateNewGroup =
          !currentGroup || currentGroup.role !== 'assistant' || currentGroup.hasToolUse === true

        if (shouldCreateNewGroup) {
          if (currentGroup) {
            messageGroups.push(currentGroup)
          }

          currentGroup = {
            role: 'assistant',
            contents: [],
            toolCalls: [],
            hasToolUse: false
          }
        }

        // 确保currentGroup已初始化
        if (!currentGroup) {
          currentGroup = {
            role: 'assistant',
            contents: [],
            toolCalls: [],
            hasToolUse: false
          }
        }

        // 处理常规内容
        if (msg.content) {
          let assistantContent: ContentBlock[] = []
          if (typeof msg.content === 'string') {
            if (msg.content.trim()) {
              assistantContent = [{ type: 'text', text: msg.content }]
            }
          } else if (Array.isArray(msg.content)) {
            // 处理各种内容类型
            for (const content of msg.content) {
              if (content.type === 'text') {
                currentGroup.contents.push({
                  type: 'text',
                  text: content.text || ''
                } as ContentBlock)
              } else if (content.type === 'image_url' && content.image_url) {
                currentGroup.contents.push({
                  type: 'image',
                  source: content.image_url.url.startsWith('data:image')
                    ? {
                        type: 'base64',
                        data: content.image_url.url.split(',')[1],
                        media_type: content.image_url.url.split(';')[0].split(':')[1] as
                          | 'image/jpeg'
                          | 'image/png'
                          | 'image/gif'
                          | 'image/webp'
                      }
                    : { type: 'url', url: content.image_url.url }
                } as ContentBlock)
              }
            }

            continue
          }

          currentGroup.contents.push(...assistantContent)
          // console.log('添加文本内容到当前assistant组, 项数:', assistantContent.length)
        }

        // 处理tool_calls
        if ('tool_calls' in msg && Array.isArray(msg.tool_calls)) {
          // console.log('处理assistant消息中的tool_calls', msg.tool_calls.length)

          // 标记当前组包含工具调用
          if (currentGroup) {
            currentGroup.hasToolUse = true
          }

          for (const toolCall of msg.tool_calls as ToolCall[]) {
            try {
              // @ts-ignore - 转换为Anthropic格式
              currentGroup.contents.push({
                type: 'tool_use',
                id: toolCall.id,
                name: toolCall.function.name,
                input: JSON.parse(toolCall.function.arguments || '{}')
              } as ContentBlock)

              // console.log('添加tool_call到当前assistant组:', toolCall.function.name)

              // 记录工具调用，稍后查找响应
              if (!currentGroup.toolCalls) currentGroup.toolCalls = []
              currentGroup.toolCalls.push(toolCall.id)
            } catch (e) {
              console.error('Error processing tool_call:', e)
            }
          }
        }
      }
    }

    // 添加最后一个组
    if (currentGroup) {
      messageGroups.push(currentGroup)
    }

    // console.log('预处理完成，消息组数量:', messageGroups.length)

    // 第二阶段：生成最终的格式化消息
    const formattedMessages: Anthropic.MessageParam[] = []

    for (const group of messageGroups) {
      if (group.contents.length === 0) continue

      // 添加组的主要内容
      formattedMessages.push({
        role: group.role as 'user' | 'assistant',
        content: group.contents as Anthropic.ContentBlockParam[]
      })

      // console.log(`添加${group.role}组，内容项数:${group.contents.length}`)

      // 如果是assistant组且有工具调用，添加对应的工具响应
      if (group.role === 'assistant' && group.toolCalls && group.toolCalls.length > 0) {
        for (const toolCallId of group.toolCalls) {
          const toolResponse = toolResponseMap.get(toolCallId)
          if (toolResponse) {
            formattedMessages.push({
              role: 'user',
              content: [toolResponse]
            })

            // console.log('添加工具响应，tool_call_id:', toolCallId)
          }
        }
      }
    }

    // console.log('格式化完成, 最终消息数:', formattedMessages.length)
    // 为调试目的，打印前3条消息的结构
    // formattedMessages.slice(0, Math.min(3, formattedMessages.length)).forEach((msg, i) => {
    //   console.log(`最终消息#${i + 1}:`, {
    //     role: msg.role,
    //     contentLength: Array.isArray(msg.content) ? msg.content.length : 0,
    //     contentTypes: Array.isArray(msg.content)
    //       ? msg.content.map((c) => c.type).join(',')
    //       : typeof msg.content
    //   })
    // })

    return {
      system: systemContent || undefined,
      messages: formattedMessages
    }
  }

  // 依赖 formatMessages
  async completions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    try {
      if (!this.bedrockRuntime) {
        throw new Error('AWS Bedrock client is not initialized')
      }

      const formattedMessages = this.formatMessages(messages)

      // 创建基本请求参数
      const payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: maxTokens,
        temperature,
        system: formattedMessages.system,
        messages
      }

      const command = new InvokeModelCommand({
        contentType: 'application/json',
        body: JSON.stringify(payload),
        modelId
      })

      // 执行请求
      const response = (await this.bedrockRuntime.send(command)) as InvokeModelCommandOutput & {
        usage?: any
      }

      const resultResp: LLMResponse = {
        content: ''
      }

      // 添加usage信息
      if (response.usage) {
        resultResp.totalUsage = {
          prompt_tokens: response.usage.input_tokens,
          completion_tokens: response.usage.output_tokens,
          total_tokens: response.usage.input_tokens + response.usage.output_tokens
        }
      }

      // 获取文本内容
      // const content = response.content
      //   .filter((block) => block.type === 'text')
      //   .map((block) => (block.type === 'text' ? block.text : ''))
      //   .join('')
      const decodedResponseBody = new TextDecoder().decode(response.body)
      /** @type {MessagesResponseBody} */
      const responseBody = JSON.parse(decodedResponseBody)
      const content = responseBody.content[0].text

      // 处理<think>标签
      if (content.includes('<think>')) {
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
        // 没有think标签，所有内容作为普通内容
        resultResp.content = content
      }

      return resultResp
    } catch (error) {
      console.error('AWS Bedrock Claude completions error:', error)
      throw error
    }
  }

  // 依赖 formatMessages
  // 添加coreStream方法
  async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    mcpTools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    if (!this.bedrockRuntime) throw new Error('AWS Bedrock client is not initialized')
    if (!modelId) throw new Error('Model ID is required')
    console.log('modelConfig', modelConfig, modelId)
    try {
      // 格式化消息
      const formattedMessagesObject = this.formatMessages(messages)
      console.log('formattedMessagesObject', JSON.stringify(formattedMessagesObject))

      // 将MCP工具转换为Anthropic工具格式
      const anthropicTools =
        mcpTools.length > 0
          ? await presenter.mcpPresenter.mcpToolsToAnthropicTools(mcpTools, this.provider.id)
          : undefined

      // 创建基本请求参数
      // const streamParams = {
      //   model: modelId,
      //   max_tokens: maxTokens || 1024,
      //   temperature: temperature || 0.7,
      //   messages: formattedMessagesObject.messages,
      //   stream: true
      // } as Anthropic.Messages.MessageCreateParamsStreaming
      const payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: maxTokens || 1024,
        temperature: temperature || 0.7,
        // system: formattedMessagesObject.system,
        messages: formattedMessagesObject.messages,
        thinking: undefined as any,
        tools: undefined as any
      }
      const command = new InvokeModelWithResponseStreamCommand({
        contentType: 'application/json',
        body: JSON.stringify(payload),
        modelId
      })

      // 启用Claude 3.7模型的思考功能
      if (modelId.includes('claude-3-7')) {
        payload.thinking = { budget_tokens: 1024, type: 'enabled' }
      }

      // // 如果有系统消息，添加到请求参数中
      // if (formattedMessagesObject.system) {
      //   // @ts-ignore - system属性在类型定义中可能不存在，但API已支持
      //   streamParams.system = formattedMessagesObject.system
      // }

      // 添加工具参数
      if (anthropicTools && anthropicTools.length > 0) {
        // @ts-ignore - 类型不匹配，但格式是正确的
        payload.tools = anthropicTools
      }
      // 创建Anthropic流
      const response = await this.bedrockRuntime.send(command)
      const body = await response.body
      if (!body) {
        throw new Error('No response body from AWS Bedrock')
      }

      // 状态变量
      let accumulatedJson = ''
      let toolUseDetected = false
      let currentToolId = ''
      let currentToolName = ''
      let currentToolInputs: Record<string, unknown> = {}
      let usageMetadata: Usage | undefined
      // 处理流中的各种事件
      for await (const item of body) {
        if (!item.chunk) continue

        const chunk = JSON.parse(new TextDecoder().decode(item.chunk.bytes))
        // 处理使用统计
        if (chunk.type === 'message_start' && chunk.message.usage) {
          usageMetadata = chunk.message.usage
        }

        // 处理工具调用开始
        // @ts-ignore - Anthropic SDK类型定义不完整
        if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') {
          toolUseDetected = true
          // @ts-ignore - content_block不在类型定义中
          currentToolId = chunk.content_block.id || `anthropic-tool-${Date.now()}`
          // @ts-ignore - content_block不在类型定义中
          currentToolName = chunk.content_block.name || ''
          currentToolInputs = {}
          accumulatedJson = ''

          // 发送工具调用开始事件
          if (currentToolName) {
            yield {
              type: 'tool_call_start',
              tool_call_id: currentToolId,
              tool_call_name: currentToolName
            }
          }
          continue
        }

        // 处理工具调用参数更新 - input_json_delta
        // @ts-ignore - 类型定义中没有工具相关字段
        if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'input_json_delta') {
          // @ts-ignore - partial_json不在类型定义中
          const partialJson = chunk.delta.partial_json
          if (partialJson) {
            accumulatedJson += partialJson

            // 发送工具调用参数块事件
            yield {
              type: 'tool_call_chunk',
              tool_call_id: currentToolId,
              tool_call_arguments_chunk: partialJson
            }
          }
          continue
        }

        // 处理工具使用更新 - tool_use_delta
        // @ts-ignore - 类型定义中没有工具相关字段
        if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'tool_use_delta') {
          // @ts-ignore - delta.name不在类型定义中
          if (chunk.delta.name && !currentToolName) {
            // @ts-ignore - 访问delta.name
            currentToolName = chunk.delta.name
            yield {
              type: 'tool_call_start',
              tool_call_id: currentToolId,
              tool_call_name: currentToolName
            }
          }

          // @ts-ignore - delta.input不在类型定义中
          if (chunk.delta.input) {
            currentToolInputs = {
              ...currentToolInputs,
              // @ts-ignore - 访问delta.input
              ...chunk.delta.input
            }
          }
          continue
        }

        // 处理内容块结束
        if (chunk.type === 'content_block_stop') {
          // 处理工具调用完成
          if (toolUseDetected && currentToolName && accumulatedJson) {
            try {
              // 尝试解析完整的JSON
              const jsonStr = accumulatedJson.trim()
              if (jsonStr && (jsonStr.startsWith('{') || jsonStr.startsWith('['))) {
                try {
                  const jsonObject = JSON.parse(jsonStr)
                  if (jsonObject && typeof jsonObject === 'object') {
                    currentToolInputs = { ...currentToolInputs, ...jsonObject }
                  }
                } catch (e) {
                  console.error('解析完整JSON失败:', e)
                }
              }
            } catch (e) {
              console.error('处理累积JSON失败:', e)
            }

            // 发送工具调用结束事件
            const argsString = JSON.stringify(currentToolInputs)
            yield {
              type: 'tool_call_end',
              tool_call_id: currentToolId,
              tool_call_arguments_complete: argsString
            }

            // 重置工具调用状态
            accumulatedJson = ''
          }
          continue
        }

        // 检查消息是否因为工具调用而停止
        if (chunk.type === 'message_delta' && chunk.delta?.stop_reason === 'tool_use') {
          // 设置为工具使用停止，主循环会处理工具调用
          continue
        }

        // 处理思考内容（如果有）
        // @ts-ignore - 类型定义中没有thinking相关字段
        if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'thinking_delta') {
          // @ts-ignore - delta.thinking不在类型定义中
          const thinkingText = chunk.delta.thinking
          if (thinkingText) {
            yield {
              type: 'reasoning',
              reasoning_content: thinkingText
            }
          }
          continue
        }

        // 处理常规文本内容
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          const text = chunk.delta.text
          if (text) {
            // 处理<think>标签
            if (text.includes('<think>')) {
              const parts = text.split('<think>')
              if (parts[0]) {
                yield {
                  type: 'text',
                  content: parts[0]
                }
              }

              if (parts[1]) {
                // 检查是否包含</think>
                const thinkParts = parts[1].split('</think>')
                if (thinkParts.length > 1) {
                  yield {
                    type: 'reasoning',
                    reasoning_content: thinkParts[0]
                  }

                  if (thinkParts[1]) {
                    yield {
                      type: 'text',
                      content: thinkParts[1]
                    }
                  }
                } else {
                  yield {
                    type: 'reasoning',
                    reasoning_content: parts[1]
                  }
                }
              }
            } else if (text.includes('</think>')) {
              const parts = text.split('</think>')
              yield {
                type: 'reasoning',
                reasoning_content: parts[0]
              }

              if (parts[1]) {
                yield {
                  type: 'text',
                  content: parts[1]
                }
              }
            } else {
              yield {
                type: 'text',
                content: text
              }
            }
          }
          continue
        }
      }
      if (usageMetadata) {
        yield createStreamEvent.usage({
          prompt_tokens: usageMetadata.input_tokens,
          completion_tokens: usageMetadata.output_tokens,
          total_tokens: usageMetadata.input_tokens + usageMetadata.output_tokens
        })
      }
      // 发送停止事件
      yield createStreamEvent.stop(toolUseDetected ? 'tool_use' : 'complete')
    } catch (error) {
      console.error('AWS Bedrock Claude coreStream error:', error)
      yield createStreamEvent.error(error instanceof Error ? error.message : '未知错误')
      yield createStreamEvent.stop('error')
    }
  }
}
