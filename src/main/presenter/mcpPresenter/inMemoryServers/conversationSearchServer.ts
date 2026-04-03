/* eslint-disable @typescript-eslint/no-explicit-any */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { presenter } from '@/presenter' // 导入全局的 presenter 对象
import { isSafeRegexPattern } from '@shared/regexValidator'

// Schema definitions
const SearchConversationsArgsSchema = z.object({
  query: z
    .string()
    .describe('Search keyword to search in conversation titles and message contents'),
  limit: z.number().optional().default(10).describe('Result limit (1-50, default 10)'),
  offset: z.number().optional().default(0).describe('Pagination offset (default 0)')
})

const SearchMessagesArgsSchema = z.object({
  query: z.string().describe('Search keyword to search in message contents'),
  conversationId: z
    .string()
    .optional()
    .describe('Optional conversation ID to limit search within specific conversation'),
  role: z
    .enum(['user', 'assistant', 'system', 'function'])
    .optional()
    .describe('Optional message role filter'),
  limit: z.number().optional().default(20).describe('Result limit (1-100, default 20)'),
  offset: z.number().optional().default(0).describe('Pagination offset (default 0)')
})

const GetConversationHistoryArgsSchema = z.object({
  conversationId: z.string().describe('Conversation ID'),
  includeSystem: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to include system messages')
})

const GetConversationStatsArgsSchema = z.object({
  days: z.number().optional().default(30).describe('Statistics period in days (default 30 days)')
})

interface SearchResult {
  conversations?: Array<{
    id: string
    title: string
    createdAt: number
    updatedAt: number
    messageCount: number
    snippet?: string
  }>
  messages?: Array<{
    id: string
    conversationId: string
    conversationTitle: string
    role: string
    content: string
    createdAt: number
    snippet?: string
  }>
  total: number
}

export class ConversationSearchServer {
  private server: Server

  constructor() {
    // 创建服务器实例
    this.server = new Server(
      {
        name: 'conversation-search-server',
        version: '1.0.0'
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

  // 搜索对话
  private async searchConversations(
    query: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<SearchResult> {
    try {
      const sqlitePresenter = presenter.sqlitePresenter

      const searchQuery = `%${query}%`

      const conversationSql = `
        SELECT
          s.id as id,
          s.title as title,
          s.created_at as createdAt,
          s.updated_at as updatedAt,
          COALESCE(msg_stats.messageCount, 0) as messageCount,
          CASE
            WHEN s.title LIKE ? THEN NULL
            ELSE (
              SELECT dm.content
              FROM deepchat_messages dm
              WHERE dm.session_id = s.id AND dm.content LIKE ?
              ORDER BY dm.created_at DESC
              LIMIT 1
            )
          END as matchedContent
        FROM new_sessions s
        LEFT JOIN (
          SELECT session_id, COUNT(*) as messageCount
          FROM deepchat_messages
          GROUP BY session_id
        ) msg_stats ON msg_stats.session_id = s.id
        WHERE s.title LIKE ?
          OR EXISTS (
            SELECT 1
            FROM deepchat_messages dm2
            WHERE dm2.session_id = s.id AND dm2.content LIKE ?
          )
        ORDER BY s.updated_at DESC
        LIMIT ? OFFSET ?
      `

      const db = (sqlitePresenter as any).db
      const rows = db
        .prepare(conversationSql)
        .all(searchQuery, searchQuery, searchQuery, searchQuery, limit, offset)

      const conversations = rows.map((row: any) => {
        const matchedText = row.matchedContent
          ? this.getSearchableContent(String(row.matchedContent))
          : ''
        const snippet = matchedText
          ? this.createSnippet(matchedText, query)
          : `Title match: ${String(row.title)}`

        return {
          id: String(row.id),
          title: String(row.title),
          createdAt: Number(row.createdAt ?? 0),
          updatedAt: Number(row.updatedAt ?? 0),
          messageCount: Number(row.messageCount ?? 0),
          snippet
        }
      })

      return {
        conversations,
        total: conversations.length
      }
    } catch (error) {
      console.error('Error searching conversations:', error)
      throw new Error(
        `Failed to search conversations: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  // 搜索消息
  private async searchMessages(
    query: string,
    conversationId?: string,
    role?: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<SearchResult> {
    try {
      const sqlitePresenter = presenter.sqlitePresenter
      const searchQuery = `%${query}%`
      const normalizedRole = role?.trim()
      if (normalizedRole && normalizedRole !== 'user' && normalizedRole !== 'assistant') {
        return {
          messages: [],
          total: 0
        }
      }

      let sql = `
        SELECT
          m.id as id,
          m.session_id as conversationId,
          s.title as conversationTitle,
          m.role,
          m.content,
          m.created_at as createdAt
        FROM deepchat_messages m
        INNER JOIN new_sessions s ON m.session_id = s.id
        WHERE m.content LIKE ?
      `

      const params: any[] = [searchQuery]

      if (conversationId) {
        sql += ' AND m.session_id = ?'
        params.push(conversationId)
      }

      if (normalizedRole) {
        sql += ' AND m.role = ?'
        params.push(normalizedRole)
      }

      sql += ' ORDER BY m.created_at DESC LIMIT ? OFFSET ?'
      params.push(limit, offset)

      let countSql = `
        SELECT COUNT(*) as total
        FROM deepchat_messages m
        WHERE m.content LIKE ?
      `
      const countParams: any[] = [searchQuery]

      if (conversationId) {
        countSql += ' AND m.session_id = ?'
        countParams.push(conversationId)
      }

      if (normalizedRole) {
        countSql += ' AND m.role = ?'
        countParams.push(normalizedRole)
      }

      const db = (sqlitePresenter as any).db

      const messages = db
        .prepare(sql)
        .all(...params)
        .map((msg: any) => ({
          id: String(msg.id),
          conversationId: String(msg.conversationId),
          conversationTitle: String(msg.conversationTitle),
          role: String(msg.role),
          content: this.getSearchableContent(String(msg.content)),
          createdAt: Number(msg.createdAt ?? 0),
          snippet: this.createSnippet(this.getSearchableContent(String(msg.content)), query)
        }))

      const totalResult = db.prepare(countSql).get(...countParams)
      const total = totalResult?.total || 0

      return {
        messages,
        total
      }
    } catch (error) {
      console.error('Error searching messages:', error)
      throw new Error(
        `Failed to search messages: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  // 获取对话历史
  private async getConversationHistory(conversationId: string, includeSystem: boolean = false) {
    try {
      const session = await presenter.agentSessionPresenter.getSession(conversationId)
      if (!session) {
        throw new Error(`Session not found: ${conversationId}`)
      }
      const records = await presenter.agentSessionPresenter.getMessages(conversationId)

      const filteredMessages = includeSystem
        ? records
        : records.filter((msg) => msg.role === 'user' || msg.role === 'assistant')

      return {
        conversation: {
          id: session.id,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          agentId: session.agentId,
          providerId: session.providerId,
          modelId: session.modelId
        },
        messages: filteredMessages.map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: this.getSearchableContent(msg.content),
          createdAt: msg.createdAt,
          tokenCount: this.getTokenCountFromMetadata(msg.metadata),
          status: msg.status
        }))
      }
    } catch (error) {
      console.error('Error getting conversation history:', error)
      throw new Error(
        `Failed to get conversation history: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  // 获取对话统计信息
  private async getConversationStats(days: number = 30) {
    try {
      const sqlitePresenter = presenter.sqlitePresenter
      const db = (sqlitePresenter as any).db

      const sinceTimestamp = Date.now() - days * 24 * 60 * 60 * 1000

      const totalConversations = db.prepare('SELECT COUNT(*) as count FROM new_sessions').get()

      const recentConversations = db
        .prepare('SELECT COUNT(*) as count FROM new_sessions WHERE created_at >= ?')
        .get(sinceTimestamp)

      const totalMessages = db.prepare('SELECT COUNT(*) as count FROM deepchat_messages').get()

      const recentMessages = db
        .prepare('SELECT COUNT(*) as count FROM deepchat_messages WHERE created_at >= ?')
        .get(sinceTimestamp)

      const messagesByRole = db
        .prepare(
          `
        SELECT role, COUNT(*) as count
        FROM deepchat_messages
        WHERE created_at >= ?
        GROUP BY role
      `
        )
        .all(sinceTimestamp)

      const activeConversations = db
        .prepare(
          `
        SELECT
          s.id as id,
          s.title as title,
          COUNT(m.id) as messageCount,
          MAX(m.created_at) as lastActivity
        FROM new_sessions s
        INNER JOIN deepchat_messages m ON s.id = m.session_id
        WHERE m.created_at >= ?
        GROUP BY s.id
        ORDER BY messageCount DESC
        LIMIT 10
      `
        )
        .all(sinceTimestamp)

      return {
        period: `${days} days`,
        total: {
          conversations: totalConversations.count,
          messages: totalMessages.count
        },
        recent: {
          conversations: recentConversations.count,
          messages: recentMessages.count
        },
        messagesByRole: messagesByRole.reduce((acc: any, item: any) => {
          acc[item.role] = item.count
          return acc
        }, {}),
        activeConversations: activeConversations.map((conv: any) => ({
          id: conv.id,
          title: conv.title,
          messageCount: conv.messageCount,
          lastActivity: new Date(conv.lastActivity).toISOString()
        }))
      }
    } catch (error) {
      console.error('Error getting conversation statistics:', error)
      throw new Error(
        `Failed to get conversation statistics: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  private getSearchableContent(rawContent: string): string {
    try {
      const parsed = JSON.parse(rawContent)
      if (Array.isArray(parsed)) {
        const segments = parsed
          .map((block: { content?: unknown }) =>
            typeof block?.content === 'string' ? block.content : ''
          )
          .filter((text) => text.length > 0)
        if (segments.length > 0) {
          return segments.join('\n')
        }
      } else if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
        return parsed.text
      }
    } catch {
      // Keep raw content fallback.
    }
    return rawContent
  }

  private getTokenCountFromMetadata(metadataRaw: string): number | null {
    try {
      const metadata = JSON.parse(metadataRaw) as { totalTokens?: number; outputTokens?: number }
      if (typeof metadata.totalTokens === 'number') {
        return metadata.totalTokens
      }
      if (typeof metadata.outputTokens === 'number') {
        return metadata.outputTokens
      }
    } catch {
      // Ignore parse error.
    }
    return null
  }

  // 创建搜索片段
  private createSnippet(content: string, query: string, maxLength: number = 200): string {
    const lowerContent = content.toLowerCase()
    const lowerQuery = query.toLowerCase()
    const index = lowerContent.indexOf(lowerQuery)

    if (index === -1) {
      return content.length > maxLength ? content.substring(0, maxLength) + '...' : content
    }

    const start = Math.max(0, index - 50)
    const end = Math.min(content.length, index + query.length + 50)
    let snippet = content.substring(start, end)

    if (start > 0) snippet = '...' + snippet
    if (end < content.length) snippet = snippet + '...'

    // 高亮关键词 - 转义特殊字符并验证安全性
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = `(${escapedQuery})`
    if (!isSafeRegexPattern(pattern)) {
      // If pattern is unsafe, return snippet without highlighting
      return snippet
    }
    const regex = new RegExp(pattern, 'gi')
    snippet = snippet.replace(regex, '**$1**')

    return snippet
  }

  // 设置请求处理器
  private setupRequestHandlers(): void {
    // 列出工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'search_conversations',
            description:
              'Search historical conversation records, supports title and content search',
            inputSchema: zodToJsonSchema(SearchConversationsArgsSchema),
            annotations: {
              title: 'Search Conversations',
              readOnlyHint: true
            }
          },
          {
            name: 'search_messages',
            description:
              'Search historical message records, supports filtering by conversation ID, role and other conditions',
            inputSchema: zodToJsonSchema(SearchMessagesArgsSchema),
            annotations: {
              title: 'Search Messages',
              readOnlyHint: true
            }
          },
          {
            name: 'get_conversation_history',
            description: 'Get complete history of a specific conversation',
            inputSchema: zodToJsonSchema(GetConversationHistoryArgsSchema),
            annotations: {
              title: 'Get Conversation History',
              readOnlyHint: true
            }
          },
          {
            name: 'get_conversation_stats',
            description: 'Get conversation statistics including totals, recent activity and more',
            inputSchema: zodToJsonSchema(GetConversationStatsArgsSchema),
            annotations: {
              title: 'Get Conversation Stats',
              readOnlyHint: true
            }
          }
        ]
      }
    })

    // 调用工具
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      try {
        switch (name) {
          case 'search_conversations': {
            const { query, limit, offset } = SearchConversationsArgsSchema.parse(args)
            const result = await this.searchConversations(query, limit, offset)

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2)
                }
              ]
            }
          }

          case 'search_messages': {
            const { query, conversationId, role, limit, offset } =
              SearchMessagesArgsSchema.parse(args)
            const result = await this.searchMessages(query, conversationId, role, limit, offset)

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2)
                }
              ]
            }
          }

          case 'get_conversation_history': {
            const { conversationId, includeSystem } = GetConversationHistoryArgsSchema.parse(args)
            const result = await this.getConversationHistory(conversationId, includeSystem)

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2)
                }
              ]
            }
          }

          case 'get_conversation_stats': {
            const { days } = GetConversationStatsArgsSchema.parse(args)
            const result = await this.getConversationStats(days)

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2)
                }
              ]
            }
          }
          default:
            throw new Error(`Unknown tool: ${name}`)
        }
      } catch (error) {
        console.error(`Error executing tool ${name}:`, error)
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true
        }
      }
    })
  }
}
