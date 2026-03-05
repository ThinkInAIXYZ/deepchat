// src/main/presenter/mcpPresenter/inMemoryServers/meetingServer.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { presenter } from '@/presenter'
import type { ChatMessageRecord } from '@shared/types/agent-interface'

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

const StartMeetingArgsSchema = z.object({
  participants: z
    .array(ParticipantSchema)
    .min(2, { message: '会议至少需要两位参会者。' })
    .describe('参会者列表。'),
  topic: z.string().describe('会议的核心讨论主题。'),
  rounds: z.number().optional().default(3).describe('讨论的轮次数，默认为3轮。')
})

interface MeetingParticipant {
  meetingName: string
  tabId: number
  webContentsId: number
  conversationId: string
  originalTitle: string
  profile: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * MeetingServer
 *
 * Migrated to new-agent stack:
 * - session lookup/creation uses newAgentPresenter
 * - prompt dispatch uses newAgentPresenter.sendMessage directly
 * - response waiting polls deepchat messages/status instead of legacy conversation events
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
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'start_meeting',
          description:
            '启动并主持一个由多个Tab（参会者）参与的关于特定主题的讨论会议。如果你当前已经是某个会议的参与者，请勿调用！',
          inputSchema: zodToJsonSchema(StartMeetingArgsSchema),
          annotations: {
            title: 'Start Meeting',
            destructiveHint: false
          }
        }
      ]
    }))

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params
      if (name !== 'start_meeting') throw new Error(`未知的工具: ${name}`)

      try {
        const meetingArgs = StartMeetingArgsSchema.parse(args)

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

  private extractAssistantText(message: ChatMessageRecord): string {
    try {
      const parsed = JSON.parse(message.content)
      if (Array.isArray(parsed)) {
        const texts = parsed
          .map((block: { content?: unknown }) =>
            typeof block?.content === 'string' ? block.content : ''
          )
          .filter((text) => text.length > 0)
        if (texts.length > 0) {
          return texts.join('\n')
        }
      }
    } catch {
      // Keep raw fallback.
    }
    return message.content || '[无内容]'
  }

  private async waitUntilSessionReady(conversationId: string, timeout = 120000): Promise<void> {
    const startedAt = Date.now()

    while (Date.now() - startedAt < timeout) {
      const session = await presenter.newAgentPresenter.getSession(conversationId)
      if (!session) {
        throw new Error(`会话不存在: ${conversationId}`)
      }
      if (session.status !== 'generating') {
        return
      }
      await sleep(600)
    }

    throw new Error(`等待会话 ${conversationId} 空闲超时。`)
  }

  private async waitForResponse(
    conversationId: string,
    previousAssistantMessageId: string | null,
    timeout = 180000
  ): Promise<ChatMessageRecord> {
    const startedAt = Date.now()

    while (Date.now() - startedAt < timeout) {
      const messages = await presenter.newAgentPresenter.getMessages(conversationId)
      const assistants = messages.filter((msg) => msg.role === 'assistant')
      const latest = assistants.length > 0 ? assistants[assistants.length - 1] : null

      if (
        latest &&
        latest.id !== previousAssistantMessageId &&
        (latest.status === 'sent' || latest.status === 'error')
      ) {
        return latest
      }

      await sleep(700)
    }

    throw new Error(
      `超时: 等待会话 ${conversationId} 的回复超过 ${Math.floor(timeout / 1000)} 秒。`
    )
  }

  private async sendPromptAndWait(conversationId: string, prompt: string): Promise<string> {
    await this.waitUntilSessionReady(conversationId)

    const messagesBefore = await presenter.newAgentPresenter.getMessages(conversationId)
    const previousAssistant = [...messagesBefore].reverse().find((msg) => msg.role === 'assistant')

    await presenter.newAgentPresenter.sendMessage(conversationId, prompt)
    const response = await this.waitForResponse(conversationId, previousAssistant?.id ?? null)
    return this.extractAssistantText(response)
  }

  private buildMeetingName(index: number): string {
    return index < PARTICIPANT_NAMES.length ? PARTICIPANT_NAMES[index] : `Participant-${index + 1}`
  }

  private async resolveParticipantSession(options: {
    tabId: number
    meetingName: string
    topic: string
  }): Promise<{ conversationId: string; webContentsId: number } | null> {
    const tabView = await presenter.tabPresenter.getTab(options.tabId)
    if (!tabView || tabView.webContents.isDestroyed()) {
      return null
    }

    const webContentsId = tabView.webContents.id
    const activeSession = await presenter.newAgentPresenter.getActiveSession(webContentsId)
    if (activeSession) {
      return {
        conversationId: activeSession.id,
        webContentsId
      }
    }

    const bootstrapPrompt = `You are ${options.meetingName}. Topic: ${options.topic}. Reply briefly with "Ready".`
    const created = await presenter.newAgentPresenter.createSession(
      {
        agentId: 'deepchat',
        message: bootstrapPrompt
      },
      webContentsId
    )

    await this.waitForResponse(created.id, null, 120000)

    return {
      conversationId: created.id,
      webContentsId
    }
  }

  private async organizeMeeting(args: z.infer<typeof StartMeetingArgsSchema>): Promise<void> {
    const { participants, topic, rounds } = args

    const mainWindowId = presenter.windowPresenter.mainWindow?.id
    if (!mainWindowId) throw new Error('主窗口未找到，无法开始会议。')

    const allChatTabs = await presenter.tabPresenter.getWindowTabsData(mainWindowId)
    const meetingParticipants: MeetingParticipant[] = []
    let nameIndex = 0

    for (const p of participants) {
      let tabData = null as (typeof allChatTabs)[number] | null

      if (p.tab_id !== undefined) {
        tabData = allChatTabs.find((t) => t.id === p.tab_id) ?? null
      }

      if (!tabData && p.tab_title) {
        tabData = allChatTabs.find((t) => t.title === p.tab_title) ?? null
      }

      if (!tabData) {
        continue
      }

      const meetingName = this.buildMeetingName(nameIndex)
      nameIndex += 1

      const resolved = await this.resolveParticipantSession({
        tabId: tabData.id,
        meetingName,
        topic
      })

      if (!resolved) {
        console.warn(`Tab ${tabData.id} 无法用于会议，将跳过。`)
        continue
      }

      meetingParticipants.push({
        meetingName,
        tabId: tabData.id,
        webContentsId: resolved.webContentsId,
        conversationId: resolved.conversationId,
        originalTitle: tabData.title,
        profile: p.profile || `你可以就“${topic}”这个话题，自由发表你的看法和观点。`
      })
    }

    if (meetingParticipants.length < 2) {
      throw new Error(
        `会议无法开始。只找到了 ${meetingParticipants.length} 位有效的参会者。请确保指定的Tab ID或Tab标题正确。`
      )
    }

    await presenter.tabPresenter.switchTab(meetingParticipants[0].tabId)

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
会议现在开始。请等待你的发言回合。`

      await this.sendPromptAndWait(p.conversationId, initPrompt)
    }

    let _history = `会议记录\n主题: ${topic}\n`

    for (let round = 1; round <= rounds; round++) {
      for (const speaker of meetingParticipants) {
        const speakPrompt = `第 ${round}/${rounds} 轮。现在轮到您（${speaker.meetingName}）发言。请陈述您的观点。`
        const speechText = await this.sendPromptAndWait(speaker.conversationId, speakPrompt)

        _history += `\n[第${round}轮] ${speaker.meetingName}: ${speechText}`

        for (const listener of meetingParticipants) {
          if (listener.tabId === speaker.tabId) {
            continue
          }

          const forwardPrompt = `来自 ${speaker.meetingName} 的发言如下：\n\n---\n${speechText}\n---\n\n以上信息仅供参考，请不要展开讨论。请回复“收到”，并等待下一步指示。`
          await this.sendPromptAndWait(listener.conversationId, forwardPrompt)
        }
      }
    }

    for (const p of meetingParticipants) {
      const personalizedFinalPrompt = `讨论已结束。请您（${p.meetingName}）根据整个对话过程，对您的观点进行最终总结。`
      await this.sendPromptAndWait(p.conversationId, personalizedFinalPrompt)
    }

    console.log(`关于“${topic}”的会议流程已在后台正常结束。`)
  }
}
