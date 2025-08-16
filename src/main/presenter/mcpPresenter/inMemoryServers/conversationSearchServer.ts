/* eslint-disable @typescript-eslint/no-explicit-any */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { presenter } from '@/presenter' // 导入全局的 presenter 对象
import { eventBus } from '@/eventbus' // 引入 eventBus
import { TAB_EVENTS } from '@/events'

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

const CreateNewTabArgsSchema = z.object({
  url: z
    .enum(['local://chat', 'local://settings'])
    .default('local://chat') // 默认 URL 为 local://chat
    .describe('URL for the new tab. Defaults to local://chat.'),
  active: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether the new tab should be active. Defaults to true.'),
  position: z.number().optional().describe('Optional position for the new tab in the tab bar.'),
  userInput: z.string().optional().describe('Optional initial user input for the new chat tab.')
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

// 等待 Tab 内容就绪的辅助函数
function awaitTabReady(webContentsId: number, timeout = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      eventBus.removeListener(TAB_EVENTS.RENDERER_TAB_READY, listener)
      reject(new Error(`Timed out waiting for tab ${webContentsId} to be ready.`))
    }, timeout)

    const listener = (readyTabId: number) => {
      if (readyTabId === webContentsId) {
        clearTimeout(timer)
        eventBus.removeListener(TAB_EVENTS.RENDERER_TAB_READY, listener)
        resolve()
      }
    }

    eventBus.on(TAB_EVENTS.RENDERER_TAB_READY, listener)
  })
}

// 等待 Tab 会话激活的辅助函数
function awaitTabActivated(threadId: string, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      eventBus.removeListener(TAB_EVENTS.RENDERER_TAB_ACTIVATED, listener)
      reject(new Error(`Timed out waiting for thread ${threadId} to be activated.`))
    }, timeout)

    const listener = (activatedThreadId: string) => {
      if (activatedThreadId === threadId) {
        clearTimeout(timer)
        eventBus.removeListener(TAB_EVENTS.RENDERER_TAB_ACTIVATED, listener)
        resolve()
      }
    }

    eventBus.on(TAB_EVENTS.RENDERER_TAB_ACTIVATED, listener)
  })
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

      // 使用原始SQL进行全文搜索
      const searchQuery = `%${query}%`

      // 搜索对话标题
      const conversationSql = `
        SELECT
          c.conv_id as id,
          c.title,
          c.created_at as createdAt,
          c.updated_at as updatedAt,
          COUNT(m.msg_id) as messageCount
        FROM conversations c
        LEFT JOIN messages m ON c.conv_id = m.conversation_id
        WHERE c.title LIKE ?
        GROUP BY c.conv_id
        ORDER BY c.updated_at DESC
        LIMIT ? OFFSET ?
      `

      // 搜索消息内容并关联对话
      const messageSql = `
        SELECT
          c.conv_id as conversationId,
          c.title as conversationTitle,
          m.content
        FROM conversations c
        INNER JOIN messages m ON c.conv_id = m.conversation_id
        WHERE m.content LIKE ? AND m.role != 'system'
        GROUP BY c.conv_id
        ORDER BY c.updated_at DESC
        LIMIT ? OFFSET ?
      `

      // 获取数据库实例
      const db = (sqlitePresenter as any).db

      // 执行对话标题搜索
      const conversationResults = db.prepare(conversationSql).all(searchQuery, limit, offset)

      // 执行消息内容搜索
      const messageResults = db.prepare(messageSql).all(searchQuery, limit, offset)

      // 合并结果并去重
      const conversationMap = new Map()

      // 添加标题匹配的对话
      conversationResults.forEach((conv: any) => {
        conversationMap.set(conv.id, {
          id: conv.id,
          title: conv.title,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
          messageCount: conv.messageCount,
          snippet: `Title match: ${conv.title}`
        })
      })

      // 添加内容匹配的对话
      messageResults.forEach((msg: any) => {
        if (!conversationMap.has(msg.conversationId)) {
          conversationMap.set(msg.conversationId, {
            id: msg.conversationId,
            title: msg.conversationTitle,
            createdAt: 0,
            updatedAt: 0,
            messageCount: 0,
            snippet: this.createSnippet(msg.content, query)
          })
        }
      })

      const conversations = Array.from(conversationMap.values()).slice(0, limit)

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

      let sql = `
        SELECT
          m.msg_id as id,
          m.conversation_id as conversationId,
          c.title as conversationTitle,
          m.role,
          m.content,
          m.created_at as createdAt
        FROM messages m
        INNER JOIN conversations c ON m.conversation_id = c.conv_id
        WHERE m.content LIKE ?
      `

      const params: any[] = [searchQuery]

      if (conversationId) {
        sql += ' AND m.conversation_id = ?'
        params.push(conversationId)
      }

      if (role) {
        sql += ' AND m.role = ?'
        params.push(role)
      }

      sql += ' ORDER BY m.created_at DESC LIMIT ? OFFSET ?'
      params.push(limit, offset)

      // 获取总数
      let countSql = `
        SELECT COUNT(*) as total
        FROM messages m
        WHERE m.content LIKE ?
      `
      const countParams: any[] = [searchQuery]

      if (conversationId) {
        countSql += ' AND m.conversation_id = ?'
        countParams.push(conversationId)
      }

      if (role) {
        countSql += ' AND m.role = ?'
        countParams.push(role)
      }

      const db = (sqlitePresenter as any).db

      const messages = db
        .prepare(sql)
        .all(...params)
        .map((msg: any) => ({
          id: msg.id,
          conversationId: msg.conversationId,
          conversationTitle: msg.conversationTitle,
          role: msg.role,
          content: msg.content,
          createdAt: msg.createdAt,
          snippet: this.createSnippet(msg.content, query)
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
      const sqlitePresenter = presenter.sqlitePresenter
      const conversation = await sqlitePresenter.getConversation(conversationId)
      const messages = await sqlitePresenter.queryMessages(conversationId)

      const filteredMessages = includeSystem
        ? messages
        : messages.filter((msg) => msg.role !== 'system')

      return {
        conversation,
        messages: filteredMessages.map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          createdAt: msg.created_at,
          tokenCount: msg.token_count,
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

      // 总对话数
      const totalConversations = db.prepare('SELECT COUNT(*) as count FROM conversations').get()

      // 最近N天的对话数
      const recentConversations = db
        .prepare('SELECT COUNT(*) as count FROM conversations WHERE created_at >= ?')
        .get(sinceTimestamp)

      // 总消息数
      const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get()

      // 最近N天的消息数
      const recentMessages = db
        .prepare('SELECT COUNT(*) as count FROM messages WHERE created_at >= ?')
        .get(sinceTimestamp)

      // 按角色统计消息
      const messagesByRole = db
        .prepare(
          `
        SELECT role, COUNT(*) as count
        FROM messages
        WHERE created_at >= ?
        GROUP BY role
      `
        )
        .all(sinceTimestamp)

      // 最活跃的对话（按消息数量）
      const activeConversations = db
        .prepare(
          `
        SELECT
          c.conv_id as id,
          c.title,
          COUNT(m.msg_id) as messageCount,
          MAX(m.created_at) as lastActivity
        FROM conversations c
        INNER JOIN messages m ON c.conv_id = m.conversation_id
        WHERE m.created_at >= ?
        GROUP BY c.conv_id
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

    // 高亮关键词
    const regex = new RegExp(`(${query})`, 'gi')
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
            inputSchema: zodToJsonSchema(SearchConversationsArgsSchema)
          },
          {
            name: 'search_messages',
            description:
              'Search historical message records, supports filtering by conversation ID, role and other conditions',
            inputSchema: zodToJsonSchema(SearchMessagesArgsSchema)
          },
          {
            name: 'get_conversation_history',
            description: 'Get complete history of a specific conversation',
            inputSchema: zodToJsonSchema(GetConversationHistoryArgsSchema)
          },
          {
            name: 'get_conversation_stats',
            description: 'Get conversation statistics including totals, recent activity and more',
            inputSchema: zodToJsonSchema(GetConversationStatsArgsSchema)
          },
          {
            name: 'create_new_tab',
            description:
              'Creates a new tab. If userInput is provided, it also creates a new chat session and sends the input as the first message, then returns tabId and threadId.',
            inputSchema: zodToJsonSchema(CreateNewTabArgsSchema)
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
          case 'create_new_tab': {
            // 解析参数，url默认值 'local://chat'
            const { url, active, position, userInput } = CreateNewTabArgsSchema.parse(args)

            const mainWindowId = presenter.windowPresenter.mainWindow?.id
            if (!mainWindowId) {
              throw new Error('Main application window not found to create a new tab.')
            }

            // 步骤 1: 创建 Tab，并获取 tabId
            const newTabId = await presenter.tabPresenter.createTab(mainWindowId, url, {
              active,
              position
            })

            if (!newTabId) {
              throw new Error('Failed to create new tab.')
            }

            // 如果没有 userInput，流程结束
            if (!userInput) {
              return {
                content: [{ type: 'text', text: JSON.stringify({ tabId: newTabId }) }]
              }
            }

            // 等待 Tab 加载完成
            const newTabView = await presenter.tabPresenter.getTab(newTabId)
            if (!newTabView) {
              throw new Error(`Could not find view for new tab ${newTabId}`)
            }

            // ★ 等待渲染进程中的 Vue/Pinia 应用初始化完成
            const newWebContentsId = newTabView.webContents.id
            try {
              await awaitTabReady(newWebContentsId)
            } catch (error) {
              console.error(error)
              throw new Error("Failed to communicate with the new tab's renderer process.")
            }

            // 步骤 2: 主进程创建会话。此操作会触发 CONVERSATION_EVENTS.ACTIVATED 事件，必须在 Vue/Pinia 就绪后执行
            const newThreadId = await presenter.threadPresenter.createConversation(
              'New Chat', // 临时标题
              {}, // 默认设置
              newTabId
            )

            if (!newThreadId) {
              throw new Error('Failed to create a new conversation thread.')
            }

            // ★ 等待渲染进程确认会话已激活
            try {
              await awaitTabActivated(newThreadId)
            } catch (error) {
              console.error(error)
              // 即使超时也尝试继续，但记录警告
              console.warn(
                `Continuing despite activation confirmation timeout for thread ${newThreadId}`
              )
            }

            // 步骤 3: 发送指令给渲染进程，让它来发送消息，必须页面Activated之后才能发送
            newTabView.webContents.send('command:send-initial-message', {
              userInput: userInput
            })

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ tabId: newTabId, threadId: newThreadId })
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
