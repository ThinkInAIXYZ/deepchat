import { IConfigPresenter, MCPServerConfig } from '@shared/presenter'

type McpRouterListResponse = {
  code: number
  message: string
  data?: {
    servers: Array<{
      uuid: string
      created_at: string
      updated_at: string
      name: string
      author_name: string
      title: string
      description: string
      content?: string
      server_key: string
      config_name?: string
      server_url?: string
    }>
  }
}

type McpRouterGetResponse = {
  code: number
  message: string
  data?: {
    created_at: string
    updated_at: string
    name: string
    author_name: string
    title: string
    description: string
    content?: string
    server_key: string
    config_name: string
    server_url: string
  }
}

const LIST_ENDPOINT = 'https://api.mcprouter.to/v1/list-servers'
const GET_ENDPOINT = 'https://api.mcprouter.to/v1/get-server'

export class McpRouterManager {
  constructor(private readonly configPresenter: IConfigPresenter) {}

  private getCommonHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'HTTP-Referer': 'deepchatai.cn',
      'X-Title': 'DeepChat'
    }
  }

  async listServers(page: number, limit: number): Promise<McpRouterListResponse['data']> {
    const res = await fetch(LIST_ENDPOINT, {
      method: 'POST',
      headers: this.getCommonHeaders(),
      body: JSON.stringify({ page, limit })
    })
    if (!res.ok) throw new Error(`McpRouter list failed: HTTP ${res.status}`)
    const json = (await res.json()) as McpRouterListResponse
    if (json.code !== 0) throw new Error(json.message || 'List servers error')
    return json.data || { servers: [] }
  }

  async getServer(serverKey: string): Promise<McpRouterGetResponse['data']> {
    const apiKey = this.configPresenter.getSetting<string>('mcprouterApiKey') || ''
    if (!apiKey) throw new Error('McpRouter API key missing')
    const headers = {
      ...this.getCommonHeaders(),
      Authorization: `Bearer ${apiKey}`
    }
    const res = await fetch(GET_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ server: serverKey })
    })
    if (!res.ok) throw new Error(`McpRouter get failed: HTTP ${res.status}`)
    const json = (await res.json()) as McpRouterGetResponse
    if (json.code !== 0 || !json.data) throw new Error(json.message || 'Get server error')
    return json.data
  }

  private pickRandomEmoji(): string {
    const emojis = ['🧩', '🛠️', '⚙️', '🚀', '🔧', '🧪', '📦', '🛰️', '🧠', '🔌', '📡', '🗂️']
    const idx = Math.floor(Math.random() * emojis.length)
    return emojis[idx]
  }

  /**
   * Install a server from McpRouter to local MCP config as HTTP (Streamable) server
   */
  async installServer(serverKey: string): Promise<boolean> {
    const detail = await this.getServer(serverKey)
    if (!detail) throw new Error('Server detail not found')

    const apiKey = this.configPresenter.getSetting<string>('mcprouterApiKey') || ''
    if (!apiKey) throw new Error('McpRouter API key missing')

    // Build MCPServerConfig
    const config: MCPServerConfig = {
      command: '',
      args: [],
      env: {},
      descriptions: detail.description || detail.title || detail.name,
      icons: this.pickRandomEmoji(),
      autoApprove: ['all'],
      disable: false,
      type: 'http',
      baseUrl: detail.server_url,
      customHeaders: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'deepchatai.cn',
        'X-Title': 'DeepChat'
      },
      source: 'mcprouter',
      sourceId: serverKey
    }

    const serverName = detail.config_name || detail.server_key || detail.name
    return await this.configPresenter.addMcpServer(serverName, config)
  }
}
