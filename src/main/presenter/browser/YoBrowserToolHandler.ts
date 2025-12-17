import type { DownloadInfo, ScreenshotOptions, BrowserTabInfo } from '@shared/types/browser'

export interface YoBrowserRuntime {
  ensureWindow(): Promise<number | null>
  listTabs(): Promise<BrowserTabInfo[]>
  getActiveTab(): Promise<BrowserTabInfo | null>
  getTabById(tabId: string): Promise<BrowserTabInfo | null>
  createTab(url?: string): Promise<BrowserTabInfo | null>
  navigateTab(tabId: string, url: string, timeoutMs?: number): Promise<void>
  activateTab(tabId: string): Promise<void>
  closeTab(tabId: string): Promise<void>
  reuseTab(url: string): Promise<BrowserTabInfo | null>
  extractDom(tabId: string, selector?: string): Promise<string>
  evaluateScript(tabId: string, script: string): Promise<unknown>
  captureScreenshot(tabId: string, options?: ScreenshotOptions): Promise<string>
  startDownload(url: string, savePath?: string): Promise<DownloadInfo>
}

export class YoBrowserToolHandler {
  private readonly runtime: YoBrowserRuntime

  constructor(runtime: YoBrowserRuntime) {
    this.runtime = runtime
  }

  async executeTool(toolName: string, params: Record<string, any> = {}): Promise<string> {
    switch (toolName) {
      case 'yo_browser_navigate':
        return await this.handleNavigate(params)
      case 'yo_browser_list_tabs':
        return await this.handleListTabs()
      case 'yo_browser_activate_tab':
        return await this.handleActivateTab(params)
      case 'yo_browser_extract_dom':
        return await this.handleExtractDom(params)
      case 'yo_browser_evaluate_script':
        return await this.handleEvaluateScript(params)
      case 'yo_browser_take_screenshot':
        return await this.handleScreenshot(params)
      case 'yo_browser_download_file':
        return await this.handleDownload(params)
      default:
        throw new Error(`Unknown Yo Browser tool: ${toolName}`)
    }
  }

  private async handleNavigate(params: Record<string, any>): Promise<string> {
    const url = String(params.url || '').trim()
    if (!url) {
      throw new Error('yo_browser_navigate requires url')
    }
    const timeoutMs =
      typeof params.timeout === 'number' && params.timeout > 0 ? params.timeout : undefined

    await this.runtime.ensureWindow()
    const reuse = Boolean(params.reuse ?? true)
    let tab: BrowserTabInfo | null = null
    let navigationStatus: 'success' | 'failed' = 'success'
    let errorMessage: string | undefined

    try {
      if (reuse) {
        tab = await this.runtime.reuseTab(url)
      }
      if (!tab) {
        tab = await this.runtime.createTab(url)
      }
      if (!tab) {
        throw new Error('Failed to create or reuse tab')
      }

      // Navigate if URL is different
      if (tab.url !== url) {
        try {
          await this.runtime.navigateTab(tab.id, url, timeoutMs)
        } catch (error) {
          navigationStatus = 'failed'
          errorMessage = error instanceof Error ? error.message : String(error)
          throw error
        }
      }

      // Activate the tab
      await this.runtime.activateTab(tab.id)

      // Get updated tab info after navigation
      const updatedTab = await this.runtime.getTabById(tab.id)
      if (updatedTab) {
        tab = updatedTab
      }

      // Build result message
      const result: {
        status: string
        tabId: string
        url: string
        title?: string
        message: string
        error?: string
      } = {
        status: navigationStatus,
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
        message:
          navigationStatus === 'success'
            ? `Successfully navigated to ${tab.url}`
            : `Navigation failed`
      }

      if (errorMessage) {
        result.error = errorMessage
      }

      if (navigationStatus === 'success') {
        return `Navigation completed.\nTab ID: ${result.tabId}\nURL: ${result.url}\nTitle: ${result.title || 'N/A'}`
      } else {
        return `Navigation failed.\nTab ID: ${result.tabId}\nURL: ${result.url}\nError: ${errorMessage || 'Unknown error'}`
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      navigationStatus = 'failed'
      errorMessage = errorMsg

      // Try to get tab info even if navigation failed
      let tabInfo = ''
      if (tab) {
        const currentTab = await this.runtime.getTabById(tab.id)
        if (currentTab) {
          tabInfo = `\nTab ID: ${currentTab.id}\nURL: ${currentTab.url}\nTitle: ${currentTab.title || 'N/A'}`
        }
      }

      return `Navigation failed: ${errorMessage}${tabInfo}`
    }
  }

  private async handleListTabs(): Promise<string> {
    const tabs = await this.runtime.listTabs()
    return JSON.stringify({ tabs })
  }

  private async handleActivateTab(params: Record<string, any>): Promise<string> {
    const tabId = params.tabId || params.id
    if (!tabId) {
      throw new Error('yo_browser_activate_tab requires tabId')
    }
    await this.runtime.activateTab(String(tabId))
    return `Activated tab ${tabId}`
  }

  private async handleExtractDom(params: Record<string, any>): Promise<string> {
    const tabId = await this.resolveTabId(params.tabId)
    const selector = params.selector ? String(params.selector) : undefined
    const dom = await this.runtime.extractDom(tabId, selector)
    return dom
  }

  private async handleEvaluateScript(params: Record<string, any>): Promise<string> {
    const tabId = await this.resolveTabId(params.tabId)
    const script = String(params.script || '')
    if (!script) {
      throw new Error('yo_browser_evaluate_script requires script')
    }
    const result = await this.runtime.evaluateScript(tabId, script)
    return typeof result === 'string' ? result : JSON.stringify(result)
  }

  private async handleScreenshot(params: Record<string, any>): Promise<string> {
    const tabId = await this.resolveTabId(params.tabId)
    const options: ScreenshotOptions = {
      fullPage: Boolean(params.fullPage),
      quality: typeof params.quality === 'number' ? params.quality : undefined
    }
    return await this.runtime.captureScreenshot(tabId, options)
  }

  private async handleDownload(params: Record<string, any>): Promise<string> {
    const url = String(params.url || '').trim()
    if (!url) {
      throw new Error('yo_browser_download_file requires url')
    }
    const savePath = params.savePath ? String(params.savePath) : undefined
    const download = await this.runtime.startDownload(url, savePath)
    return JSON.stringify(download)
  }

  private async resolveTabId(preferred?: string): Promise<string> {
    await this.runtime.ensureWindow()

    if (preferred) {
      const tab = await this.runtime.getTabById(String(preferred))
      if (tab) return tab.id
    }

    const active = await this.runtime.getActiveTab()
    if (active) return active.id

    const tabs = await this.runtime.listTabs()
    if (tabs.length > 0) return tabs[0].id

    const newTab = await this.runtime.createTab('about:blank')
    if (!newTab) {
      throw new Error('No available tab to operate on')
    }
    return newTab.id
  }
}
