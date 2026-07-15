import type { BrowserToolDefinition, YoBrowserStatus } from '@shared/types/browser'

export class BrowserContextBuilder {
  static buildSystemPrompt(status: YoBrowserStatus): string {
    const page = status.page
    const pageLine = page ? `${page.title || page.url || 'Untitled'} (${page.url})` : 'none'

    return [
      'Yo Browser is available for web exploration.',
      `Current page: ${pageLine}`,
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
