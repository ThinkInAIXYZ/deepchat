import type { ContextToolContext, ContextToolDefinition } from './tools/types'
import { createListTools } from './tools/list'
import { createReadTools } from './tools/read'
import { createTailTools } from './tools/tail'
import { createGrepTools } from './tools/grep'
import type { ContextStore } from './contextStore'

export interface IContextFilePresenter {
  getContextStore(): ContextStore
}

export class ContextToolManager {
  private readonly tools: ContextToolDefinition[]

  constructor(private readonly presenter: IContextFilePresenter) {
    this.tools = [
      ...createListTools(),
      ...createReadTools(),
      ...createTailTools(),
      ...createGrepTools()
    ]
  }

  getToolDefinitions() {
    return this.tools
  }

  async executeTool(toolName: string, args: any, conversationId: string) {
    const tool = this.tools.find((t) => t.name === toolName)
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true
      }
    }

    const context = this.createContext(conversationId)
    return await tool.handler(args, context)
  }

  private createContext(conversationId: string): ContextToolContext {
    return {
      conversationId,
      store: this.presenter.getContextStore(),
      getEntry: async (refId) => {
        return await this.presenter.getContextStore().getEntry(conversationId, refId)
      },
      ensureMaterialized: async (entry) => {
        return await this.presenter.getContextStore().ensureMaterialized(conversationId, entry)
      }
    }
  }
}
