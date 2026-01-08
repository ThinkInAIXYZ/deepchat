import type { MCPToolDefinition } from './core'

export type ContextKind = 'artifact' | 'history' | 'catalog'

export type ContextRefStrategy = 'eager' | 'lazy'

export interface ContextRef {
  id: string
  kind: ContextKind
  mimeType?: string
  byteSize?: number
  createdAt: number
  hint: string
}

export interface ContextExportData {
  conversationId: string
  exportedAt: number
  version: 1
  items: ContextRef[]
  files: Record<string, string>
  metadata?: Record<string, unknown>
}

export interface ContextStoreClient {
  createRef(kind: ContextKind, hint: string, mimeType?: string): Promise<ContextRef>
  write(refId: string, content: string | Buffer): Promise<void>
  append(refId: string, content: string | Buffer): Promise<void>
  listRefs(kind?: ContextKind, limit?: number): Promise<ContextRef[]>
}

export interface IContextFilePresenter {
  initialize(): Promise<void>

  getToolDefinitions(): Promise<MCPToolDefinition[]>

  callTool(toolName: string, args: Record<string, unknown>, conversationId: string): Promise<string>

  export(conversationId: string): Promise<ContextExportData>

  import(conversationId: string, data: ContextExportData): Promise<void>

  createStore(conversationId: string): ContextStoreClient

  getContextStore(): ContextStore
}

import type { ContextStore } from '@/main/presenter/contextFiles/contextStore'
