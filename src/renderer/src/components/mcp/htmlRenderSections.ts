import type { ComputedRef, InjectionKey } from 'vue'
import { HTML_RENDER_SECTION_TOOL_NAME } from '@shared/agentHtmlRenderTool'
import type { DisplayMessage } from '@/features/chat-page/model/displayMessage'

/** panelId → a key that changes whenever a successful section block of that panel is added or removed. */
export type HtmlRenderSectionRevisions = ReadonlyMap<string, string>

export const HTML_RENDER_SECTIONS_KEY: InjectionKey<ComputedRef<HtmlRenderSectionRevisions>> =
  Symbol('htmlRenderSections')

const readPanelId = (params: string): string | null => {
  try {
    const value = JSON.parse(params) as Record<string, unknown>
    return typeof value.panelId === 'string' ? value.panelId : null
  } catch {
    return null
  }
}

export const createHtmlRenderSectionCollector = () => {
  // The list recomputes on every streaming flush; reuse parses of unchanged params.
  let parseCache = new Map<string, { params: string; panelId: string | null }>()

  return (messages: readonly DisplayMessage[]): HtmlRenderSectionRevisions => {
    const nextCache = new Map<string, { params: string; panelId: string | null }>()
    const panels = new Map<string, string[]>()
    for (const message of messages) {
      if (message.role !== 'assistant') continue
      message.content.forEach((block, index) => {
        const toolCall = block.tool_call
        if (
          block.type !== 'tool_call' ||
          block.status !== 'success' ||
          toolCall?.name !== HTML_RENDER_SECTION_TOOL_NAME ||
          !toolCall.params
        ) {
          return
        }
        const key = `${message.id}:${toolCall.id ?? index}`
        const cached = parseCache.get(key)
        const panelId =
          cached && cached.params === toolCall.params
            ? cached.panelId
            : readPanelId(toolCall.params)
        nextCache.set(key, { params: toolCall.params, panelId })
        if (!panelId) return
        panels.set(panelId, [...(panels.get(panelId) ?? []), key])
      })
    }
    parseCache = nextCache
    return new Map(Array.from(panels, ([panelId, keys]) => [panelId, keys.join('|')]))
  }
}
