import type { ProviderSettingsPort } from '@/provider/settings'
import logger from '@shared/logger'
import type { LLMResponse } from '@shared/types/provider'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { MCPToolDefinition } from '@shared/types/mcp'
import type {
  LLM_PROVIDER,
  MODEL_META,
  ModelConfig,
  ProviderStreamOptions
} from '@shared/types/provider'
import {
  BaseLLMProvider,
  SUMMARY_TITLES_PROMPT,
  type ProviderGenerateTextOptions
} from '../baseProvider'
import { normalizeToolInputSchema } from '../aiSdk/toolMapper'
import type { ProviderLocalePort } from '../ports'
import {
  createGitHubCopilotHttpError,
  getGitHubCopilotToken,
  GITHUB_COPILOT_CHAT_HEADERS
} from '../../provider/auth/githubCopilotDeviceFlow'

export class GithubCopilotProvider extends BaseLLMProvider {
  private copilotToken: string | null = null
  private tokenExpiresAt: number = 0
  private baseApiUrl = 'https://api.githubcopilot.com'

  constructor(
    provider: LLM_PROVIDER,
    providerSettings: ProviderSettingsPort,
    locale: ProviderLocalePort
  ) {
    super(provider, providerSettings, locale)
    this.init()
  }

  protected async init() {
    if (this.provider.enable) {
      this.isInitialized = true
    }
  }

  public onProxyResolved(): void {
    this.init()
  }

  public override updateConfig(provider: LLM_PROVIDER): void {
    super.updateConfig(provider)
    this.copilotToken = null
    this.tokenExpiresAt = 0
  }

  private async getCopilotToken(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    if (this.copilotToken && Date.now() < this.tokenExpiresAt) {
      return this.copilotToken
    }

    const provider = this.provider
    const data = await getGitHubCopilotToken(provider.apiKey, signal)
    signal?.throwIfAborted()
    if (this.provider.apiKey !== provider.apiKey) {
      throw new Error('GitHub Copilot configuration changed during token exchange. Please retry.')
    }
    if (this.provider === provider) {
      this.copilotToken = data.token
      this.tokenExpiresAt = data.expires_at * 1000
    }
    return data.token
  }

  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    // Try to get models from publicdb first
    const dbModels = this.providerSettings.getDbProviderModels(this.provider.id)
    if (dbModels.length > 0) {
      // Convert RENDERER_MODEL_META to MODEL_META format
      return dbModels.map((m) => ({
        id: m.id,
        name: m.name,
        group: m.group,
        providerId: m.providerId,
        isCustom: m.isCustom
      }))
    }

    // Fallback to hardcoded models if publicdb doesn't have copilot models yet
    console.warn(
      `[GitHub Copilot] No models found in publicdb for provider ${this.provider.id}, using fallback models`
    )

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

  private formatMessages(messages: ChatMessage[]): Array<{
    role: string
    content: string
    tool_calls?: ChatMessage['tool_calls']
    reasoning_content?: string
  }> {
    return messages.map((msg) => {
      const formatted: {
        role: string
        content: string
        tool_calls?: ChatMessage['tool_calls']
        reasoning_content?: string
      } = {
        role: msg.role,
        content:
          typeof msg.content === 'string'
            ? msg.content
            : msg.content === undefined
              ? ''
              : JSON.stringify(msg.content)
      }

      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        formatted.tool_calls = msg.tool_calls
      }

      if (
        msg.role === 'assistant' &&
        Object.prototype.hasOwnProperty.call(msg, 'reasoning_content')
      ) {
        formatted.reasoning_content = msg.reasoning_content ?? ''
      }

      return formatted
    })
  }

  async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    _maxTokens: number,
    tools: MCPToolDefinition[],
    options?: ProviderStreamOptions
  ): AsyncGenerator<LLMCoreStreamEvent, void, unknown> {
    if (!modelId) throw new Error('Model ID is required')
    const { signal, dispose } = this.createModelRequestSignal(modelConfig, options?.signal)
    try {
      const token = await this.getCopilotToken(signal)
      const formattedMessages = this.formatMessages(messages)
      const providerTools = tools.map((tool) => ({
        type: tool.type,
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: normalizeToolInputSchema(tool.raw?.inputSchema ?? tool.function.parameters)
        }
      }))

      const requestBody = {
        intent: true,
        n: 1,
        model: modelId,
        messages: formattedMessages,
        stream: true,
        temperature: temperature ?? 0.7,
        max_tokens: _maxTokens || 4096,
        ...(providerTools.length > 0 && { tools: providerTools })
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...GITHUB_COPILOT_CHAT_HEADERS
      }

      // 添加详细的请求日志
      logger.info('📤 [GitHub Copilot] Sending stream request:')
      logger.info(`   URL: ${this.baseApiUrl}/chat/completions`)
      logger.info(`   Model: ${modelId}`)
      logger.info(`   Headers: ${Object.keys(headers).join(', ')}`)
      logger.info(
        `   Request Body: { messages: ${formattedMessages.length}, model: "${modelId}", temperature: ${temperature}, max_tokens: ${_maxTokens} }`
      )

      const requestOptions: RequestInit = {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        ...(signal ? { signal } : {})
      }

      await this.emitRequestTrace(modelConfig, {
        endpoint: `${this.baseApiUrl}/chat/completions`,
        headers,
        body: requestBody
      })

      const response = await this.fetchProvider(
        `${this.baseApiUrl}/chat/completions`,
        requestOptions
      )

      logger.info('📥 [GitHub Copilot] Stream API Response:')
      logger.info(`   Status: ${response.status} ${response.statusText}`)
      logger.info(`   OK: ${response.ok}`)

      if (!response.ok) {
        throw await createGitHubCopilotHttpError(response, 'chat', [token, this.provider.apiKey])
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
            if (data === '[DONE]') {
              yield { type: 'stop', stop_reason: 'complete' }
              return
            }

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
      signal?.throwIfAborted()
      console.error('GitHub Copilot stream error:', error)
      throw error
    } finally {
      dispose()
    }
  }

  async completions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    _maxTokens?: number,
    callerSignal?: AbortSignal
  ): Promise<LLMResponse> {
    if (!modelId) throw new Error('Model ID is required')
    const modelConfig = this.providerSettings.getModelConfig(modelId, this.provider.id)
    const { signal, dispose } = this.createModelRequestSignal(modelConfig, callerSignal)
    try {
      const token = await this.getCopilotToken(signal)
      const formattedMessages = this.formatMessages(messages)

      const requestBody = {
        intent: true,
        n: 1,
        model: modelId,
        messages: formattedMessages,
        max_tokens: _maxTokens || 4096,
        stream: false,
        temperature: temperature ?? 0.7
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...GITHUB_COPILOT_CHAT_HEADERS
      }

      // 添加详细的请求日志
      logger.info('📤 [GitHub Copilot] Sending completion request:')
      logger.info(`   URL: ${this.baseApiUrl}/chat/completions`)
      logger.info(`   Model: ${modelId}`)
      logger.info(`   Headers: ${Object.keys(headers).join(', ')}`)
      logger.info(
        `   Request Body: { messages: ${formattedMessages.length}, model: "${modelId}", temperature: ${temperature}, max_tokens: ${_maxTokens} }`
      )

      const requestOptions: RequestInit = {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        ...(signal ? { signal } : {})
      }

      const response = await this.fetchProvider(
        `${this.baseApiUrl}/chat/completions`,
        requestOptions
      )

      logger.info('📥 [GitHub Copilot] Completion API Response:')
      logger.info(`   Status: ${response.status} ${response.statusText}`)
      logger.info(`   OK: ${response.ok}`)

      if (!response.ok) {
        throw await createGitHubCopilotHttpError(response, 'chat', [token, this.provider.apiKey])
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
      signal?.throwIfAborted()
      console.error('GitHub Copilot completion error:', error)
      throw error
    } finally {
      dispose()
    }
  }

  async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    if (!modelId) throw new Error('Model ID is required')
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
    maxTokens?: number,
    options?: ProviderGenerateTextOptions
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
      maxTokens,
      options?.signal
    )
  }

  async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      await this.getCopilotToken()
      return { isOk: true, errorMsg: null }
    } catch (error) {
      return {
        isOk: false,
        errorMsg: error instanceof Error ? error.message : 'Unknown error'
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
