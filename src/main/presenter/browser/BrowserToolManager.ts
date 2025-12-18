import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { Notification, Request } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserToolContext, BrowserToolDefinition } from './tools/types'
import { createNavigateTools } from './tools/navigate'
import { createActionTools } from './tools/action'
import { createContentTools } from './tools/content'
// import { createScreenshotTools } from './tools/screenshot'
import { createTabTools } from './tools/tabs'
import { createDownloadTools } from './tools/download'
import type { YoBrowserPresenter } from './YoBrowserPresenter'

export class BrowserToolManager {
  private readonly presenter: YoBrowserPresenter
  private readonly tools: BrowserToolDefinition[]

  constructor(presenter: YoBrowserPresenter) {
    this.presenter = presenter
    this.tools = [
      ...createNavigateTools(),
      ...createActionTools(),
      ...createContentTools(),
      // ...createScreenshotTools(),
      ...createTabTools(),
      ...createDownloadTools()
    ]
  }

  getToolDefinitions() {
    return this.tools
  }

  async executeTool(
    toolName: string,
    args: any,
    extra?: RequestHandlerExtra<Request, Notification>
  ) {
    const tool = this.tools.find((t) => t.name === toolName)
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true
      }
    }

    const context = this.createContext()
    return await tool.handler(args, context, extra || ({} as any))
  }

  private createContext(): BrowserToolContext {
    return {
      getTab: async (tabId?: string) => {
        return await this.presenter.getBrowserTab(tabId)
      },
      getActiveTab: async () => {
        return await this.presenter.getBrowserTab()
      },
      resolveTabId: async (args?: { tabId?: string }) => {
        if (args?.tabId) {
          return args.tabId
        }
        const active = await this.presenter.getActiveTab()
        if (active) return active.id
        const tabs = await this.presenter.listTabs()
        if (tabs.length > 0) return tabs[0].id
        const newTab = await this.presenter.createTab('about:blank')
        if (!newTab) {
          throw new Error('No available tab to operate on')
        }
        return newTab.id
      },
      createTab: async (url?: string) => {
        const tab = await this.presenter.createTab(url)
        if (!tab) return null
        return { id: tab.id, url: tab.url, title: tab.title || '' }
      },
      listTabs: async () => {
        const tabs = await this.presenter.listTabs()
        const active = await this.presenter.getActiveTab()
        return tabs.map((tab) => ({
          id: tab.id,
          url: tab.url,
          title: tab.title || '',
          isActive: tab.id === active?.id
        }))
      },
      activateTab: async (tabId: string) => {
        await this.presenter.activateTab(tabId)
      },
      closeTab: async (tabId: string) => {
        await this.presenter.closeTab(tabId)
      },
      downloadFile: async (url: string, savePath?: string) => {
        const download = await this.presenter.startDownload(url, savePath)
        return {
          id: download.id,
          url: download.url,
          filePath: download.filePath,
          status: download.status
        }
      }
    }
  }
}
