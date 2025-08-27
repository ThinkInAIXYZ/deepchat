import {
  LLM_PROVIDER,
  LLMResponse,
  ChatMessage,
  KeyStatus,
  IConfigPresenter
} from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'

// Define interface for ModelScope MCP API response
interface ModelScopeMcpServerResponse {
  code: number
  data: {
    mcp_server_list: ModelScopeMcpServer[]
    total_count: number
  }
  message: string
  request_id: string
  success: boolean
}

// Define interface for ModelScope MCP server (updated for operational API)
interface ModelScopeMcpServer {
  name: string
  description: string
  id: string
  chinese_name?: string // Chinese name field
  logo_url: string
  operational_urls: Array<{
    id: string
    url: string
  }>
  tags: string[]
  locales: {
    zh: {
      name: string
      description: string
    }
    en: {
      name: string
      description: string
    }
  }
}

export class ModelscopeProvider extends OpenAICompatibleProvider {
  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
  }

  async completions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return this.openAICompletion(messages, modelId, temperature, maxTokens)
  }

  async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return this.openAICompletion(
      [
        {
          role: 'user',
          content: `You need to summarize the user's conversation into a title of no more than 10 words, with the title language matching the user's primary language, without using punctuation or other special symbols：\n${text}`
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
    return this.openAICompletion(
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

  /**
   * Get current API key status from ModelScope
   * @returns Promise<KeyStatus> API key status information
   */
  public async getKeyStatus(): Promise<KeyStatus> {
    if (!this.provider.apiKey) {
      throw new Error('API key is required')
    }

    try {
      // Use models endpoint to check API key validity
      const response = await this.openai.models.list({ timeout: 10000 })

      return {
        limit_remaining: 'Available',
        remainNum: response.data?.length || 0
      }
    } catch (error) {
      console.error('ModelScope API key check failed:', error)
      throw new Error(
        `ModelScope API key check failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Override check method to use ModelScope's API validation
   * @returns Promise<{ isOk: boolean; errorMsg: string | null }>
   */
  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      await this.getKeyStatus()
      return { isOk: true, errorMsg: null }
    } catch (error: unknown) {
      let errorMessage = 'An unknown error occurred during ModelScope API key check.'
      if (error instanceof Error) {
        errorMessage = error.message
      } else if (typeof error === 'string') {
        errorMessage = error
      }

      console.error('ModelScope API key check failed:', error)
      return { isOk: false, errorMsg: errorMessage }
    }
  }

  /**
   * Sync operational MCP servers from ModelScope API
   * @param _options - Sync options including filters (currently not used by operational API)
   * @returns Promise<ModelScopeMcpServerResponse> MCP servers response
   */
  public async syncMcpServers(_options?: {
    page_number?: number
    page_size?: number
  }): Promise<ModelScopeMcpServerResponse> {
    if (!this.provider.apiKey) {
      throw new Error('API key is required for MCP sync')
    }

    try {
      // Use the operational API endpoint - GET request, no body needed
      const response = await fetch('https://www.modelscope.cn/openapi/v1/mcp/servers/operational', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.provider.apiKey}`
        },
        signal: AbortSignal.timeout(30000) // 30 second timeout
      })

      // Handle authentication errors
      if (response.status === 401 || response.status === 403) {
        throw new Error('ModelScope MCP sync unauthorized: Invalid or expired API key')
      }

      // Handle server errors
      if (response.status === 500 || !response.ok) {
        const errorText = await response.text()
        throw new Error(
          `ModelScope MCP sync failed: ${response.status} ${response.statusText} - ${errorText}`
        )
      }

      const data: ModelScopeMcpServerResponse = await response.json()

      if (!data.success) {
        throw new Error(`ModelScope MCP sync failed: ${data.message}`)
      }

      console.log(
        `Successfully fetched ${data.data.mcp_server_list.length} operational MCP servers from ModelScope`
      )
      return data
    } catch (error) {
      console.error('ModelScope MCP sync error:', error)
      throw error
    }
  }

  /**
   * Convert ModelScope operational MCP server to internal MCP server config format
   * @param mcpServer - ModelScope MCP server data
   * @returns Internal MCP server config
   */
  public convertMcpServerToConfig(mcpServer: ModelScopeMcpServer) {
    // Check if operational URLs are available
    if (!mcpServer.operational_urls || mcpServer.operational_urls.length === 0) {
      throw new Error(`No operational URLs found for server ${mcpServer.id}`)
    }

    // Use the first operational URL
    const baseUrl = mcpServer.operational_urls[0].url

    // Generate random emoji for icon
    const emojis = [
      '🔧',
      '⚡',
      '🚀',
      '🔨',
      '⚙️',
      '🛠️',
      '🔥',
      '💡',
      '⭐',
      '🎯',
      '🎨',
      '🔮',
      '💎',
      '🎪',
      '🎭',
      '🎨',
      '🔬',
      '📱',
      '💻',
      '🖥️',
      '⌨️',
      '🖱️',
      '📡',
      '🔊',
      '📢',
      '📣',
      '📯',
      '🔔',
      '🔕',
      '📻',
      '📺',
      '📷',
      '📹',
      '🎥',
      '📽️',
      '🔍',
      '🔎',
      '💰',
      '💳',
      '💸',
      '💵',
      '🎲',
      '🃏',
      '🎮',
      '🕹️',
      '🎯',
      '🎳',
      '🎨',
      '🖌️',
      '🖍️',
      '📝',
      '✏️',
      '📏',
      '📐',
      '📌',
      '📍',
      '🗂️',
      '📂',
      '📁',
      '📰',
      '📄',
      '📃',
      '📜',
      '📋',
      '📊',
      '📈',
      '📉',
      '📦',
      '📫',
      '📪',
      '📬',
      '📭',
      '📮',
      '🗳️',
      '✉️',
      '📧',
      '📨',
      '📩',
      '📤',
      '📥',
      '📬',
      '📭',
      '📮',
      '🗂️',
      '📂',
      '📁',
      '🗄️',
      '🗃️',
      '📋',
      '📑',
      '📄',
      '📃',
      '📰',
      '🗞️',
      '📜',
      '🔖'
    ]
    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)]

    // Get display name: chinese_name first, then name, then id
    const displayName = mcpServer.chinese_name || mcpServer.name || mcpServer.id

    return {
      command: '', // Not needed for SSE type
      args: [], // Not needed for SSE type
      env: {},
      descriptions:
        mcpServer.locales?.zh?.description ||
        mcpServer.description ||
        `ModelScope MCP Server: ${displayName}`,
      icons: randomEmoji, // Random emoji instead of URL
      autoApprove: ['all'],
      disable: false, // Default to disabled for safety
      type: 'sse' as const, // SSE type for operational servers
      baseUrl: baseUrl, // Use operational URL
      source: 'modelscope',
      sourceId: mcpServer.id
    }
  }
}
