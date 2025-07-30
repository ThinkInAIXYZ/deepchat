import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import axios from 'axios'

// Schema definitions
const BraveWebSearchArgsSchema = z.object({
  query: z.string().describe('Search query (max 400 chars, 50 words)'),
  count: z.number().optional().default(10).describe('Number of results (1-20, default 10)'),
  offset: z.number().optional().default(0).describe('Pagination offset (max 9, default 0)')
})

const BraveLocalSearchArgsSchema = z.object({
  query: z.string().describe("Local search query (e.g. 'pizza near Central Park')"),
  count: z.number().optional().default(5).describe('Number of results (1-20, default 5)')
})

// 定义Brave Web API返回的数据结构
interface BraveWeb {
  web?: {
    results?: Array<{
      title: string
      description: string
      url: string
      language?: string
      published?: string
      rank?: number
    }>
  }
  locations?: {
    results?: Array<{
      id: string
      title?: string
    }>
  }
}

// 定义Brave Location API返回的数据结构
interface BraveLocation {
  id: string
  name: string
  address: {
    streetAddress?: string
    addressLocality?: string
    addressRegion?: string
    postalCode?: string
  }
  coordinates?: {
    latitude: number
    longitude: number
  }
  phone?: string
  rating?: {
    ratingValue?: number
    ratingCount?: number
  }
  openingHours?: string[]
  priceRange?: string
}

interface BravePoiResponse {
  results: BraveLocation[]
}

interface BraveDescription {
  descriptions: { [id: string]: string }
}

// 限速配置
const RATE_LIMIT = {
  perSecond: 1,
  perMonth: 15000
}

export class BraveSearchServer {
  private server: Server
  private apiKey: string
  private requestCount = {
    second: 0,
    month: 0,
    lastReset: Date.now()
  }

  constructor(env?: Record<string, unknown>) {
    if (!env?.apiKey) {
      throw new Error('需要提供Brave API Key')
    }
    this.apiKey = env.apiKey as string

    // 创建服务器实例
    this.server = new Server(
      {
        name: 'deepchat-inmemory/brave-search-server',
        version: '0.1.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )

    // 设置请求处理器
    this.setupRequestHandlers()
  }

  // 启动服务器
  public startServer(transport: Transport): void {
    this.server.connect(transport)
  }

  // 检查限速
  private checkRateLimit() {
    const now = Date.now()
    if (now - this.requestCount.lastReset > 1000) {
      this.requestCount.second = 0
      this.requestCount.lastReset = now
    }
    if (
      this.requestCount.second >= RATE_LIMIT.perSecond ||
      this.requestCount.month >= RATE_LIMIT.perMonth
    ) {
      throw new Error('限速已超出')
    }
    this.requestCount.second++
    this.requestCount.month++
  }

  // 执行Web搜索
  private async performWebSearch(query: string, count: number = 10, offset: number = 0) {
    this.checkRateLimit()

    try {
      const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
        params: {
          q: query,
          count: Math.min(count, 20).toString(), // API限制
          offset: offset.toString()
        },
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.apiKey
        }
      })

      const data = response.data as BraveWeb

      // 提取web结果
      const results = (data.web?.results || []).map((result) => ({
        title: result.title || '',
        description: result.description || '',
        url: result.url || ''
      }))

      return results.map((r, index) => {
        // 构建blob内容
        const blobContent = {
          title: r.title,
          url: r.url,
          rank: index + 1,
          content: r.description
        }

        return {
          type: 'resource',
          resource: {
            uri: r.url,
            mimeType: 'application/deepchat-webpage',
            text: JSON.stringify(blobContent)
          }
        }
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Brave Web搜索出错: ${errorMessage}`)
    }
  }

  // 执行本地搜索
  private async performLocalSearch(query: string, count: number = 5) {
    this.checkRateLimit()

    try {
      // 初始搜索获取位置ID
      const webResponse = await axios.get('https://api.search.brave.com/res/v1/web/search', {
        params: {
          q: query,
          search_lang: 'en',
          result_filter: 'locations',
          count: Math.min(count, 20).toString()
        },
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.apiKey
        }
      })

      const webData = webResponse.data as BraveWeb
      const locationIds =
        webData.locations?.results
          ?.filter((r): r is { id: string; title?: string } => r.id != null)
          .map((r) => r.id) || []

      if (locationIds.length === 0) {
        // 如果没有本地结果，回退到Web搜索
        return await this.performWebSearch(query, count)
      }

      // 获取POI详情和描述
      const [poisData, descriptionsData] = await Promise.all([
        this.getPoisData(locationIds),
        this.getDescriptionsData(locationIds)
      ])

      // 格式化结果为MCP资源格式
      return poisData.results.map((poi, index) => {
        const address =
          [
            poi.address?.streetAddress ?? '',
            poi.address?.addressLocality ?? '',
            poi.address?.addressRegion ?? '',
            poi.address?.postalCode ?? ''
          ]
            .filter((part) => part !== '')
            .join(', ') || 'N/A'

        const blobContent = {
          title: poi.name,
          address: address,
          phone: poi.phone || 'N/A',
          rating: `${poi.rating?.ratingValue ?? 'N/A'} (${poi.rating?.ratingCount ?? 0} reviews)`,
          priceRange: poi.priceRange || 'N/A',
          hours: (poi.openingHours || []).join(', ') || 'N/A',
          description: descriptionsData.descriptions[poi.id] || 'No description available',
          rank: index + 1
        }

        // 使用POI的唯一标识符作为URI
        return {
          type: 'resource',
          resource: {
            uri: `brave-local://${poi.id}`,
            mimeType: 'application/deepchat-local-business',
            text: JSON.stringify(blobContent)
          }
        }
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Brave Local搜索出错: ${errorMessage}`)
    }
  }

  // 获取POI数据
  private async getPoisData(ids: string[]): Promise<BravePoiResponse> {
    this.checkRateLimit()

    const url = new URL('https://api.search.brave.com/res/v1/local/pois')
    ids.filter(Boolean).forEach((id) => url.searchParams.append('ids', id))

    const response = await axios.get(url.toString(), {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.apiKey
      }
    })

    if (response.status !== 200) {
      throw new Error(`Brave API错误: ${response.status} ${response.statusText}`)
    }

    return response.data as BravePoiResponse
  }

  // 获取描述数据
  private async getDescriptionsData(ids: string[]): Promise<BraveDescription> {
    this.checkRateLimit()

    const url = new URL('https://api.search.brave.com/res/v1/local/descriptions')
    ids.filter(Boolean).forEach((id) => url.searchParams.append('ids', id))

    const response = await axios.get(url.toString(), {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.apiKey
      }
    })

    if (response.status !== 200) {
      throw new Error(`Brave API错误: ${response.status} ${response.statusText}`)
    }

    return response.data as BraveDescription
  }

  // 设置请求处理器
  private setupRequestHandlers(): void {
    // 设置工具列表处理器
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'brave_web_search',
            description:
              'Performs a web search using the Brave Search API, ideal for general queries, news, articles, and online content. ' +
              'Use this for broad information gathering, recent events, or when you need diverse web sources. ' +
              'Supports pagination, content filtering, and freshness controls. ' +
              'Maximum 20 results per request, with offset for pagination. ',
            inputSchema: zodToJsonSchema(BraveWebSearchArgsSchema)
          },
          {
            name: 'brave_local_search',
            description:
              "Searches for local businesses and places using Brave's Local Search API. " +
              'Best for queries related to physical locations, businesses, restaurants, services, etc. ' +
              'Returns detailed information including:\n' +
              '- Business names and addresses\n' +
              '- Ratings and review counts\n' +
              '- Phone numbers and opening hours\n' +
              "Use this when the query implies 'near me' or mentions specific locations. " +
              'Automatically falls back to web search if no local results are found.',
            inputSchema: zodToJsonSchema(BraveLocalSearchArgsSchema)
          }
        ]
      }
    })

    // 设置工具调用处理器
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params

        switch (name) {
          case 'brave_web_search': {
            const parsed = BraveWebSearchArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`无效的搜索参数: ${parsed.error}`)
            }

            const { query, count, offset } = parsed.data
            const results = await this.performWebSearch(query, count, offset)

            // 添加搜索摘要
            const summary = {
              type: 'text',
              text: `为您找到关于"${query}"的${results.length}个结果`
            }

            return {
              content: [summary, ...results]
            }
          }

          case 'brave_local_search': {
            const parsed = BraveLocalSearchArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`无效的搜索参数: ${parsed.error}`)
            }

            const { query, count } = parsed.data
            const results = await this.performLocalSearch(query, count)

            // 判断是本地搜索结果还是回退到了Web搜索结果
            const isLocalResults =
              results.length > 0 && results[0].resource?.uri.startsWith('brave-local://')
            const summary = {
              type: 'text',
              text: isLocalResults
                ? `为您找到关于"${query}"的${results.length}个本地结果`
                : `未找到本地结果，为您转为网络搜索，找到了${results.length}个结果`
            }

            return {
              content: [summary, ...results]
            }
          }

          default:
            throw new Error(`未知工具: ${name}`)
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text', text: `错误: ${errorMessage}` }],
          isError: true
        }
      }
    })
  }
}
