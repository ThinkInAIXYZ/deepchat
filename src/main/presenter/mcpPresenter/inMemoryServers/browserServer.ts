import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { BrowserSessionManager } from './browserContext/BrowserSessionManager'
import { createNavigateTools } from './browserTools/navigate'
import { createActionTools } from './browserTools/action'
import { createContentTools } from './browserTools/content'
import { createScreenshotTools } from './browserTools/screenshot'
import { createTabTools } from './browserTools/tabs'
import { createDownloadTools } from './browserTools/download'
import type { BrowserToolContext, BrowserToolDefinition, ToolResult } from './browserTools/types'

export interface BrowserServerConfig {
  showWindow?: boolean
  sessionTimeoutMs?: number
}

export class BrowserServer {
  private readonly server: Server
  private readonly sessionManager: BrowserSessionManager
  private readonly tools: BrowserToolDefinition[]
  private readonly showWindow: boolean

  constructor(env?: BrowserServerConfig) {
    this.showWindow = env?.showWindow ?? false
    this.sessionManager = new BrowserSessionManager({
      showWindow: this.showWindow,
      sessionTimeoutMs: env?.sessionTimeoutMs
    })

    this.tools = [
      ...createNavigateTools(),
      ...createActionTools(),
      ...createContentTools(),
      ...createScreenshotTools(),
      ...createTabTools(),
      ...createDownloadTools()
    ]

    this.server = new Server(
      {
        name: 'deepchat-inmemory/browser-server',
        version: '0.1.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )

    this.setupRequestHandlers()
  }

  public async startServer(transport: Transport): Promise<void> {
    this.server.connect(transport)
  }

  private setupRequestHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: zodToJsonSchema(tool.schema),
          annotations: tool.annotations
        }))
      }
    })

    this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const tool = this.tools.find((item) => item.name === request.params.name)
      if (!tool) {
        return this.createErrorResult(`Unknown tool: ${request.params.name}`)
      }

      try {
        const args = request.params.arguments ?? {}
        const context: BrowserToolContext = {
          sessionManager: this.sessionManager,
          showWindow: this.showWindow,
          getConversationId: (toolArgs, toolExtra) =>
            this.resolveConversationId(toolArgs, toolExtra)
        }
        const result = await tool.handler(args, context, extra)
        return result
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        return this.createErrorResult(message)
      }
    })
  }

  private resolveConversationId(
    args?: { conversationId?: string },
    extra?: Parameters<BrowserToolDefinition['handler']>[2]
  ): string {
    if (args?.conversationId && args.conversationId.trim()) {
      return args.conversationId
    }

    const meta = extra?._meta as Record<string, unknown> | undefined
    if (meta) {
      const maybeConversation =
        (meta.conversationId as string | undefined) ||
        (meta.threadId as string | undefined) ||
        (meta.session as { conversationId?: string } | undefined)?.conversationId
      if (maybeConversation) {
        return maybeConversation
      }
    }

    if (extra?.sessionId && typeof extra.sessionId === 'string') {
      return extra.sessionId
    }

    return 'default'
  }

  private createErrorResult(message: string): ToolResult {
    return {
      content: [
        {
          type: 'text',
          text: message
        }
      ],
      isError: true
    }
  }
}
