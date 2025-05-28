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
import { GitHubCopilotDeviceFlow, createGitHubCopilotDeviceFlow } from '../../githubCopilotDeviceFlow'
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
  private deviceFlow: GitHubCopilotDeviceFlow

  constructor(provider: LLM_PROVIDER, configPresenter: ConfigPresenter) {
    super(provider, configPresenter)
    this.oauthHelper = new OAuthHelper(GITHUB_COPILOT_OAUTH_CONFIG)
    this.deviceFlow = createGitHubCopilotDeviceFlow()
    
    console.log('🎯 [GitHub Copilot] Constructor called')
    console.log(`   Base API URL: ${this.baseApiUrl}`)
    console.log(`   Token URL: ${this.tokenUrl}`)
    console.log(`   Provider config:`, {
      id: provider.id,
      name: provider.name,
      enable: provider.enable,
      hasApiKey: !!provider.apiKey,
      apiKeyLength: provider.apiKey?.length || 0
    })
    
    this.init()
  }

  protected async init() {
    console.log('🚀 [GitHub Copilot] Starting provider initialization...')
    console.log(`   Provider enabled: ${this.provider.enable}`)
    console.log(`   Provider name: ${this.provider.name}`)
    console.log(`   Provider ID: ${this.provider.id}`)
    
    if (this.provider.enable) {
      try {
        console.log('📋 [GitHub Copilot] Setting initialized flag...')
        this.isInitialized = true
        
        console.log('📚 [GitHub Copilot] Fetching models list...')
        // 始终加载模型列表，不依赖于token状态
        await this.fetchModels()
        
        console.log('🔧 [GitHub Copilot] Auto-enabling models if needed...')
        await this.autoEnableModelsIfNeeded()
        
        console.info('✅ [GitHub Copilot] Provider initialized successfully:', this.provider.name)
      } catch (error) {
        console.warn('❌ [GitHub Copilot] Provider initialization failed:', this.provider.name, error)
        console.error('   Initialization error details:', error)
        
        // 即使初始化失败，也要确保模型列表可用
        try {
          console.log('🔄 [GitHub Copilot] Trying to fetch models after init error...')
          await this.fetchModels()
          console.log('✅ [GitHub Copilot] Models fetched successfully after init error')
        } catch (modelError) {
          console.warn('❌ [GitHub Copilot] Failed to fetch models after init error:', modelError)
        }
      }
    } else {
      console.log('⏸️ [GitHub Copilot] Provider is disabled, skipping initialization')
    }
  }

  public onProxyResolved(): void {
    this.init()
  }

  /**
   * 启动Device Flow登录流程（推荐）
   */
  public async startDeviceFlowLogin(): Promise<boolean> {
    console.log('🔐 [GitHub Copilot] Starting Device Flow login...')
    
    try {
      console.log('📢 [GitHub Copilot] Emitting OAuth login start event')
      eventBus.emit(CONFIG_EVENTS.OAUTH_LOGIN_START)
      
      console.log('🌐 [GitHub Copilot] Starting Device Flow authentication...')
      // 使用Device Flow进行认证
      const accessToken = await this.deviceFlow.startDeviceFlow()
      console.log(`✅ [GitHub Copilot] Received access token via Device Flow: ${accessToken ? accessToken.substring(0, 20) + '...' : 'NONE'}`)
      
      console.log('💾 [GitHub Copilot] Saving access token to provider config...')
      // 保存访问令牌
      this.provider.apiKey = accessToken
      this.configPresenter.setProviderById(this.provider.id, this.provider)
      
      console.log('🔄 [GitHub Copilot] Re-initializing provider with new token...')
      // 验证令牌并初始化
      await this.init()
      
      console.log('📢 [GitHub Copilot] Emitting OAuth login success event')
      eventBus.emit(CONFIG_EVENTS.OAUTH_LOGIN_SUCCESS)
      
      console.log('✅ [GitHub Copilot] Device Flow login completed successfully!')
      return true
    } catch (error) {
      console.error('❌ [GitHub Copilot] Device Flow login failed:', error)
      console.error('   Error type:', error instanceof Error ? error.constructor.name : typeof error)
      console.error('   Error message:', error instanceof Error ? error.message : error)
      
      eventBus.emit(CONFIG_EVENTS.OAUTH_LOGIN_ERROR, error instanceof Error ? error.message : 'Unknown error')
      return false
    }
  }

  /**
   * 启动OAuth登录流程（传统方式）
   */
  public async startOAuthLogin(): Promise<boolean> {
    console.log('🔐 [GitHub Copilot] Starting OAuth login flow...')
    
    try {
      console.log('📢 [GitHub Copilot] Emitting OAuth login start event')
      eventBus.emit(CONFIG_EVENTS.OAUTH_LOGIN_START)
      
      console.log('🌐 [GitHub Copilot] Starting OAuth helper login process...')
      // 开始OAuth登录
      const authCode = await this.oauthHelper.startLogin()
      console.log(`✅ [GitHub Copilot] Received auth code: ${authCode ? authCode.substring(0, 10) + '...' : 'NONE'}`)
      
      console.log('🔄 [GitHub Copilot] Exchanging auth code for access token...')
      // 用授权码交换访问令牌
      const accessToken = await this.exchangeCodeForToken(authCode)
      console.log(`✅ [GitHub Copilot] Received access token: ${accessToken ? accessToken.substring(0, 20) + '...' : 'NONE'}`)
      
      console.log('💾 [GitHub Copilot] Saving access token to provider config...')
      // 保存访问令牌
      this.provider.apiKey = accessToken
      this.configPresenter.setProviderById(this.provider.id, this.provider)
      
      console.log('🔄 [GitHub Copilot] Re-initializing provider with new token...')
      // 验证令牌并初始化
      await this.init()
      
      console.log('📢 [GitHub Copilot] Emitting OAuth login success event')
      eventBus.emit(CONFIG_EVENTS.OAUTH_LOGIN_SUCCESS)
      
      console.log('✅ [GitHub Copilot] OAuth login completed successfully!')
      return true
    } catch (error) {
      console.error('❌ [GitHub Copilot] OAuth login failed:', error)
      console.error('   Error type:', error instanceof Error ? error.constructor.name : typeof error)
      console.error('   Error message:', error instanceof Error ? error.message : error)
      
      eventBus.emit(CONFIG_EVENTS.OAUTH_LOGIN_ERROR, error instanceof Error ? error.message : 'Unknown error')
      return false
    }
  }

  /**
   * 用授权码交换访问令牌
   */
  private async exchangeCodeForToken(code: string): Promise<string> {
    console.log('🔄 [GitHub Copilot] Starting token exchange...')
    console.log(`   Auth code: ${code ? code.substring(0, 10) + '...' : 'NONE'}`)
    
    const exchangeUrl = 'https://github.com/login/oauth/access_token'
    console.log(`   Exchange URL: ${exchangeUrl}`)
    
    const requestBody = {
      client_id: GITHUB_COPILOT_OAUTH_CONFIG.clientId,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code: code,
      redirect_uri: GITHUB_COPILOT_OAUTH_CONFIG.redirectUri
    }
    
    console.log('📋 [GitHub Copilot] Token exchange request:')
    console.log(`   Client ID: ${requestBody.client_id}`)
    console.log(`   Client Secret: ${requestBody.client_secret ? 'EXISTS (length: ' + requestBody.client_secret.length + ')' : 'NOT SET'}`)
    console.log(`   Code: ${requestBody.code ? requestBody.code.substring(0, 10) + '...' : 'NONE'}`)
    console.log(`   Redirect URI: ${requestBody.redirect_uri}`)
    
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'DeepChat/1.0.0'
    }
    
    console.log('📋 [GitHub Copilot] Request headers:')
    console.log(`   Accept: ${headers.Accept}`)
    console.log(`   Content-Type: ${headers['Content-Type']}`)
    console.log(`   User-Agent: ${headers['User-Agent']}`)
    
    console.log('📤 [GitHub Copilot] Making token exchange request...')
    
    const response = await fetch(exchangeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    })
    
    console.log('📥 [GitHub Copilot] Token exchange response:')
    console.log(`   Status: ${response.status} ${response.statusText}`)
    console.log(`   OK: ${response.ok}`)

    if (!response.ok) {
      console.log('❌ [GitHub Copilot] Token exchange failed!')
      
      // 尝试读取错误响应体
      try {
        const errorBody = await response.text()
        console.log(`   Error body: ${errorBody}`)
      } catch (bodyError) {
        console.log(`   Could not read error body: ${bodyError}`)
      }
      
      throw new Error(`Token exchange failed: ${response.status} ${response.statusText}`)
    }

    console.log('✅ [GitHub Copilot] Token exchange successful, parsing response...')
    const data = await response.json() as { access_token: string; error?: string; error_description?: string }
    
    console.log('📊 [GitHub Copilot] Token exchange response data:')
    console.log(`   Access token: ${data.access_token ? data.access_token.substring(0, 20) + '...' : 'NOT PRESENT'}`)
    console.log(`   Error: ${data.error || 'NONE'}`)
    console.log(`   Error description: ${data.error_description || 'NONE'}`)
    
    if (data.error) {
      console.log('❌ [GitHub Copilot] Token exchange returned error!')
      throw new Error(`Token exchange error: ${data.error_description || data.error}`)
    }

    console.log('✅ [GitHub Copilot] Token exchange completed successfully!')
    return data.access_token
  }

  private async getCopilotToken(): Promise<string> {
    console.log('🔍 [GitHub Copilot] Starting getCopilotToken process...')
    
    // 检查token是否过期
    if (this.copilotToken && Date.now() < this.tokenExpiresAt) {
      console.log('✅ [GitHub Copilot] Using cached token (not expired)')
      console.log(`   Token expires at: ${new Date(this.tokenExpiresAt).toISOString()}`)
      console.log(`   Current time: ${new Date().toISOString()}`)
      return this.copilotToken
    }

    console.log('🔄 [GitHub Copilot] Need to fetch new Copilot token')
    console.log(`   Provider API Key: ${this.provider.apiKey ? 'EXISTS (length: ' + this.provider.apiKey.length + ')' : 'NOT SET'}`)
    console.log(`   Token URL: ${this.tokenUrl}`)

    // 获取新的token
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.provider.apiKey}`,
      'Accept': 'application/json',
      'User-Agent': 'DeepChat/1.0.0',
      'X-GitHub-Api-Version': '2022-11-28'
    }

    console.log('📋 [GitHub Copilot] Request headers:')
    console.log('   Authorization:', headers.Authorization ? `Bearer ${this.provider.apiKey?.substring(0, 10)}...` : 'NOT SET')
    console.log('   Accept:', headers.Accept)
    console.log('   User-Agent:', headers['User-Agent'])
    console.log('   X-GitHub-Api-Version:', headers['X-GitHub-Api-Version'])

    const requestOptions: RequestInitWithAgent = {
      method: 'GET',
      headers
    }

    // 添加代理支持
    const proxyUrl = proxyConfig.getProxyUrl()
    if (proxyUrl) {
      console.log('🌐 [GitHub Copilot] Using proxy:', proxyUrl)
      const agent = new HttpsProxyAgent(proxyUrl)
      requestOptions.agent = agent
    } else {
      console.log('🌐 [GitHub Copilot] No proxy configured')
    }

    console.log('📤 [GitHub Copilot] Making request to GitHub Copilot API...')
    console.log(`   Method: ${requestOptions.method}`)
    console.log(`   URL: ${this.tokenUrl}`)

    try {
      const response = await fetch(this.tokenUrl, requestOptions)
      
      console.log('📥 [GitHub Copilot] Received response:')
      console.log(`   Status: ${response.status} ${response.statusText}`)
      console.log(`   OK: ${response.ok}`)
      console.log('   Response headers:')
      response.headers.forEach((value, key) => {
        console.log(`     ${key}: ${value}`)
      })
      
      if (!response.ok) {
        let errorMessage = `Failed to get Copilot token: ${response.status} ${response.statusText}`
        
        console.log('❌ [GitHub Copilot] Request failed!')
        console.log(`   Error status: ${response.status}`)
        console.log(`   Error text: ${response.statusText}`)
        
        // 尝试读取响应体以获得更多错误信息
        try {
          const errorBody = await response.text()
          console.log(`   Error body: ${errorBody}`)
        } catch (bodyError) {
          console.log(`   Could not read error body: ${bodyError}`)
        }
        
        // 提供更具体的错误信息和解决建议
        if (response.status === 404) {
          errorMessage = `GitHub Copilot 访问被拒绝 (404)。请检查：
1. 您的 GitHub 账户是否有有效的 GitHub Copilot 订阅
2. OAuth token 权限不足 - 需要 'read:org' 权限访问 Copilot API
3. 请重新进行 OAuth 登录以获取正确的权限范围
4. 访问 https://github.com/features/copilot 检查订阅状态

注意：DeepChat 现在需要 'read:user' 和 'read:org' 权限才能访问 GitHub Copilot API。`
        } else if (response.status === 401) {
          errorMessage = `GitHub OAuth token 无效或已过期 (401)。请重新登录授权并确保获取了正确的权限范围。`
        } else if (response.status === 403) {
          errorMessage = `GitHub Copilot 访问被禁止 (403)。请检查：
1. 您的 GitHub Copilot 订阅是否有效且处于活跃状态
2. 是否达到了 API 使用限制
3. OAuth token 是否包含 'read:org' 权限范围
4. 如果是组织账户，请确保组织已启用 Copilot 并且您有访问权限`
        }
        
        throw new Error(errorMessage)
      }

      console.log('✅ [GitHub Copilot] Successfully received response, parsing JSON...')
      const data: CopilotTokenResponse = await response.json()
      
      console.log('📊 [GitHub Copilot] Token response data:')
      console.log(`   Token: ${data.token ? data.token.substring(0, 20) + '...' : 'NOT PRESENT'}`)
      console.log(`   Expires at: ${data.expires_at} (${new Date(data.expires_at * 1000).toISOString()})`)
      console.log(`   Refresh in: ${data.refresh_in || 'N/A'}`)
      
      this.copilotToken = data.token
      this.tokenExpiresAt = data.expires_at * 1000 // 转换为毫秒
      
      console.log('💾 [GitHub Copilot] Token cached successfully')
      return this.copilotToken
    } catch (error) {
      console.error('💥 [GitHub Copilot] Error getting Copilot token:', error)
      console.error('   Error type:', error instanceof Error ? error.constructor.name : typeof error)
      console.error('   Error message:', error instanceof Error ? error.message : error)
      if (error instanceof Error && error.stack) {
        console.error('   Stack trace:', error.stack)
      }
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

      const requestOptions: RequestInitWithAgent = {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      }

      // 添加代理支持
      const proxyUrl = proxyConfig.getProxyUrl()
      if (proxyUrl) {
        const agent = new HttpsProxyAgent(proxyUrl)
        requestOptions.agent = agent
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

      const requestOptions: RequestInitWithAgent = {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      }

      // 添加代理支持
      const proxyUrl = proxyConfig.getProxyUrl()
      if (proxyUrl) {
        const agent = new HttpsProxyAgent(proxyUrl)
        requestOptions.agent = agent
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
    console.log('🔍 [GitHub Copilot] Starting provider check...')
    console.log(`   Provider ID: ${this.provider.id}`)
    console.log(`   Provider Name: ${this.provider.name}`)
    console.log(`   Provider Enabled: ${this.provider.enable}`)
    
    try {
      // 检查是否有 API Key
      console.log('🔑 [GitHub Copilot] Checking API Key...')
      if (!this.provider.apiKey || !this.provider.apiKey.trim()) {
        console.log('❌ [GitHub Copilot] No API Key found')
        return {
          isOk: false,
          errorMsg: '请先使用 GitHub OAuth 登录以获取访问令牌'
        }
      }
      
      console.log(`✅ [GitHub Copilot] API Key exists (length: ${this.provider.apiKey.length})`)
      console.log(`   API Key preview: ${this.provider.apiKey.substring(0, 20)}...`)

      console.log('🎯 [GitHub Copilot] Attempting to get Copilot token (this will test the connection)...')
      await this.getCopilotToken()
      
      console.log('✅ [GitHub Copilot] Provider check successful!')
      return { isOk: true, errorMsg: null }
    } catch (error) {
      console.log('❌ [GitHub Copilot] Provider check failed!')
      console.error('   Error details:', error)
      
      let errorMsg = error instanceof Error ? error.message : 'Unknown error'
      
      // 如果是网络错误，提供更友好的提示
      if (errorMsg.includes('fetch failed') || errorMsg.includes('network')) {
        errorMsg = `网络连接失败。请检查：
1. 网络连接是否正常
2. 代理设置是否正确
3. 防火墙是否阻止了 GitHub API 访问`
      }
      
      console.log(`   Final error message: ${errorMsg}`)
      
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