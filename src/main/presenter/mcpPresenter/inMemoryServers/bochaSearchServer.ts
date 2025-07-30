import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import axios from 'axios'

// Schema definitions
const BochaWebSearchArgsSchema = z.object({
  query: z.string().describe('Search query (required)'),
  freshness: z
    .string()
    .optional()
    .default('noLimit')
    .describe(
      'The time range for the search results. (Available options YYYY-MM-DD, YYYY-MM-DD..YYYY-MM-DD, noLimit, oneYear, oneMonth, oneWeek, oneDay. Default is noLimit)'
    ),
  count: z.number().optional().default(10).describe('Number of results (1-50, default 10)')
})

const BochaAiSearchArgsSchema = z.object({
  query: z.string().describe('Search query (required)'),
  freshness: z
    .string()
    .optional()
    .default('noLimit')
    .describe(
      'The time range for the search results. (Available options noLimit, oneYear, oneMonth, oneWeek, oneDay. Default is noLimit)'
    ),
  count: z.number().optional().default(10).describe('Number of results (1-50, default 10)')
})

// 定义Bocha API返回的数据结构 - Web Search
interface BochaWebSearchResponse {
  msg: string | null
  data: {
    _type: string
    queryContext: {
      originalQuery: string
    }
    webPages: {
      webSearchUrl: string
      totalEstimatedMatches: number
      value: Array<{
        id: string | null
        name: string
        url: string
        displayUrl: string
        snippet: string
        summary: string // 使用 summary 作为描述
        siteName: string
        siteIcon: string
        dateLastCrawled: string
        cachedPageUrl: string | null
        language: string | null
        isFamilyFriendly: boolean | null
        isNavigational: boolean | null
        datePublished?: string // Python版本似乎有这个
      }>
      isFamilyFriendly: boolean | null
    }
    videos: unknown | null
  }
}

// 定义Bocha API返回的数据结构 - AI Search
interface BochaAiSearchResponse {
  messages?: Array<{
    content_type: string
    content: string // 可能需要 JSON.parse
  }>
  // 可能还有其他字段，根据需要添加
}

// AI Search content 解析后的结构 (webpage 类型)
interface AiSearchWebPageItem {
  name: string
  url: string
  summary: string
  datePublished?: string
  siteName?: string
  // 添加其他可能的字段
}

// 定义 MCP 资源对象结构
interface McpResource {
  uri: string
  mimeType: string
  text: string
}

export class BochaSearchServer {
  private server: Server
  private apiKey: string

  constructor(env?: Record<string, unknown>) {
    if (!env?.apiKey) {
      throw new Error('需要提供Bocha API Key')
    }
    this.apiKey = env.apiKey as string

    // 创建服务器实例
    this.server = new Server(
      {
        name: 'deepchat-inmemory/bocha-search-server',
        version: '0.1.2' // 版本更新
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

  // 设置请求处理器
  private setupRequestHandlers(): void {
    // 设置工具列表处理器
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'bocha_web_search',
            description:
              'Search with Bocha Web Search and get enhanced search details from billions of web documents, including page titles, urls, summaries, site names, site icons, publication dates, image links, and more.', // 官方描述
            inputSchema: zodToJsonSchema(BochaWebSearchArgsSchema)
          },
          {
            name: 'bocha_ai_search',
            description:
              'Search with Bocha AI Search, recognizes the semantics of search terms and additionally returns structured modal cards with content from vertical domains.', // 官方描述
            inputSchema: zodToJsonSchema(BochaAiSearchArgsSchema)
          }
        ]
      }
    })

    // 设置工具调用处理器
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params

        switch (name) {
          case 'bocha_web_search': {
            const parsed = BochaWebSearchArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid search parameters: ${parsed.error}`)
            }

            const { query, count, freshness } = parsed.data

            // 调用Bocha API
            const response = await axios.post(
              'https://api.bochaai.com/v1/web-search', // 保持原始端点，若官方建议修改可调整
              {
                query,
                summary: true,
                freshness, // 添加 freshness
                count
              },
              {
                headers: {
                  Authorization: `Bearer ${this.apiKey}`,
                  'Content-Type': 'application/json'
                }
              }
            )

            // 处理响应数据
            const searchResponse = response.data as BochaWebSearchResponse

            if (
              !searchResponse.data?.webPages?.value ||
              searchResponse.data.webPages.value.length === 0
            ) {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'No results found.' // 统一提示信息
                  }
                ]
              }
            }

            // 将结果转换为MCP资源格式
            const results = searchResponse.data.webPages.value.map((item, index) => {
              // 构建blob内容
              const blobContent = {
                title: item.name,
                url: item.url,
                rank: index + 1,
                content: item.summary, // 使用 summary
                icon: item.siteIcon,
                publishedDate: item.datePublished, // 添加发布日期
                siteName: item.siteName // 添加站点名称
              }

              return {
                type: 'resource',
                resource: {
                  uri: item.url,
                  mimeType: 'application/deepchat-webpage', // 保持你的类型
                  text: JSON.stringify(blobContent)
                }
              }
            })

            // 添加搜索摘要
            const summaryText = `Found ${results.length} results for "${query}"`
            const summary = {
              type: 'text',
              text: summaryText
            }

            return {
              content: [summary, ...results]
            }
          }

          case 'bocha_ai_search': {
            const parsed = BochaAiSearchArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid search parameters: ${parsed.error}`)
            }

            const { query, count, freshness } = parsed.data

            // 调用Bocha AI Search API
            const response = await axios.post(
              'https://api.bochaai.com/v1/ai-search', // 使用 AI Search 端点
              {
                query,
                freshness,
                count,
                answer: false, // 根据Python版本
                stream: false // 根据Python版本
              },
              {
                headers: {
                  Authorization: `Bearer ${this.apiKey}`,
                  'Content-Type': 'application/json'
                },
                timeout: 10000 // 设置超时，同Python版本
              }
            )

            const aiSearchResponse = response.data as BochaAiSearchResponse
            const contentResults: Array<{ type: string; text?: string; resource?: McpResource }> =
              []

            if (aiSearchResponse.messages && aiSearchResponse.messages.length > 0) {
              aiSearchResponse.messages.forEach((message) => {
                try {
                  if (message.content_type === 'webpage') {
                    const webData = JSON.parse(message.content) as { value: AiSearchWebPageItem[] }
                    if (webData.value && Array.isArray(webData.value)) {
                      webData.value.forEach((item, index) => {
                        const blobContent = {
                          title: item.name,
                          url: item.url,
                          rank: index + 1, // Rank might need adjustment based on overall results
                          content: item.summary,
                          publishedDate: item.datePublished,
                          siteName: item.siteName
                          // icon is not available in AI search response apparently
                        }
                        contentResults.push({
                          type: 'resource',
                          resource: {
                            uri: item.url,
                            mimeType: 'application/deepchat-webpage', // 保持你的类型
                            text: JSON.stringify(blobContent)
                          }
                        })
                      })
                    }
                  } else if (message.content_type !== 'image' && message.content !== '{}') {
                    // 其他非空、非图片的内容视为文本
                    contentResults.push({
                      type: 'text',
                      text: message.content
                    })
                  }
                } catch (e) {
                  console.error('Error parsing AI search message content:', e)
                  // Optionally add an error message to results
                  contentResults.push({
                    type: 'text',
                    text: `Error processing result: ${message.content}`
                  })
                }
              })
            }

            if (contentResults.length === 0) {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'No results found.'
                  }
                ]
              }
            }

            // 添加摘要
            const summaryText = `Found ${contentResults.filter((r) => r.type === 'resource').length} web results and ${contentResults.filter((r) => r.type === 'text').length} other content for "${query}" via AI Search.`
            const summary = {
              type: 'text',
              text: summaryText
            }

            return {
              content: [summary, ...contentResults]
            }
          }

          default:
            throw new Error(`Unknown tool: ${name}`)
        }
      } catch (error) {
        console.error('Error calling tool:', error) // Log the error server-side
        const errorMessage =
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : 'An unknown error occurred'

        // Check for specific Axios errors
        if (axios.isAxiosError(error)) {
          const status = error.response?.status
          const details = error.response?.data ? JSON.stringify(error.response.data) : error.message
          const finalMessage = `Bocha API request failed: ${status ? `Status ${status}` : ''} - ${details}`
          return {
            content: [{ type: 'text', text: `Error: ${finalMessage}` }],
            isError: true
          }
        }

        return {
          content: [{ type: 'text', text: `Error: ${errorMessage}` }],
          isError: true
        }
      }
    })
  }
}
