import type { BrowserToolDefinition, BrowserWindowInfo } from '@shared/types/browser'

export class BrowserContextBuilder {
  static buildSystemPrompt(windows: BrowserWindowInfo[], activeWindowId: number | null): string {
    const activeWindow = windows.find((browserWindow) => browserWindow.id === activeWindowId)
    const windowLines =
      windows.length === 0
        ? ['- No browser windows open.']
        : windows.map((browserWindow) => {
            const marker = browserWindow.id === activeWindowId ? '*' : ' '
            const title = browserWindow.page.title || browserWindow.page.url || 'Untitled'
            return `${marker} ${title} (${browserWindow.page.url || 'about:blank'})`
          })
    return [
      'Yo Browser is available for web exploration.',
      `Active window: ${activeWindow ? `${activeWindow.page.title || activeWindow.page.url} (${activeWindow.id})` : 'none'}`,
      'Open browser windows:',
      ...windowLines,
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
