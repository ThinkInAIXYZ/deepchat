import type { LLM_PROVIDER, MCPServerConfig, ModelScopeMcpSyncOptions } from '@shared/presenter'

export interface ModelScopeMcpServerResponse {
  code: number
  data: {
    mcp_server_list: ModelScopeMcpServer[]
    total_count: number
  }
  message: string
  request_id: string
  success: boolean
}

export interface ModelScopeMcpServer {
  name: string
  description: string
  id: string
  chinese_name?: string
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

export async function fetchModelScopeMcpServers(
  provider: Pick<LLM_PROVIDER, 'apiKey'>,
  _syncOptions?: ModelScopeMcpSyncOptions
): Promise<ModelScopeMcpServerResponse> {
  if (!provider.apiKey) {
    throw new Error('API key is required for MCP sync')
  }

  const response = await fetch('https://www.modelscope.cn/openapi/v1/mcp/servers/operational', {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`
    },
    signal: AbortSignal.timeout(30000)
  })

  if (response.status === 401 || response.status === 403) {
    throw new Error('ModelScope MCP sync unauthorized: Invalid or expired API key')
  }

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

  return data
}

export function convertModelScopeMcpServerToConfig(
  mcpServer: ModelScopeMcpServer
): MCPServerConfig {
  if (!mcpServer.operational_urls || mcpServer.operational_urls.length === 0) {
    throw new Error(`No operational URLs found for server ${mcpServer.id}`)
  }

  const baseUrl = mcpServer.operational_urls[0].url
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
    '🔬',
    '📱',
    '💻',
    '🖥️',
    '⌨️',
    '🖱️',
    '📡',
    '📣',
    '🔔',
    '📻',
    '📷',
    '🔍',
    '💰',
    '🎮',
    '📝',
    '📊',
    '📦',
    '✉️',
    '🗞️',
    '🔖'
  ]
  const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)]
  const displayName = mcpServer.chinese_name || mcpServer.name || mcpServer.id

  return {
    command: '',
    args: [],
    env: {},
    descriptions:
      mcpServer.locales?.zh?.description ||
      mcpServer.description ||
      `ModelScope MCP Server: ${displayName}`,
    icons: randomEmoji,
    autoApprove: ['all'],
    enabled: false,
    disable: false,
    type: 'sse',
    baseUrl,
    source: 'modelscope',
    sourceId: mcpServer.id
  }
}
