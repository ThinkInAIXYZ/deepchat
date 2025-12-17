import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { CallToolResult, Notification, Request } from '@modelcontextprotocol/sdk/types.js'
import type { ZodTypeAny } from 'zod'
import type { BrowserTab } from '../BrowserTab'

export type ToolResult = CallToolResult

export interface BrowserToolContext {
  getTab: (tabId?: string) => Promise<BrowserTab | null>
  getActiveTab: () => Promise<BrowserTab | null>
  resolveTabId: (
    args: { tabId?: string } | undefined,
    extra?: RequestHandlerExtra<Request, Notification>
  ) => Promise<string>
  // Tab management methods
  createTab?: (url?: string) => Promise<{ id: string; url: string; title: string } | null>
  listTabs?: () => Promise<Array<{ id: string; url: string; title: string; isActive: boolean }>>
  activateTab?: (tabId: string) => Promise<void>
  closeTab?: (tabId: string) => Promise<void>
  // Download methods
  downloadFile?: (
    url: string,
    savePath?: string
  ) => Promise<{
    id: string
    url: string
    filePath?: string
    status: string
  }>
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
