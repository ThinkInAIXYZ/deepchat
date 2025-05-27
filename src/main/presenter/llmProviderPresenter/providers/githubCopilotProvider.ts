import { LLM_PROVIDER, LLMResponse, MODEL_META, ChatMessage, LLMCoreStreamEvent, ModelConfig, MCPToolDefinition } from '@shared/presenter'
import { BaseLLMProvider } from '../baseProvider'
import { ConfigPresenter } from '../../configPresenter'
import { HttpsProxyAgent } from 'https-proxy-agent'

// 扩展RequestInit类型以支持agent属性
interface RequestInitWithAgent extends RequestInit {
  agent?: HttpsProxyAgent<string>
}
import { proxyConfig } from '../../proxyConfig'
import { OAuthHelper, GITHUB_COPILOT_OAUTH_CONFIG } from '../oauthHelper'
import { eventBus } from '@/eventbus'
import { CONFIG_EVENTS } from '@/events'

interface CopilotTokenResponse {
  token: string
  expires_at: number
  refresh_in?: number
}

export class GithubCopilotProvider extends BaseLLMProvider {
  private copilotToken: string | null = null
  private tokenExpiresAt: number = 0
  private baseApiUrl = 'https://api.githubcopilot.com'
  private tokenUrl = 'https://api.github.com/copilot_internal/v2/token'
  private oauthHelper: OAuthHelper

  constructor(provider: LLM_PROVIDER, configPresenter: ConfigPresenter) {
    super(provider, configPresenter)
    this.oauthHelper = new OAuthHelper(GITHUB_COPILOT_OAUTH_CONFIG)
    this.init()
  }

  protected async init() {
    if (this.provider.enable) {
      try {
        this.isInitialized = true
        // 始终加载模型列表，不依赖于token状态
        await this.fetchModels()
        await this.autoEnableModelsIfNeeded()
        console.info('GitHub Copilot Provider initialized successfully:', this.provider.name)
      } catch (error) {
        console.warn('GitHub Copilot Provider initialization failed:', this.provider.name, error)
        // 即使初始化失败，也要确保模型列表可用
        try {
          await this.fetchModels()
        } catch (modelError) {
          console.warn('Failed to fetch models after init error:', modelError)
        }
      }
    }
  }

  public onProxyResolved(): void {
    this.init()
  }

  /**
   * 启动OAuth登录流程
   */
  public async startOAuthLogin(): Promise<boolean> {
    try {
      eventBus.emit(CONFIG_EVENTS.OAUTH_LOGIN_START)
      
      // 开始OAuth登录
      const authCode = await this.oauthHelper.startLogin()
      
      // 用授权码交换访问令牌
      const accessToken = await this.exchangeCodeForToken(authCode)
      
      // 保存访问令牌
      this.provider.apiKey = accessToken
      this.configPresenter.setProviderById(this.provider.id, this.provider)
      
      // 验证令牌并初始化
      await this.init()
      
      eventBus.emit(CONFIG_EVENTS.OAUTH_LOGIN_SUCCESS)
      return true
    } catch (error) {
      console.error('OAuth login failed:', error)
      eventBus.emit(CONFIG_EVENTS.OAUTH_LOGIN_ERROR, error instanceof Error ? error.message : 'Unknown error')
      return false
    }
  }

  /**
   * 用授权码交换访问令牌
   */
  private async exchangeCodeForToken(code: string): Promise<string> {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'DeepChat/1.0.0'
      },
      body: JSON.stringify({
        client_id: GITHUB_COPILOT_OAUTH_CONFIG.clientId,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: code,
        redirect_uri: GITHUB_COPILOT_OAUTH_CONFIG.redirectUri
      })
    })

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as { access_token: string; error?: string; error_description?: string }
    if (data.error) {
      throw new Error(`Token exchange error: ${data.error_description || data.error}`)
    }

    return data.access_token
  }

  private async getCopilotToken(): Promise<string> {
    // 检查token是否过期
    if (this.copilotToken && Date.now() < this.tokenExpiresAt) {
      return this.copilotToken
    }

    // 获取新的token
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.provider.apiKey}`,
      'Accept': 'application/json',
      'User-Agent': 'DeepChat/1.0.0',
      'X-GitHub-Api-Version': '2022-11-28'
    }

          const requestOptions: RequestInitWithAgent = {
        method: 'GET',
        headers
      }

      // 添加代理支持
      const proxyUrl = proxyConfig.getProxyUrl()
      if (proxyUrl) {
        const agent = new HttpsProxyAgent(proxyUrl)
        requestOptions.agent = agent
      }

    try {
      const response = await fetch(this.tokenUrl, requestOptions)
      
      if (!response.ok) {
        let errorMessage = `Failed to get Copilot token: ${response.status} ${response.statusText}`
        
        // 提供更具体的错误信息和解决建议
        if (response.status === 404) {
          errorMessage = `GitHub Copilot 访问被拒绝 (404)。请检查：
1. 您的 GitHub 账户是否有有效的 GitHub Copilot 订阅
2. OAuth token 是否有访问 GitHub Copilot 的权限
3. 请访问 https://github.com/features/copilot 检查订阅状态`
        } else if (response.status === 401) {
          errorMessage = `GitHub OAuth token 无效或已过期 (401)。请重新登录授权。`
        } else if (response.status === 403) {
          errorMessage = `GitHub Copilot 访问被禁止 (403)。请检查：
1. 您的 GitHub Copilot 订阅是否有效
2. 是否达到了使用限制
3. OAuth token 是否有正确的权限范围`
        }
        
        throw new Error(errorMessage)
      }

      const data: CopilotTokenResponse = await response.json()
      this.copilotToken = data.token
      this.tokenExpiresAt = data.expires_at * 1000 // 转换为毫秒
      
      return this.copilotToken
    } catch (error) {
      console.error('Error getting Copilot token:', error)
      throw error
    }
  }

  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    // GitHub Copilot 支持的模型列表
    const models: MODEL_META[] = [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 4096,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 16384,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'o1-preview',
        name: 'o1 Preview',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 32768,
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'o1-mini',
        name: 'o1 Mini',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 65536,
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'claude-3-5-sonnet',
        name: 'Claude 3.5 Sonnet',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 200000,
        maxTokens: 8192,
        vision: true,
        functionCall: true,
        reasoning: false
      }
    ]

    return models
  }

  private formatMessages(messages: ChatMessage[]): Array<{ role: string; content: string }> {
    return messages.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    }))
  }

  async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    _modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    tools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent, void, unknown> {
    try {
      const token = await this.getCopilotToken()
      const formattedMessages = this.formatMessages(messages)

      const requestBody = {
        model: modelId,
        messages: formattedMessages,
        temperature: temperature || 0.7,
        max_tokens: maxTokens || 4096,
        stream: true,
        ...(tools && tools.length > 0 && { tools })
      }

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'User-Agent': 'DeepChat/1.0.0',
        'X-GitHub-Api-Version': '2022-11-28'
      }

      const requestOptions: RequestInit = {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      }

      // 添加代理支持
      const proxyUrl = proxyConfig.getProxyUrl()
      if (proxyUrl) {
        const agent = new HttpsProxyAgent(proxyUrl)
        ;(requestOptions as any).agent = agent
      }

      const response = await fetch(`${this.baseApiUrl}/v1/chat/completions`, requestOptions)

      if (!response.ok) {
        throw new Error(`GitHub Copilot API error: ${response.status} ${response.statusText}`)
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmedLine = line.trim()
            if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue

            const data = trimmedLine.slice(6)
            if (data === '[DONE]') return

            try {
              const parsed = JSON.parse(data)
              const choice = parsed.choices?.[0]
              if (!choice) continue

              const delta = choice.delta
              if (delta?.content) {
                yield {
                  type: 'text',
                  content: delta.content
                }
              }

              // 处理工具调用
              if (delta?.tool_calls) {
                for (const toolCall of delta.tool_calls) {
                  if (toolCall.function?.name) {
                    yield {
                      type: 'tool_call_start',
                      tool_call_id: toolCall.id,
                      tool_call_name: toolCall.function.name
                    }
                  }
                  if (toolCall.function?.arguments) {
                    yield {
                      type: 'tool_call_chunk',
                      tool_call_id: toolCall.id,
                      tool_call_arguments_chunk: toolCall.function.arguments
                    }
                  }
                }
              }

              // 处理推理内容（对于o1模型）
              if (delta?.reasoning) {
                yield {
                  type: 'reasoning',
                  reasoning_content: delta.reasoning
                }
              }

            } catch (parseError) {
              console.warn('Failed to parse SSE data:', parseError)
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

    } catch (error) {
      console.error('GitHub Copilot stream error:', error)
      throw error
    }
  }

  async completions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    try {
      const token = await this.getCopilotToken()
      const formattedMessages = this.formatMessages(messages)

      const requestBody = {
        model: modelId,
        messages: formattedMessages,
        temperature: temperature || 0.7,
        max_tokens: maxTokens || 4096,
        stream: false
      }

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'DeepChat/1.0.0',
        'X-GitHub-Api-Version': '2022-11-28'
      }

      const requestOptions: RequestInit = {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      }

      // 添加代理支持
      const proxyUrl = proxyConfig.getProxyUrl()
      if (proxyUrl) {
        const agent = new HttpsProxyAgent(proxyUrl)
        ;(requestOptions as any).agent = agent
      }

      const response = await fetch(`${this.baseApiUrl}/v1/chat/completions`, requestOptions)

      if (!response.ok) {
        throw new Error(`GitHub Copilot API error: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      const choice = data.choices?.[0]
      
      if (!choice) {
        throw new Error('No response from GitHub Copilot')
      }

      const result: LLMResponse = {
        content: choice.message?.content || ''
      }

      // 处理推理内容（对于o1模型）
      if (choice.message?.reasoning) {
        result.reasoning_content = choice.message.reasoning
      }

      return result

    } catch (error) {
      console.error('GitHub Copilot completion error:', error)
      throw error
    }
  }

  async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return this.completions(
      [
        {
          role: 'user',
          content: `请总结以下内容，使用简洁的语言，突出重点：\n${text}`
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
  }

  async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return this.completions(
      [
        {
          role: 'user',
          content: prompt
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
  }

  async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      // 检查是否有 API Key
      if (!this.provider.apiKey || !this.provider.apiKey.trim()) {
        return {
          isOk: false,
          errorMsg: '请先使用 GitHub OAuth 登录以获取访问令牌'
        }
      }

      await this.getCopilotToken()
      return { isOk: true, errorMsg: null }
    } catch (error) {
      let errorMsg = error instanceof Error ? error.message : 'Unknown error'
      
      // 如果是网络错误，提供更友好的提示
      if (errorMsg.includes('fetch failed') || errorMsg.includes('network')) {
        errorMsg = `网络连接失败。请检查：
1. 网络连接是否正常
2. 代理设置是否正确
3. 防火墙是否阻止了 GitHub API 访问`
      }
      
      return { 
        isOk: false, 
        errorMsg 
      }
    }
  }

  async summaryTitles(messages: ChatMessage[], modelId: string): Promise<string> {
    try {
      const response = await this.completions(
        [
          ...messages,
          {
            role: 'user',
            content: '请为这次对话生成一个简洁的标题，不超过10个字，直接返回标题内容，不要包含引号或其他格式。'
          }
        ],
        modelId,
        0.7,
        50
      )
      return response.content.trim()
    } catch (error) {
      console.error('Error generating summary title:', error)
      return '新对话'
    }
  }
} 