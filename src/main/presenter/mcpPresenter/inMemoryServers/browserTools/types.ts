import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { CallToolResult, Notification, Request } from '@modelcontextprotocol/sdk/types.js'
import type { ZodTypeAny } from 'zod'
import type { BrowserSessionManager } from '../browserContext/BrowserSessionManager'

export type ToolResult = CallToolResult

export interface BrowserToolContext {
  sessionManager: BrowserSessionManager
  showWindow: boolean
  getConversationId: (
    args: { conversationId?: string } | undefined,
    extra?: RequestHandlerExtra<Request, Notification>
  ) => string
}

export interface BrowserToolDefinition {
  name: string
  description: string
  schema: ZodTypeAny
  handler: (
    args: any,
    context: BrowserToolContext,
    extra: RequestHandlerExtra<Request, Notification>
  ) => Promise<ToolResult>
  annotations?: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
}
