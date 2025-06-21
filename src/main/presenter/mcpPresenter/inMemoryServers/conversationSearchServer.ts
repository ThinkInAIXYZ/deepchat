/* eslint-disable @typescript-eslint/no-explicit-any */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport'
import { presenter } from '@/presenter' // 导入全局的 presenter 对象
import { eventBus } from '@/eventbus' // 引入 eventBus
import { TAB_EVENTS, MEETING_EVENTS, CONVERSATION_EVENTS } from '@/events'

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

// +++ 新增会议功能部分 +++
// 参会者姓名列表
const PARTICIPANT_NAMES = [
  "Alice", "Brian", "Chris", "David", "Emma", "Frank", "Grace", "Henry",
  "Ian", "Jack", "Kate", "Lily", "Mike", "Nick", "Oliver", "Peter",
  "Quinn", "Ryan", "Sarah", "Tom", "Uriel", "Victor", "Wendy", "Xavier",
  "Yolanda", "Zoe"
];

// 单个参会者的Schema定义 (精确引导)
const ParticipantSchema = z.object({
  tab_id: z.number().optional().describe(
    '通过Tab的【唯一标识】来精确指定参会者。' +
    '这是一个内部ID，通常通过create_new_tab等工具获得。' +
    '仅当你可以明确获得参会者Tab的唯一标识时，才应使用此字段。' +
    '这是最精确的定位方式。如果使用此字段，则不应填写 tab_title。'
  ),
  tab_title: z.string().optional().describe(
    '通过Tab的【当前显示标题】来指定参会者。' +
    '当用户的指令中明确提到了Tab的名称（例如 "让标题为\'AI讨论\'的Tab..."）时，应优先使用此字段。' +
    '请注意，标题可能不是唯一的，系统会选择第一个匹配的Tab。如果使用此字段，则不应填写 tab_id。'
  ),
  profile: z.string().optional().describe('用于定义该参会者的完整画像，可包括且不限于其角色身份、观察视角、立场观点、表达方式、行为模式、发言约束及其他提示词，用于驱动其在会议中的一致性行为和语言风格。')
})
// 对整个对象进行描述，强调其核心作用和互斥规则
.describe(
  '定义一位会议的参会者。' +
  '你必须通过且只能通过 "tab_id" 或 "tab_title" 字段中的一个来指定该参会者。' +
  '决策依据：如果用户的指令明确提到了Tab的标题，请优先使用 tab_title。仅当你可以明确获得参会者tab唯一数字标识时，才使用 tab_id。'
)
// 保持refine作为最终的硬性约束
.refine(
  (data) => {
    const hasId = data.tab_id !== undefined && data.tab_id !== -1;
    const hasTitle = data.tab_title !== undefined && data.tab_title.trim() !== '';
    return (hasId && !hasTitle) || (!hasId && hasTitle);
  }, 
  {
    message: '错误：必须且只能通过 "tab_id" 或 "tab_title" 中的一个来指定参会者，两者不能同时提供，也不能都为空。'
  }
);

// 新的会议工具Schema
const StartMeetingArgsSchema = z.object({
  participants: z
    .array(ParticipantSchema)
    .min(2, { message: "会议至少需要两位参会者。" })
    .describe('参会者列表。'),
  topic: z.string().describe('会议的核心讨论主题。'),
  rounds: z.number().optional().default(3).describe('讨论的轮次数，默认为3轮。')
});

// 内部使用的会议参与者信息接口，增加了会议代号
interface MeetingParticipant {
  meetingName: string; // 新增：会议中的代号，如 "Alice"
  tabId: number;
  conversationId: string;
  originalTitle: string; // 保留原始Tab标题
  profile: string;
}

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
          },
          // 新增会议工具
          {
            name: 'start_meeting',
            description: '启动并主持一个由多个Tab（参会者）参与的关于特定主题的讨论会议。如果你当前已经是某个会议的参与者，请勿调用！',
            inputSchema: zodToJsonSchema(StartMeetingArgsSchema) // 更新Schema
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

          case 'start_meeting': {
            try {
              // 1. 解析和验证参数。如果失败，抛出ZodError，被外层catch捕获，并快速失败。
              const meetingArgs = StartMeetingArgsSchema.parse(args)

              // 2. 启动会议，但 **不使用 await**。
              //    我们使用一个自执行的异步函数来包裹 `organizeMeeting`，
              //    这样可以捕获它内部的异步错误，而不会让主线程崩溃。
              ;(async () => {
                try {
                  await this.organizeMeeting(meetingArgs)
                  console.log('会议流程已在后台成功完成。')
                } catch (meetingError: any) {
                  // 在后台执行期间发生的错误
                  console.error(`会议执行过程中发生错误: ${meetingError.message}`)
                  // 这里可以添加通知逻辑，比如通知所有参会者会议已中止
                  // 由于已经脱离了原始请求，只能通过 eventBus 通知
                }
              })()

              // 3. 立即返回成功启动的消息，避免超时。
              return {
                content: [{ type: 'text', text: '会议已成功启动，正在后台进行中...' }]
              }
            } catch (error: any) {
              // 捕获启动阶段的错误（如参数验证失败）
              return {
                content: [{ type: 'text', text: `会议启动失败: ${error.message}` }],
                isError: true
              }
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

  // 新增会议功能的完整实现

  /**
   * 等待指定会话生成一个新消息。
   * @param conversationId 要等待的会话ID
   * @param timeout 超时时间（毫秒）
   * @returns 返回生成的消息对象
   */
  private waitForResponse(conversationId: string, timeout = 180000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        eventBus.removeListener(CONVERSATION_EVENTS.MESSAGE_GENERATED, listener)
        reject(
          new Error(
            `超时: 等待会话 ${conversationId} 的回复超过 ${timeout / 1000} 秒，未收到响应。`
          )
        )
      }, timeout)

      const listener = (data: { conversationId: string; message: any }) => {
        if (data.conversationId === conversationId) {
          clearTimeout(timer)
          eventBus.removeListener(CONVERSATION_EVENTS.MESSAGE_GENERATED, listener)
          resolve(data.message)
        }
      }

      eventBus.on(CONVERSATION_EVENTS.MESSAGE_GENERATED, listener)
    })
  }

  /**
   * 组织和执行整个会议流程
   * @param args 会议参数
   */
  private async organizeMeeting(args: z.infer<typeof StartMeetingArgsSchema>): Promise<void> {
    const { participants, topic, rounds } = args

    // 1. 定位并验证参会者 (最终修正逻辑)
    const mainWindowId = presenter.windowPresenter.mainWindow?.id
    if (!mainWindowId) throw new Error('主窗口未找到，无法开始会议。')

    const allChatTabs = (await presenter.tabPresenter.getWindowTabsData(mainWindowId))

    const meetingParticipants: MeetingParticipant[] = []
    let nameIndex = 0

    for (const p of participants) {
      let tabData

      // 优先使用 tab_id 查找，这个基本上是通过create_new_tab获得的tab_id
      if (p.tab_id !== undefined) {
        tabData = allChatTabs.find((t) => t.id === p.tab_id)
      }
      
      // 如果通过 tab_id 没找到，再尝试使用 tab_title，这个基本上是现成的已有tab，所以无需再次创建对话ID之类
      let foundByTabTitle = false
      if (!tabData && p.tab_title) {
        tabData = allChatTabs.find((t) => t.title === p.tab_title)
        if (tabData) foundByTabTitle = true
      }
      
      // 找不到 tabData，跳过这个无法准备的参会者
      if (!tabData) continue

      // 如果是新建的tab，则必须创建激活会话
      if (!foundByTabTitle) {
        let conversationId = await presenter.threadPresenter.getActiveConversationId(tabData.id)

        // 确保每个有效的参会者都有一个可用的conversationId
        const meetingName =
          nameIndex < PARTICIPANT_NAMES.length
            ? PARTICIPANT_NAMES[nameIndex]
            : `参会者${nameIndex + 1}`
        nameIndex++

        // 如果Tab没有活动会话，则为其创建并等待UI同步
        if (!conversationId) {
          console.log(`参会者 (ID: ${tabData.id}) 没有活动会话，正在为其创建...`)

          // 步骤 a: 创建新会话。这将自动激活并广播 'conversation:activated' 事件。
          conversationId = await presenter.threadPresenter.createConversation(
            `${meetingName}`, // 为新会话设置一个描述性标题，即会议代号
            {},
            tabData.id,
            { forceNewAndActivate: true } // 传入强制创建并激活的选项
          )

          if (!conversationId) {
            console.warn(`为Tab ${tabData.id} 创建会话失败，将跳过此参会者。`)
            continue // 跳过这个无法准备的参会者
          }

          // 步骤 b: 关键的UI同步点！等待渲染进程处理完激活事件并回传确认信号。
          try {
            await awaitTabActivated(conversationId)
            console.log(`会话 ${conversationId} 在Tab ${tabData.id} 中已成功激活。`)
          } catch (error) {
            console.error(`等待Tab ${tabData.id} 激活失败:`, error)
            continue // 如果UI同步失败，也跳过此参会者
          }
        }

        meetingParticipants.push({
          meetingName,
          tabId: tabData.id,
          conversationId,
          originalTitle: tabData.title,
          profile: p.profile || `你可以就“${topic}”这个话题，自由发表你的看法和观点。`
        })
      // 如果是非新建的tab，则无需创建激活会话
      } else {
        let conversationId = await presenter.threadPresenter.getActiveConversationId(tabData.id)

        if (!conversationId) {
          console.warn(`为Tab ${tabData.id} 创建会话失败，将跳过此参会者。`)
          continue // 跳过这个无法准备的参会者
        }

        // 确保每个有效的参会者都有一个可用的conversationId
        const meetingName =
          nameIndex < PARTICIPANT_NAMES.length
            ? PARTICIPANT_NAMES[nameIndex]
            : `参会者${nameIndex + 1}`
        nameIndex++

        meetingParticipants.push({
          meetingName,
          tabId: tabData.id,
          conversationId,
          originalTitle: tabData.title,
          profile: p.profile || `你可以就“${topic}”这个话题，自由发表你的看法和观点。`
        })
      }
    }

    if (meetingParticipants.length < 2) {
      throw new Error(
        `会议无法开始。只找到了 ${meetingParticipants.length} 位有效的参会者。请确保指定的Tab ID或标题正确，并且它们正在进行对话。`
      )
    }

    // 2. 初始化会议 (使用会议代号)
    const participantNames = meetingParticipants.map((p) => p.meetingName).join('、')

    for (const p of meetingParticipants) {
      const initPrompt = `您好，${p.meetingName}。
我是Argus，是当前会议的组织者，很荣幸能邀请您参加会议：
---
会议主题: ${topic}
所有参会者: ${participantNames}
你的会议名称: ${p.meetingName}
你的角色画像: ${p.profile}
---
会议规则:
1. 请严格围绕你的角色和观点进行发言。
2. 请等待主持人指示后方可发言。
3. 发言时，请清晰地陈述你的论点。
4. 你的发言将被转发给其他所有参会者。
5. 在他人发言时，你会收到其发言内容，但请勿回复，轮到你再发言。
6. 作为会议参与者，你不得调用与会议相关的工具函数。
---
会议现在开始。请等待你的发言回合。
`
      eventBus.sendToTab(p.tabId, MEETING_EVENTS.INSTRUCTION, { prompt: initPrompt })

      // 等待AI模型的确认性回复，以同步流程，但我们忽略其具体内容。
      await this.waitForResponse(p.conversationId)
    }

    // 3. 会议循环 (使用会议代号)
    let history = `会议记录\n主题: ${topic}\n`
    for (let round = 1; round <= rounds; round++) {
      for (const speaker of meetingParticipants) {
        const speakPrompt = `第 ${round}/${rounds} 轮。现在轮到您（${speaker.meetingName}）发言。请陈述您的观点。`
        eventBus.sendToTab(speaker.tabId, MEETING_EVENTS.INSTRUCTION, { prompt: speakPrompt })

        // 等待并捕获真正的、需要被记录和转发的发言内容。
        const speechMessage = await this.waitForResponse(speaker.conversationId)

        const speechText = Array.isArray(speechMessage.content)
          ? speechMessage.content.find((c: any) => c.type === 'content')?.content || '[无内容]'
          : speechMessage.content || '[无内容]'
        history += `\n[第${round}轮] ${speaker.meetingName}: ${speechText}`

        // 转发给其他参会者，并等待他们的确认性回复。
        for (const listener of meetingParticipants) {
          if (listener.tabId !== speaker.tabId) {
            const forwardPrompt = `来自 ${speaker.meetingName} 的发言如下：\n\n---\n${speechText}\n---\n\n**以上信息仅供参考，请不要回复！**\n作为参会者，请您（${listener.meetingName}）等待我（Argus）的指示。`
            eventBus.sendToTab(listener.tabId, MEETING_EVENTS.INSTRUCTION, {
              prompt: forwardPrompt
            })

            // 等待确认性回复，并忽略内容。
            await this.waitForResponse(listener.conversationId)
          }
        }
      }
    }

    // 4. 结束会议 (使用会议代号)
    for (const p of meetingParticipants) {
      const personalizedFinalPrompt = `讨论已结束。请您（${p.meetingName}）根据整个对话过程，对您的观点进行最终总结。`
      eventBus.sendToTab(p.tabId, MEETING_EVENTS.INSTRUCTION, { prompt: personalizedFinalPrompt })
    }

    // 注意：这里不再有返回值，因为函数是在后台执行的。
    console.log(`关于“${topic}”的会议流程已在后台正常结束。`)
  }
}
