import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ZodTypeAny } from 'zod'
import type { ContextStore, ContextManifest, ContextManifestEntry } from '../contextStore'

export type ToolResult = CallToolResult

export interface ContextToolContext {
  conversationId: string
  store: ContextStore
  getEntry: (refId: string) => Promise<{ manifest: ContextManifest; entry: ContextManifestEntry }>
  ensureMaterialized: (entry: ContextManifestEntry) => Promise<string>
}

export interface ContextToolDefinition {
  name: string
  description: string
  schema: ZodTypeAny
  handler: (args: any, context: ContextToolContext) => Promise<ToolResult>
}

export interface ContextToolDefinition {
  name: string
  description: string
  schema: ZodTypeAny
  handler: (args: any, context: ContextToolContext) => Promise<ToolResult>
}
