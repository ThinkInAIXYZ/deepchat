import {
  LLM_PROVIDER,
  LLMResponse,
  MODEL_META,
  LLMCoreStreamEvent,
  ModelConfig,
  MCPToolDefinition,
  ChatMessage,
  IConfigPresenter
} from '@shared/presenter'
import { createStreamEvent } from '@shared/types/core/llm-events'
import { BaseLLMProvider, SUMMARY_TITLES_PROMPT } from '../baseProvider'
import Anthropic from '@anthropic-ai/sdk'
import { presenter } from '@/presenter'
import { Usage } from '@anthropic-ai/sdk/resources'
import { proxyConfig } from '../../proxyConfig'
import { ProxyAgent } from 'undici'

export class AnthropicProvider extends BaseLLMProvider {
  private anthropic!: Anthropic
  private oauthToken?: string
  private isOAuthMode = false
  private defaultModel = 'claude-3-7-sonnet-20250219'

  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
    this.init()
  }

  public onProxyResolved(): void {
    this.init()
  }

  protected async init() {
    if (this.provider.enable) {
      try {
        let apiKey: string | null = null
        this.isOAuthMode = false
        this.oauthToken = undefined

        // Determine authentication method based on provider configuration
        if (this.provider.authMode === 'oauth') {
          // OAuth mode: prioritize OAuth token
          try {
            const oauthToken = await presenter.oauthPresenter.getAnthropicAccessToken()
            if (oauthToken) {
              this.oauthToken = oauthToken
              this.isOAuthMode = true
              console.log('[Anthropic Provider] Using OAuth token for authentication')
            } else {
              console.warn('[Anthropic Provider] OAuth mode selected but no OAuth token available')
            }
          } catch (error) {
            console.log('[Anthropic Provider] Failed to get OAuth token:', error)
          }
        } else {
          // API Key mode (default): prioritize API key
          apiKey = this.provider.apiKey || process.env.ANTHROPIC_API_KEY || null
          if (apiKey) {
            console.log('[Anthropic Provider] Using API key for authentication')
          }
        }

        // Fallback mechanism
        if (!this.isOAuthMode && !apiKey) {
          if (this.provider.authMode === 'oauth') {
            // Fallback to API key if OAuth fails
            apiKey = this.provider.apiKey || process.env.ANTHROPIC_API_KEY || null
            if (apiKey) {
              console.log('[Anthropic Provider] OAuth failed, falling back to API key')
            }
          } else {
            // Fallback to OAuth if API key not available
            try {
              const oauthToken = await presenter.oauthPresenter.getAnthropicAccessToken()
              if (oauthToken) {
                this.oauthToken = oauthToken
                this.isOAuthMode = true
                console.log('[Anthropic Provider] API key not available, using OAuth token')
              }
            } catch (error) {
              console.log('[Anthropic Provider] Failed to get OAuth token as fallback:', error)
            }
          }
        }

        if (!this.isOAuthMode && !apiKey) {
          console.warn('[Anthropic Provider] No API key or OAuth token available')
          return
        }

        // Initialize SDK only for API Key mode
        if (!this.isOAuthMode && apiKey) {
          // Get proxy configuration
          const proxyUrl = proxyConfig.getProxyUrl()
          const fetchOptions: { dispatcher?: ProxyAgent } = {}

          if (proxyUrl) {
            console.log(`[Anthropic Provider] Using proxy: ${proxyUrl}`)
            const proxyAgent = new ProxyAgent(proxyUrl)
            fetchOptions.dispatcher = proxyAgent
          }

          this.anthropic = new Anthropic({
            apiKey: apiKey,
            baseURL: this.provider.baseUrl || 'https://api.anthropic.com',
            defaultHeaders: this.defaultHeaders,
            fetchOptions
          })
        }

        await super.init()
      } catch (error) {
        console.error('Failed to initialize Anthropic provider:', error)
      }
    }
  }

  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    try {
      let models: any

      if (this.isOAuthMode) {
        // OAuth mode: use direct HTTP request
        models = await this.makeOAuthRequest('/v1/models', 'GET')
      } else {
        // API Key mode: use SDK
        models = await this.anthropic.models.list()
      }

      // 引入getModelConfig函数
      if (models && models.data && Array.isArray(models.data)) {
        const processedModels: MODEL_META[] = []

        for (const model of models.data) {
          // 确保模型有必要的属性
          if (model.id) {
            // 获取额外的配置信息
            const modelConfig = this.configPresenter.getModelConfig(model.id, this.provider.id)

            // 提取模型组名称，通常是Claude后面的版本号

            processedModels.push({
              id: model.id,
              name: model.display_name || model.id,
              providerId: this.provider.id,
              maxTokens: modelConfig?.maxTokens || 64_000,
              group: 'Claude',
              isCustom: false,
              contextLength: modelConfig?.contextLength || 200000,
              vision: modelConfig?.vision || false,
              functionCall: modelConfig?.functionCall || false,
              reasoning: modelConfig?.reasoning || false
            })
          }
        }

        // 如果成功解析出模型，则返回
        if (processedModels.length > 0) {
          return processedModels
        }
      }

      // 如果API请求失败或返回数据解析失败，返回默认模型列表
      console.log('从API获取模型列表失败，使用默认模型配置')
    } catch (error) {
      console.error('获取Anthropic模型列表出错:', error)
    }

    // 默认的模型列表（如API调用失败或数据格式不正确）
    return [
      {
        id: 'claude-opus-4-1-20250805',
        name: 'Claude Opus 4.1',
        providerId: this.provider.id,
        maxTokens: 32_000,
        group: 'Claude 4.1',
        isCustom: false,
        contextLength: 200000,
        vision: true,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'claude-opus-4-20250514',
        name: 'Claude Opus 4',
        providerId: this.provider.id,
        maxTokens: 32_000,
        group: 'Claude 4',
        isCustom: false,
        contextLength: 200000,
        vision: true,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        providerId: this.provider.id,
        maxTokens: 64_000,
        group: 'Claude 4',
        isCustom: false,
        contextLength: 200000,
        vision: true,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'claude-3-7-sonnet-20250219',
        name: 'Claude 3.7 Sonnet',
        providerId: this.provider.id,
        maxTokens: 64_000,
        group: 'Claude 3.7',
        isCustom: false,
        contextLength: 200000,
        vision: true,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        providerId: this.provider.id,
        maxTokens: 8192,
        group: 'Claude 3.5',
        isCustom: false,
        contextLength: 200000,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        providerId: this.provider.id,
        maxTokens: 8192,
        group: 'Claude 3.5',
        isCustom: false,
        contextLength: 200000,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'claude-3-5-sonnet-20240620',
        name: 'Claude 3.5 Sonnet (Legacy)',
        providerId: this.provider.id,
        maxTokens: 8192,
        group: 'Claude 3.5',
        isCustom: false,
        contextLength: 200000,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        providerId: this.provider.id,
        maxTokens: 4096,
        group: 'Claude 3',
        isCustom: false,
        contextLength: 200000,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'claude-3-haiku-20240307',
        name: 'Claude 3 Haiku',
        providerId: this.provider.id,
        maxTokens: 8192,
        group: 'Claude 3',
        isCustom: false,
        contextLength: 200000,
        vision: true,
        functionCall: true,
        reasoning: false
      }
    ]
  }

  /**
   * Make OAuth authenticated HTTP request to Anthropic API
   */
  private async makeOAuthRequest(path: string, method: 'GET' | 'POST', body?: any): Promise<any> {
    if (!this.oauthToken) {
      throw new Error('No OAuth token available')
    }

    const baseUrl = 'https://api.anthropic.com'
    const url = baseUrl + path

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'oauth-2025-04-20',
      Authorization: `Bearer ${this.oauthToken}`
    }

    // Get proxy configuration
    const proxyUrl = proxyConfig.getProxyUrl()
    const fetchOptions: RequestInit = {
      method,
      headers,
      ...(body && { body: JSON.stringify(body) })
    }

    if (proxyUrl) {
      const proxyAgent = new ProxyAgent(proxyUrl)
      // @ts-ignore - dispatcher is valid for undici-based fetch
      fetchOptions.dispatcher = proxyAgent
    }

    const response = await fetch(url, fetchOptions)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OAuth API request failed: ${response.status} ${errorText}`)
    }

    return await response.json()
  }

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      if (this.isOAuthMode) {
        if (!this.oauthToken) {
          return { isOk: false, errorMsg: 'OAuth token not available' }
        }

        // OAuth mode: use direct HTTP request with fixed system message
        await this.makeOAuthRequest('/v1/messages', 'POST', {
          model: this.defaultModel,
          max_tokens: 10,
          system: "You are Claude Code, Anthropic's official CLI for Claude.",
          messages: [{ role: 'user', content: 'Hello' }]
        })
      } else {
        if (!this.anthropic) {
          return { isOk: false, errorMsg: 'Anthropic SDK not initialized' }
        }

        // API Key mode: use SDK
        await this.anthropic.messages.create({
          model: this.defaultModel,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hello' }]
        })
      }

      return { isOk: true, errorMsg: null }
    } catch (error: unknown) {
      console.error('Anthropic API check failed:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { isOk: false, errorMsg: `API check failed: ${errorMessage}` }
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

  /**
   * Format messages for OAuth mode
   * Converts system messages to user messages and handles special formatting
   */
  private formatMessagesForOAuth(messages: ChatMessage[]): any[] {
    const result: any[] = []
    let originalSystemContent = ''

    // Extract original system message content
    for (const msg of messages) {
      if (msg.role === 'system') {
        originalSystemContent +=
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

    // Add original system message as first user message if exists
    if (originalSystemContent.trim()) {
      result.push({
        role: 'user',
        content: originalSystemContent.trim()
      })
    }

    // Process non-system messages
    for (const msg of messages) {
      if (msg.role === 'system') {
        continue // Skip system messages, already converted above
      }

      if (msg.role === 'user' || msg.role === 'assistant') {
        const content: any[] = []

        if (typeof msg.content === 'string') {
          // Only add non-empty text content
          if (msg.content.trim()) {
            content.push({
              type: 'text',
              text: msg.content
            })
          }
        } else if (Array.isArray(msg.content)) {
          for (const item of msg.content) {
            if (item.type === 'text') {
              // Only add non-empty text content
              const textContent = item.text || ''
              if (textContent.trim()) {
                content.push({
                  type: 'text',
                  text: textContent
                })
              }
            } else if (item.type === 'image_url') {
              content.push({
                type: 'image',
                source: item.image_url?.url.startsWith('data:image')
                  ? {
                      type: 'base64',
                      data: item.image_url.url.split(',')[1],
                      media_type: item.image_url.url.split(';')[0].split(':')[1] as any
                    }
                  : { type: 'url', url: item.image_url?.url }
              })
            }
          }
        }

        // Handle tool calls for assistant messages
        if (msg.role === 'assistant' && 'tool_calls' in msg && Array.isArray(msg.tool_calls)) {
          for (const toolCall of msg.tool_calls as any[]) {
            try {
              content.push({
                type: 'tool_use',
                id: toolCall.id,
                name: toolCall.function.name,
                input: JSON.parse(toolCall.function.arguments || '{}')
              })
            } catch (e) {
              console.error('Error processing tool_call in OAuth mode:', e)
            }
          }
        }

        // Only add message if it has content, otherwise add a placeholder
        if (content.length === 0) {
          // Add a placeholder for empty messages to prevent API errors
          content.push({
            type: 'text',
            text: '[Empty message]'
          })
        }

        result.push({
          role: msg.role,
          content: content.length === 1 && content[0].type === 'text' ? content[0].text : content
        })
      } else if (msg.role === 'tool') {
        // Handle tool result messages
        const toolContent =
          typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        result.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: (msg as any).tool_call_id || '',
              content: toolContent || '[Empty tool result]'
            }
          ]
        })
      }
    }

    return result
  }

  public async summaryTitles(messages: ChatMessage[], modelId: string): Promise<string> {
    const prompt = `${SUMMARY_TITLES_PROMPT}\n\n${messages.map((m) => `${m.role}: ${m.content}`).join('\n')}`
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
      let requestParams: any
      let response: any

      if (this.isOAuthMode) {
        if (!this.oauthToken) {
          throw new Error('OAuth token is not available')
        }

        // OAuth mode: special message handling
        const oauthMessages = this.formatMessagesForOAuth(messages)
        requestParams = {
          model: modelId,
          max_tokens: maxTokens || 1024,
          temperature: temperature || 0.7,
          system: "You are Claude Code, Anthropic's official CLI for Claude.",
          messages: oauthMessages
        }

        response = await this.makeOAuthRequest('/v1/messages', 'POST', requestParams)
      } else {
        // API Key mode: use standard formatting
        const formattedMessages = this.formatMessages(messages)

        requestParams = {
          model: modelId,
          max_tokens: maxTokens || 1024,
          temperature: temperature || 0.7,
          messages: formattedMessages.messages
        }

        // 如果有系统消息，添加到请求参数中
        if (formattedMessages.system) {
          requestParams.system = formattedMessages.system
        }

        if (!this.anthropic) {
          throw new Error('Anthropic client is not initialized')
        }
        response = await this.anthropic.messages.create(requestParams)
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
      const content = response.content
        .filter((block) => block.type === 'text')
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')

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
      console.error('Anthropic completions error:', error)
      throw error
    }
  }

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
      let requestParams: any
      let response: any

      if (this.isOAuthMode) {
        if (!this.oauthToken) {
          throw new Error('OAuth token is not available')
        }

        // OAuth mode: use fixed system message and prepend original system prompt to user message
        let finalPrompt = prompt
        if (systemPrompt) {
          finalPrompt = `${systemPrompt}\n\n${prompt}`
        }

        requestParams = {
          model: modelId,
          max_tokens: maxTokens || 1024,
          temperature: temperature || 0.7,
          system: "You are Claude Code, Anthropic's official CLI for Claude.",
          messages: [{ role: 'user', content: finalPrompt }]
        }

        response = await this.makeOAuthRequest('/v1/messages', 'POST', requestParams)
      } else {
        // API Key mode: use standard approach
        requestParams = {
          model: modelId,
          max_tokens: maxTokens || 1024,
          temperature: temperature || 0.7,
          messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: prompt }] }]
        }

        // 如果提供了系统提示，添加到请求中
        if (systemPrompt) {
          requestParams.system = systemPrompt
        }

        if (!this.anthropic) {
          throw new Error('Anthropic client is not initialized')
        }
        response = await this.anthropic.messages.create(requestParams)
      }

      return {
        content: response.content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => (block.type === 'text' ? block.text : ''))
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
    maxTokens?: number,
    systemPrompt?: string
  ): Promise<string[]> {
    const prompt = `
根据下面的上下文，给出3个可能的回复建议，每个建议一行，不要有编号或者额外的解释：

${context}
`
    try {
      let requestParams: any
      let response: any

      if (this.isOAuthMode) {
        if (!this.oauthToken) {
          throw new Error('OAuth token is not available')
        }

        // OAuth mode: use fixed system message and prepend original system prompt to user message
        let finalPrompt = prompt
        if (systemPrompt) {
          finalPrompt = `${systemPrompt}\n\n${prompt}`
        }

        requestParams = {
          model: modelId,
          max_tokens: maxTokens || 1024,
          temperature: temperature || 0.7,
          system: "You are Claude Code, Anthropic's official CLI for Claude.",
          messages: [{ role: 'user', content: finalPrompt }]
        }

        response = await this.makeOAuthRequest('/v1/messages', 'POST', requestParams)
      } else {
        // API Key mode: use standard approach
        requestParams = {
          model: modelId,
          max_tokens: maxTokens || 1024,
          temperature: temperature || 0.7,
          messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: prompt }] }]
        }

        // 如果提供了系统提示，添加到请求中
        if (systemPrompt) {
          requestParams.system = systemPrompt
        }

        if (!this.anthropic) {
          throw new Error('Anthropic client is not initialized')
        }
        response = await this.anthropic.messages.create(requestParams)
      }

      const suggestions = response.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => (block.type === 'text' ? block.text : ''))
        .join('')
        .split('\n')
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0)
        .slice(0, 3)

      return suggestions
    } catch (error) {
      console.error('Anthropic suggestions error:', error)
      return ['建议生成失败']
    }
  }

  // 添加coreStream方法
  async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    mcpTools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    if (!modelId) throw new Error('Model ID is required')
    console.log('modelConfig', modelConfig, modelId)

    if (this.isOAuthMode) {
      // OAuth mode: use custom streaming implementation
      yield* this.coreStreamOAuth(messages, modelId, modelConfig, temperature, maxTokens, mcpTools)
      return
    }

    if (!this.anthropic) throw new Error('Anthropic client is not initialized')
    try {
      // 格式化消息
      const formattedMessagesObject = this.formatMessages(messages)

      // 将MCP工具转换为Anthropic工具格式
      const anthropicTools =
        mcpTools.length > 0
          ? await presenter.mcpPresenter.mcpToolsToAnthropicTools(mcpTools, this.provider.id)
          : undefined

      // 创建基本请求参数
      const streamParams = {
        model: modelId,
        max_tokens: maxTokens || 1024,
        temperature: temperature || 0.7,
        messages: formattedMessagesObject.messages,
        stream: true
      } as Anthropic.Messages.MessageCreateParamsStreaming

      // 启用Claude 3.7模型的思考功能
      if (modelId.includes('claude-3-7')) {
        streamParams.thinking = { budget_tokens: 1024, type: 'enabled' }
      }

      // 如果有系统消息，添加到请求参数中
      if (formattedMessagesObject.system) {
        // @ts-ignore - system属性在类型定义中可能不存在，但API已支持
        streamParams.system = formattedMessagesObject.system
      }

      // 添加工具参数
      if (anthropicTools && anthropicTools.length > 0) {
        // @ts-ignore - 类型不匹配，但格式是正确的
        streamParams.tools = anthropicTools
      }
      // console.log('streamParams', JSON.stringify(streamParams.messages))
      // 创建Anthropic流
      const stream = await this.anthropic.messages.create(streamParams)

      // 状态变量
      let accumulatedJson = ''
      let toolUseDetected = false
      let currentToolId = ''
      let currentToolName = ''
      let currentToolInputs: Record<string, unknown> = {}
      let usageMetadata: Usage | undefined
      // 处理流中的各种事件
      for await (const chunk of stream) {
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
            yield createStreamEvent.toolCallStart(currentToolId, currentToolName)
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
            yield createStreamEvent.toolCallChunk(currentToolId, partialJson)
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
            yield createStreamEvent.toolCallStart(currentToolId, currentToolName)
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
            yield createStreamEvent.toolCallEnd(currentToolId, argsString)

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
            yield createStreamEvent.reasoning(thinkingText)
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
                yield createStreamEvent.text(parts[0])
              }

              if (parts[1]) {
                // 检查是否包含</think>
                const thinkParts = parts[1].split('</think>')
                if (thinkParts.length > 1) {
                  yield createStreamEvent.reasoning(thinkParts[0])

                  if (thinkParts[1]) {
                    yield createStreamEvent.text(thinkParts[1])
                  }
                } else {
                  yield createStreamEvent.reasoning(parts[1])
                }
              }
            } else if (text.includes('</think>')) {
              const parts = text.split('</think>')
              yield createStreamEvent.reasoning(parts[0])

              if (parts[1]) {
                yield createStreamEvent.text(parts[1])
              }
            } else {
              yield createStreamEvent.text(text)
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
      console.error('Anthropic coreStream error:', error)
      yield createStreamEvent.error(error instanceof Error ? error.message : '未知错误')
      yield createStreamEvent.stop('error')
    }
  }

  /**
   * OAuth mode streaming implementation
   * Uses Server-Sent Events for streaming responses
   */
  async *coreStreamOAuth(
    messages: ChatMessage[],
    modelId: string,
    _modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    mcpTools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    if (!this.oauthToken) {
      throw new Error('OAuth token is not available')
    }

    try {
      // OAuth mode: use special message formatting
      const oauthMessages = this.formatMessagesForOAuth(messages)

      // 将MCP工具转换为Anthropic工具格式
      const anthropicTools =
        mcpTools.length > 0
          ? await presenter.mcpPresenter.mcpToolsToAnthropicTools(mcpTools, this.provider.id)
          : undefined

      // 创建基本请求参数
      const streamParams: any = {
        model: modelId,
        max_tokens: maxTokens || 1024,
        temperature: temperature || 0.7,
        system: "You are Claude Code, Anthropic's official CLI for Claude.",
        messages: oauthMessages,
        stream: true
      }

      // 启用Claude 3.7模型的思考功能
      if (modelId.includes('claude-3-7')) {
        streamParams.thinking = { budget_tokens: 1024, type: 'enabled' }
      }

      // 添加工具参数
      if (anthropicTools && anthropicTools.length > 0) {
        streamParams.tools = anthropicTools
      }

      // Make streaming request
      const baseUrl = 'https://api.anthropic.com'
      const url = baseUrl + '/v1/messages'

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
        Authorization: `Bearer ${this.oauthToken}`,
        Accept: 'text/event-stream'
      }

      // Get proxy configuration
      const proxyUrl = proxyConfig.getProxyUrl()
      const fetchOptions: RequestInit = {
        method: 'POST',
        headers,
        body: JSON.stringify(streamParams)
      }

      if (proxyUrl) {
        const proxyAgent = new ProxyAgent(proxyUrl)
        // @ts-ignore - dispatcher is valid for undici-based fetch
        fetchOptions.dispatcher = proxyAgent
      }

      const response = await fetch(url, fetchOptions)

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`OAuth streaming request failed: ${response.status} ${errorText}`)
      }

      if (!response.body) {
        throw new Error('No response body for streaming')
      }

      // Parse Server-Sent Events stream
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let toolUseDetected = false
      let currentToolId = ''
      let currentToolName = ''
      let accumulatedJson = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') continue

              try {
                const chunk = JSON.parse(data)

                // Handle different event types
                if (
                  chunk.type === 'content_block_start' &&
                  chunk.content_block?.type === 'tool_use'
                ) {
                  toolUseDetected = true
                  currentToolId = chunk.content_block.id || `anthropic-tool-${Date.now()}`
                  currentToolName = chunk.content_block.name || ''
                  accumulatedJson = ''

                  if (currentToolName) {
                    yield {
                      type: 'tool_call_start',
                      tool_call_id: currentToolId,
                      tool_call_name: currentToolName
                    }
                  }
                } else if (
                  chunk.type === 'content_block_delta' &&
                  chunk.delta?.type === 'input_json_delta'
                ) {
                  const partialJson = chunk.delta.partial_json
                  if (partialJson) {
                    accumulatedJson += partialJson
                    yield {
                      type: 'tool_call_chunk',
                      tool_call_id: currentToolId,
                      tool_call_arguments_chunk: partialJson
                    }
                  }
                } else if (chunk.type === 'content_block_stop' && toolUseDetected) {
                  if (accumulatedJson) {
                    yield {
                      type: 'tool_call_end',
                      tool_call_id: currentToolId,
                      tool_call_arguments_complete: accumulatedJson
                    }
                  }
                  accumulatedJson = ''
                } else if (
                  chunk.type === 'content_block_delta' &&
                  chunk.delta?.type === 'text_delta'
                ) {
                  const text = chunk.delta.text
                  if (text) {
                    yield {
                      type: 'text',
                      content: text
                    }
                  }
                } else if (chunk.type === 'message_start' && chunk.message?.usage) {
                  // Handle usage info if needed
                } else if (chunk.type === 'message_delta' && chunk.usage) {
                  yield createStreamEvent.usage({
                    prompt_tokens: chunk.usage.input_tokens || 0,
                    completion_tokens: chunk.usage.output_tokens || 0,
                    total_tokens: (chunk.usage.input_tokens || 0) + (chunk.usage.output_tokens || 0)
                  })
                }
              } catch (parseError) {
                console.error('Failed to parse chunk:', parseError, data)
              }
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      // Send stop event
      yield createStreamEvent.stop(toolUseDetected ? 'tool_use' : 'complete')
    } catch (error) {
      console.error('Anthropic OAuth coreStream error:', error)
      yield createStreamEvent.error(error instanceof Error ? error.message : 'Unknown error')
      yield createStreamEvent.stop('error')
    }
  }
}
