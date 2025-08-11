import { LLM_PROVIDER, LLMResponse, ChatMessage, KeyStatus } from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'
import { ConfigPresenter } from '../../configPresenter'

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

// Define interface for ModelScope MCP server
interface ModelScopeMcpServer {
  name: string
  description: string
  id: string
  logo_url: string
  publisher: string
  tags: string[]
  view_count: number
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
  constructor(provider: LLM_PROVIDER, configPresenter: ConfigPresenter) {
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
   * Sync MCP servers from ModelScope API
   * @param options - Sync options including filters
   * @returns Promise<ModelScopeMcpServerResponse> MCP servers response
   */
  public async syncMcpServers(options?: {
    filter?: {
      category?: string
      is_hosted?: boolean
      tag?: string
    }
    page_number?: number
    page_size?: number
    search?: string
  }): Promise<ModelScopeMcpServerResponse> {
    if (!this.provider.apiKey) {
      throw new Error('API key is required for MCP sync')
    }

    const defaultOptions = {
      filter: {},
      page_number: 1,
      page_size: 50,
      search: '',
      ...options
    }

    try {
      const response = await fetch('https://www.modelscope.cn/openapi/v1/mcp/servers', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.provider.apiKey}`
        },
        body: JSON.stringify(defaultOptions)
      })

      if (!response.ok) {
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
        `Successfully synced ${data.data.mcp_server_list.length} MCP servers from ModelScope`
      )
      return data
    } catch (error) {
      console.error('ModelScope MCP sync error:', error)
      throw error
    }
  }

  /**
   * Convert ModelScope MCP server to internal MCP server config format
   * @param mcpServer - ModelScope MCP server data
   * @returns Internal MCP server config
   */
  public convertMcpServerToConfig(mcpServer: ModelScopeMcpServer) {
    return {
      name: mcpServer.locales.zh.name || mcpServer.name,
      description: mcpServer.locales.zh.description || mcpServer.description,
      package: mcpServer.id,
      version: 'latest',
      type: 'npm' as const,
      args: [],
      env: {},
      enabled: false,
      source: 'modelscope' as const,
      logo_url: mcpServer.logo_url,
      publisher: mcpServer.publisher,
      tags: mcpServer.tags,
      view_count: mcpServer.view_count
    }
  }
}
