import type { BrowserTabInfo, BrowserToolDefinition } from '@shared/types/browser'

export class BrowserContextBuilder {
  static buildSystemPrompt(tabs: BrowserTabInfo[], activeTabId: string | null): string {
    const activeTab = tabs.find((tab) => tab.id === activeTabId)
    const tabLines =
      tabs.length === 0
        ? ['- No tabs open.']
        : tabs.map((tab) => {
            const marker = tab.id === activeTabId ? '*' : ' '
            const title = tab.title || tab.url || 'Untitled'
            return `${marker} ${title} (${tab.url || 'about:blank'})`
          })
    return [
      'Yo Browser is available for web exploration.',
      `Active tab: ${activeTab ? `${activeTab.title || activeTab.url} (${activeTab.id})` : 'none'}`,
      'Open tabs:',
      ...tabLines,
      'Use Yo Browser to browse, extract DOM, run scripts, capture screenshots, and download files.'
    ].join('\n')
  }

  static summarizeTools(tools: BrowserToolDefinition[]): string {
    if (!tools.length) {
      return 'No Yo Browser tools available.'
    }

    return tools
      .map(
        (tool) =>
          `- ${tool.name}: ${tool.description}${tool.requiresVision ? ' (vision only)' : ''}`
      )
      .join('\n')
  }
}
