import fs from 'fs/promises'
import path from 'path'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { ContextStore, type ContextRefStrategy } from './contextStore'
import { ContextToolManager } from './ContextToolManager'
import type { ContextExportData } from '@shared/types/presenters/contextFiles.presenter'

export class ContextFilePresenter {
  private readonly store: ContextStore
  private readonly toolManager: any

  constructor() {
    this.store = new ContextStore()
    this.toolManager = new ContextToolManager(this)
  }

  async initialize(): Promise<void> {}

  getContextStore() {
    return this.store
  }

  async getToolDefinitions() {
    const contextTools = this.toolManager.getToolDefinitions()
    return contextTools.map((tool) => {
      const jsonSchema = zodToJsonSchema(tool.schema) as {
        type?: string
        properties?: Record<string, unknown>
        required?: string[]
        [key: string]: unknown
      }
      return {
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object' as const,
            properties: (jsonSchema.properties || {}) as Record<string, unknown>,
            required: (jsonSchema.required || []) as string[]
          }
        },
        server: {
          name: 'context-files',
          icons: '📁',
          description: 'DeepChat built-in context files access'
        }
      }
    })
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    conversationId: string
  ): Promise<string> {
    const result = await this.toolManager.executeTool(toolName, args, conversationId)
    const textParts = result.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
    const textContent = textParts.join('\n\n')
    if (result.isError) {
      throw new Error(textContent || 'Tool execution failed')
    }
    return textContent
  }

  async export(conversationId: string): Promise<ContextExportData> {
    const conversationRoot = this.store.getConversationRoot(conversationId)

    const files: Record<string, string> = {}
    const refItems = await this.store.listRefs(conversationId)

    for (const ref of refItems) {
      try {
        const filePath = await this.store.resolve(conversationId, ref.id)
        const content = await fs.readFile(filePath, 'utf-8')
        const refPath = path.relative(conversationRoot, filePath).replace(/\\/g, '/')
        files[refPath] = content
      } catch (error) {
        console.error(`Failed to export context file ${ref.id}:`, error)
      }
    }

    return {
      conversationId,
      exportedAt: Date.now(),
      version: 1,
      items: refItems,
      files
    }
  }

  async import(conversationId: string, data: ContextExportData): Promise<void> {
    const conversationRoot = this.store.getConversationRoot(conversationId)
    await fs.mkdir(conversationRoot, { recursive: true })

    const entryMap = new Map<string, { path: string; strategy: ContextRefStrategy }>()
    for (const [relativePath] of Object.entries(data.files)) {
      const normalizedPath = relativePath.replace(/\\/g, '/')
      const segments = normalizedPath.split('/')
      const filename = segments[segments.length - 1]
      const refId = filename.replace(/\.[^.]+$/, '') || filename
      entryMap.set(refId, { path: normalizedPath, strategy: 'eager' })

      const filePath = path.join(conversationRoot, normalizedPath)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, data.files[relativePath], 'utf-8')
    }

    for (const ref of data.items) {
      const meta = entryMap.get(ref.id)
      if (!meta) continue

      try {
        await this.store.createRef({
          conversationId,
          kind: ref.kind,
          hint: ref.hint,
          mimeType: ref.mimeType,
          strategy: 'eager'
        })
      } catch (error) {
        console.error(`Failed to import context Ref ${ref.id}:`, error)
      }
    }
  }

  createStore(conversationId: string) {
    return {
      createRef: async (kind: any, hint: string, mimeType?: string) => {
        const result = await this.store.createRef({
          conversationId,
          kind,
          hint,
          mimeType,
          strategy: 'eager'
        })
        return result.ref
      },
      write: async (refId: string, content: string | Buffer) => {
        await this.store.write(conversationId, refId, content)
      },
      append: async (refId: string, content: string | Buffer) => {
        await this.store.append(conversationId, refId, content)
      },
      listRefs: async (kind?: any, limit?: number) => {
        return this.store.listRefs(conversationId, kind, limit)
      }
    }
  }
}
