// src/main/presenter/mcpPresenter/inMemoryServers/meetingServer.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { presenter } from '@/presenter'
import { eventBus } from '@/eventbus'
import { TAB_EVENTS, MEETING_EVENTS, CONVERSATION_EVENTS } from '@/events'

// --- 会议常量和Schema定义 ---

// 预设的参会者代号，用于在会议中标识不同的Tab
const PARTICIPANT_NAMES = [
  'Alice',
  'Brian',
  'Chris',
  'David',
  'Emma',
  'Frank',
  'Grace',
  'Henry',
  'Ian',
  'Jack',
  'Kate',
  'Lily',
  'Mike',
  'Nick',
  'Oliver',
  'Peter',
  'Quinn',
  'Ryan',
  'Sarah',
  'Tom',
  'Uriel',
  'Victor',
  'Wendy',
  'Xavier',
  'Yolanda',
  'Zoe'
]

// 定义单个参会者的Zod Schema，用于验证和解析LLM的工具调用参数
const ParticipantSchema = z
  .object({
    tab_id: z
      .number()
      .optional()
      .describe(
        '通过Tab的【唯一标识】来精确指定参会者。' +
          '这是一个内部ID，通常通过create_new_tab等工具获得。' +
          '仅当你可以明确获得参会者Tab的唯一标识时，才应使用此字段。' +
          '这是最精确的定位方式。如果使用此字段，则不应填写 tab_title。'
      ),
    tab_title: z
      .string()
      .optional()
      .describe(
        '通过Tab的【当前显示标题】来指定参会者。' +
          '当用户的指令中明确提到了Tab的名称（例如 "让标题为\'AI讨论\'的Tab..."）时，应优先使用此字段。' +
          '请注意，标题可能不是唯一的，系统会选择第一个匹配的Tab。如果使用此字段，则不应填写 tab_id。'
      ),
    profile: z
      .string()
      .optional()
      .describe(
        '用于定义该参会者的完整画像，可包括且不限于其角色身份、观察视角、立场观点、表达方式、行为模式、发言约束及其他提示词，用于驱动其在会议中的一致性行为和语言风格。'
      )
  })
  .describe(
    '定义一位会议的参会者。' +
      '你必须通过且只能通过 "tab_id" 或 "tab_title" 字段中的一个来指定该参会者。' +
      '决策依据：如果用户的指令明确提到了Tab的标题，请优先使用 tab_title。仅当你可以明确获得参会者tab唯一数字标识时，才使用 tab_id。'
  )
  .refine(
    (data) => {
      const hasId = data.tab_id !== undefined && data.tab_id !== -1
      const hasTitle = data.tab_title !== undefined && data.tab_title.trim() !== ''
      return (hasId && !hasTitle) || (!hasId && hasTitle)
    },
    {
      message:
        '错误：必须且只能通过 "tab_id" 或 "tab_title" 中的一个来指定参会者，两者不能同时提供，也不能都为空。'
    }
  )

// 定义开启会议工具的Zod Schema
const StartMeetingArgsSchema = z.object({
  participants: z
    .array(ParticipantSchema)
    .min(2, { message: '会议至少需要两位参会者。' })
    .describe('参会者列表。'),
  topic: z.string().describe('会议的核心讨论主题。'),
  rounds: z.number().optional().default(3).describe('讨论的轮次数，默认为3轮。')
})

// --- 内部数据结构 ---

// 内部使用的会议参与者信息接口，增加了会议代号
interface MeetingParticipant {
  meetingName: string
  tabId: number
  conversationId: string
  originalTitle: string
  profile: string
}

// --- 辅助函数 ---

// 等待Tab会话被渲染进程激活的异步函数。这是保证主进程可以安全地向目标Tab发送消息的关键同步点。
function awaitTabActivated(threadId: string, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      eventBus.removeListener(TAB_EVENTS.RENDERER_TAB_ACTIVATED, listener)
      reject(new Error(`等待会话 ${threadId} 激活超时。`))
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

/**
 * MeetingServer 类
 * 负责处理所有与MCP会议相关的逻辑，包括工具定义和会议流程的组织。
 * Notes by luy:
 *   Risk 1: create_new_tab triggered by MCP may overlap with start_meeting due to lack of a clear completion event, causing race conditions.
 *   Risk 2: organizeMeeting relies on tab_title to find participants, but the title may change by user or another process might change the tab title between tool call generation and execution, leading to tab-lookup failures.
 *   Risk 3: Using title to locate conversation ID assumes the conversation ID persists even when the conversation is cleared (i.e., its length is zero), which may be changed in the future.
 *   Risk 4: If any participant's session fails, the entire meeting in background is aborted peacefully. This is by design for now. LGTM.
 */
export class MeetingServer {
  private server: Server

  constructor() {
    this.server = new Server(
      { name: 'meeting-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    )
    this.setupRequestHandlers()
  }

  public startServer(transport: Transport): void {
    this.server.connect(transport)
  }

  private setupRequestHandlers(): void {
    // 注册 `start_meeting` 工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'start_meeting',
          description:
            '启动并主持一个由多个Tab（参会者）参与的关于特定主题的讨论会议。如果你当前已经是某个会议的参与者，请勿调用！',
          inputSchema: zodToJsonSchema(StartMeetingArgsSchema)
        }
      ]
    }))

    // 处理 `start_meeting` 工具的调用
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params
      if (name !== 'start_meeting') throw new Error(`未知的工具: ${name}`)

      try {
        const meetingArgs = StartMeetingArgsSchema.parse(args)

        // 关键点: 立即返回成功响应，将耗时的会议流程放到后台执行，避免LLM工具调用超时。
        ;(async () => {
          try {
            await this.organizeMeeting(meetingArgs)
            console.log('会议流程已在后台成功完成。')
          } catch (meetingError: any) {
            console.error(`会议执行过程中发生错误: ${meetingError.message}`)
          }
        })()

        return { content: [{ type: 'text', text: '会议已成功启动，正在后台进行中...' }] }
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `会议启动失败: ${error.message}` }],
          isError: true
        }
      }
    })
  }

  /**
   * 等待指定会话生成一个新消息。
   * 这是会议流程同步的关键，通过监听 `MESSAGE_GENERATED` 事件来确保按序进行。
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
   * 组织和执行整个会议流程。
   * @param args 会议参数
   */
  private async organizeMeeting(args: z.infer<typeof StartMeetingArgsSchema>): Promise<void> {
    const { participants, topic, rounds } = args

    // 1. 准备阶段: 定位、验证并准备所有参会者
    const mainWindowId = presenter.windowPresenter.mainWindow?.id
    if (!mainWindowId) throw new Error('主窗口未找到，无法开始会议。')

    const allChatTabs = await presenter.tabPresenter.getWindowTabsData(mainWindowId)
    const meetingParticipants: MeetingParticipant[] = []
    let nameIndex = 0

    for (const p of participants) {
      let tabData

      // 优先使用 tab_id 查找
      if (p.tab_id !== undefined) {
        tabData = allChatTabs.find((t) => t.id === p.tab_id)
      }

      // 如果通过 tab_id 没找到，再尝试使用 tab_title
      let foundByTabTitle = false
      if (!tabData && p.tab_title) {
        tabData = allChatTabs.find((t) => t.title === p.tab_title)
        if (tabData) foundByTabTitle = true
      }

      // 找不到 tabData，跳过这个参会者
      if (!tabData) continue

      // 关键点: 根据tab定位方法的不同，采取不同处理方法
      if (!foundByTabTitle) {
        // 关键点1: 通过tabId定位到的tab通常为create_new_tab的结果，需要创建会话并激活
        let conversationId = await presenter.threadPresenter.getActiveConversationId(tabData.id)

        // 确保每个参会者都有一个参会名称，超过26个用‘参会者27’之类命名
        const meetingName =
          nameIndex < PARTICIPANT_NAMES.length
            ? PARTICIPANT_NAMES[nameIndex]
            : `参会者${nameIndex + 1}`
        nameIndex++

        // 确保每个参会者都要有活动会话，如没有，则需创建并等待UI同步
        if (!conversationId) {
          console.log(`参会者 (ID: ${tabData.id}) 没有活动会话，正在为其创建...`)

          // 步骤 a: 创建新会话，将自动激活并广播 'conversation:activated' 事件
          conversationId = await presenter.threadPresenter.createConversation(
            `${meetingName}`,
            {},
            tabData.id,
            { forceNewAndActivate: true } //强制创建并激活空会话，避免冗余的空会话单例检测
          )
          if (!conversationId) {
            console.warn(`为Tab ${tabData.id} 创建会话失败，将跳过此参会者。`)
            continue
          }

          // 步骤 b: 关键的UI同步点，等待渲染进程处理完激活事件并回传确认信号
          try {
            await awaitTabActivated(conversationId)
            console.log(`会话 ${conversationId} 在Tab ${tabData.id} 中已成功激活。`)
          } catch (error) {
            console.error(`等待Tab ${tabData.id} 激活失败:`, error)
            continue
          }
        }

        meetingParticipants.push({
          meetingName,
          tabId: tabData.id,
          conversationId,
          originalTitle: tabData.title,
          profile: p.profile || `你可以就“${topic}”这个话题，自由发表你的看法和观点。`
        })
      } else {
        // 关键点2: 通过title定位到的tab，通常为已有tab，无需重新创建会话并激活
        let conversationId = await presenter.threadPresenter.getActiveConversationId(tabData.id)
        if (!conversationId) {
          console.warn(`为Tab ${tabData.id} 创建会话失败，将跳过此参会者。`)
          continue
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
        `会议无法开始。只找到了 ${meetingParticipants.length} 位有效的参会者。请确保指定的Tab ID或Tab标题正确，并且它们正在进行对话。`
      )
    }

    // 在循环开始前，切换到第一个参与者的Tab
    if (meetingParticipants.length > 0) {
      await presenter.tabPresenter.switchTab(meetingParticipants[0].tabId)
    }

    // 2. 初始化会议(使用会议代号): 向所有参与者发送会议主题、规则和角色画像
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
6. 参会期间禁止调用会议相关的工具函数，如start_meeting等。
---
会议现在开始。请等待你的发言回合。
`
      eventBus.sendToTab(p.tabId, MEETING_EVENTS.INSTRUCTION, { prompt: initPrompt })

      // 等待AI模型的确认性回复，以同步流程，忽略其具体内容
      await this.waitForResponse(p.conversationId)
    }

    // 3. 会议循环: 按轮次进行发言和广播
    let _history = `会议记录\n主题: ${topic}\n`
    for (let round = 1; round <= rounds; round++) {
      for (const speaker of meetingParticipants) {
        const speakPrompt = `第 ${round}/${rounds} 轮。现在轮到您（${speaker.meetingName}）发言。请陈述您的观点。`
        eventBus.sendToTab(speaker.tabId, MEETING_EVENTS.INSTRUCTION, { prompt: speakPrompt })

        // 等待并捕获真正的、需要被记录和转发的发言内容
        const speechMessage = await this.waitForResponse(speaker.conversationId)
        const speechText = Array.isArray(speechMessage.content)
          ? speechMessage.content.find((c: any) => c.type === 'content')?.content || '[无内容]'
          : speechMessage.content || '[无内容]'

        _history += `\n[第${round}轮] ${speaker.meetingName}: ${speechText}`

        // 广播发言给其他参会者，并等待他们的确认性回复
        for (const listener of meetingParticipants) {
          if (listener.tabId !== speaker.tabId) {
            const forwardPrompt = `来自 ${speaker.meetingName} 的发言如下：\n\n---\n${speechText}\n---\n\n**以上信息仅供参考，请不要回复！**\n作为参会者，请您（${listener.meetingName}）等待我（Argus）的指示。`
            eventBus.sendToTab(listener.tabId, MEETING_EVENTS.INSTRUCTION, {
              prompt: forwardPrompt
            })

            // 等待确认性回复，并忽略内容
            await this.waitForResponse(listener.conversationId)
          }
        }
      }
    }

    // 4. 结束会议: 要求所有参与者总结
    for (const p of meetingParticipants) {
      const personalizedFinalPrompt = `讨论已结束。请您（${p.meetingName}）根据整个对话过程，对您的观点进行最终总结。`
      eventBus.sendToTab(p.tabId, MEETING_EVENTS.INSTRUCTION, { prompt: personalizedFinalPrompt })
    }

    // 注意：这里不再有返回值，因为函数在后台执行
    console.log(`关于“${topic}”的会议流程已在后台正常结束。`)
  }
}
