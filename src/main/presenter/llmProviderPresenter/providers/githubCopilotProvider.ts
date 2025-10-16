import {
  LLM_PROVIDER,
  LLMResponse,
  MODEL_META,
  ChatMessage,
  LLMCoreStreamEvent,
  ModelConfig,
  MCPToolDefinition
} from '@shared/presenter'
import { BaseLLMProvider, SUMMARY_TITLES_PROMPT } from '../baseProvider'
import { ConfigPresenter } from '../../configPresenter'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { getGlobalGitHubCopilotDeviceFlow, GitHubCopilotDeviceFlow } from '../../githubCopilotDeviceFlow'

// 扩展RequestInit类型以支持agent属性
interface RequestInitWithAgent extends RequestInit {
  agent?: HttpsProxyAgent<string>
}
import { proxyConfig } from '../../proxyConfig'

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
  private deviceFlow: GitHubCopilotDeviceFlow | null = null

  constructor(provider: LLM_PROVIDER, configPresenter: ConfigPresenter) {
    super(provider, configPresenter)
    this.init()
  }

  protected async init() {
    if (this.provider.enable) {
      try {
        this.isInitialized = true
        this.deviceFlow = getGlobalGitHubCopilotDeviceFlow()

        // 检查现有认证状态
        if (this.provider.apiKey) {
          const existingToken = await this.deviceFlow.checkExistingAuth(this.provider.apiKey)
          if (!existingToken) {
            this.provider.apiKey = ''
          }
        }

        await this.fetchModels()
        await this.autoEnableModelsIfNeeded()
        console.log(`[GitHub Copilot] Initialized successfully`)
      } catch (error) {
        console.warn(`[GitHub Copilot] Initialization failed:`, error)
        try {
          await this.fetchModels()
        } catch (modelError) {
          console.warn(`[GitHub Copilot] Failed to fetch models:`, modelError)
        }
      }
    }
  }

  public onProxyResolved(): void {
    this.init()
  }

  private async getCopilotToken(): Promise<string> {
    // 优先使用设备流获取 token
    if (this.deviceFlow) {
      try {
        return await this.deviceFlow.getApiToken()
      } catch (error) {
        console.warn('[GitHub Copilot] Device flow failed, using provider API key')
      }
    }

    // 检查token是否过期
    if (this.copilotToken && Date.now() < this.tokenExpiresAt) {
      return this.copilotToken
    }

    if (!this.provider.apiKey) {
      throw new Error('No GitHub OAuth token available. Please use device flow authentication.')
    }

    // 获取新的token
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.provider.apiKey}`,
      Accept: 'application/json',
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
2. OAuth token 权限不足 - 需要 'read:org' 权限访问 Copilot API
3. 请重新进行 OAuth 登录以获取正确的权限范围
4. 访问 https://github.com/features/copilot 检查订阅状态`
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

      const data: CopilotTokenResponse = await response.json()
      this.copilotToken = data.token
      this.tokenExpiresAt = data.expires_at * 1000 // 转换为毫秒

      return this.copilotToken
    } catch (error) {
      console.error('[GitHub Copilot] Error getting Copilot token:', error)
      throw error
    }
  }

  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    // GitHub Copilot 支持的模型列表
    const models: MODEL_META[] = [
      {
        id: 'gpt-5',
        name: 'GPT-5',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 8192,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'gpt-5-mini',
        name: 'GPT-5 mini',
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
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 64000,
        maxTokens: 4096,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      // {
      //   id: 'gpt-5-codex-preview',
      //   name: 'GPT-5-Codex (Preview)',
      //   group: 'GitHub Copilot',
      //   providerId: this.provider.id,
      //   isCustom: false,
      //   contextLength: 128000,
      //   maxTokens: 8192,
      //   vision: false,
      //   functionCall: true,
      //   reasoning: false
      // },
      // {
      //   id: 'grok-code-fast-1-preview',
      //   name: 'Grok Code Fast 1 (Preview)',
      //   group: 'GitHub Copilot',
      //   providerId: this.provider.id,
      //   isCustom: false,
      //   contextLength: 64000,
      //   maxTokens: 4096,
      //   vision: false,
      //   functionCall: true,
      //   reasoning: false
      // },
      // {
      //   id: 'o4-mini-preview',
      //   name: 'o4-mini (Preview)',
      //   group: 'GitHub Copilot',
      //   providerId: this.provider.id,
      //   isCustom: false,
      //   contextLength: 128000,
      //   maxTokens: 65536,
      //   vision: false,
      //   functionCall: false,
      //   reasoning: true
      // },
      {
        id: 'gpt-4o-2024-05-13',
        name: 'GPT-4o',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 64000,
        maxTokens: 4096,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'gpt-4',
        name: 'GPT-4',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 32768,
        maxTokens: 4096,
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'gpt-3.5-turbo',
        name: 'GPT-3.5 Turbo',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 12288,
        maxTokens: 4096,
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'o1',
        name: 'o1',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 20000,
        maxTokens: 32768,
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'o3-mini',
        name: 'o3-mini',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 64000,
        maxTokens: 65536,
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'claude-sonnet-4',
        name: 'Claude Sonnet 4',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 200000,
        maxTokens: 8192,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'claude-sonnet-4.5',
        name: 'Claude Sonnet 4.5',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 200000,
        maxTokens: 8192,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'claude-3.5-sonnet',
        name: 'Claude Sonnet 3.5',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 200000,
        maxTokens: 8192,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'claude-3.7-sonnet',
        name: 'Claude Sonnet 3.7',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 90000,
        maxTokens: 8192,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'claude-3.7-sonnet-thought',
        name: 'Claude Sonnet 3.7 Thinking',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 90000,
        maxTokens: 8192,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 8192,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'gemini-2.0-flash-001',
        name: 'Gemini 2.0 Flash',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 8192,
        vision: true,
        functionCall: true,
        reasoning: false
      }
    ]

    return models
  }

  private formatMessages(messages: ChatMessage[]): Array<{ role: string; content: string }> {
    return messages.map((msg) => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    }))
  }

  async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    _modelConfig: ModelConfig,
    temperature: number,
    _maxTokens: number,
    tools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent, void, unknown> {
    try {
      const token = await this.getCopilotToken()
      const formattedMessages = this.formatMessages(messages)

      const requestBody = {
        intent: true,
        n: 1,
        stream: true,
        temperature: temperature || 0.7,
        model: modelId,
        messages: formattedMessages,
        ...(tools && tools.length > 0 && { tools })
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'User-Agent': 'DeepChat/1.0.0',
        'Editor-Version': 'DeepChat/1.0.0',
        'Copilot-Integration-Id': 'vscode-chat'
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

      const response = await fetch(`${this.baseApiUrl}/chat/completions`, requestOptions)

      if (!response.ok) {
        let errorBody = ''
        try {
          errorBody = await response.text()
        } catch (e) {
          // ignore
        }
        throw new Error(`GitHub Copilot API error: ${response.status} ${response.statusText} - ${errorBody}`)
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
    _maxTokens?: number
  ): Promise<LLMResponse> {
    try {
      const token = await this.getCopilotToken()
      const formattedMessages = this.formatMessages(messages)

      const requestBody = {
        intent: true,
        n: 1,
        stream: false,
        temperature: temperature || 0.7,
        model: modelId,
        messages: formattedMessages
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'DeepChat/1.0.0',
        'Editor-Version': 'DeepChat/1.0.0',
        'Copilot-Integration-Id': 'vscode-chat'
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

      const response = await fetch(`${this.baseApiUrl}/chat/completions`, requestOptions)

      if (!response.ok) {
        let errorBody = ''
        try {
          errorBody = await response.text()
        } catch (e) {
          // ignore
        }
        throw new Error(`GitHub Copilot API error: ${response.status} ${response.statusText} - ${errorBody}`)
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

      // 分析错误类型并提供更具体的建议
      if (errorMsg.includes('404')) {
        errorMsg = `GitHub Copilot 访问被拒绝 (404)。请检查：
1. 您的 GitHub 账户是否有有效的 GitHub Copilot 订阅
2. 访问 https://github.com/features/copilot 检查订阅状态
3. 如果是组织账户，请确保组织已启用 Copilot 并且您有访问权限`
      } else if (errorMsg.includes('401')) {
        errorMsg = `GitHub OAuth token 无效或已过期 (401)。请重新登录授权并确保获取了正确的权限范围。`
      } else if (errorMsg.includes('403')) {
        errorMsg = `GitHub Copilot 访问被禁止 (403)。请检查：
1. 您的 GitHub Copilot 订阅是否有效且处于活跃状态
2. 是否达到了 API 使用限制
3. OAuth token 是否包含 'read:org' 权限范围
4. 如果是组织账户，请确保组织已启用 Copilot 并且您有访问权限`
      } else if (errorMsg.includes('fetch failed') || errorMsg.includes('network')) {
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
          {
            role: 'user',
            content: `${SUMMARY_TITLES_PROMPT}\n\n${messages.map((m) => `${m.role}: ${m.content}`).join('\n')}`
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
