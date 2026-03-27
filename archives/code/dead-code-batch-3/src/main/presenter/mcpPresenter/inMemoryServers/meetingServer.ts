import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

const ParticipantSchema = z
  .object({
    tab_id: z.number().optional(),
    tab_title: z.string().optional(),
    profile: z.string().optional()
  })
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
            'Legacy helper. Disabled while the app migrates to the window-native architecture.',
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
      if (name !== 'start_meeting') {
        throw new Error(`未知的工具: ${name}`)
      }

      try {
        StartMeetingArgsSchema.parse(args)
        return {
          content: [
            {
              type: 'text',
              text: [
                'Legacy helper disabled.',
                'Reason: the old multi-tab meeting flow no longer matches the window-native architecture.'
              ].join(' ')
            }
          ],
          isError: true
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `会议启动失败: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true
        }
      }
    })
  }
}
