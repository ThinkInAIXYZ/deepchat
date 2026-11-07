import type { ComputedRef, InjectionKey } from 'vue'
import { HTML_RENDER_SECTION_TOOL_NAME } from '@shared/agentHtmlRenderTool'
import type { DisplayMessage } from '@/features/chat-page/model/displayMessage'

export type HtmlRenderSection = { id: string; html: string }
export type HtmlRenderPanelSections = ReadonlyMap<string, readonly HtmlRenderSection[]>

export const HTML_RENDER_SECTIONS_KEY: InjectionKey<ComputedRef<HtmlRenderPanelSections>> =
  Symbol('htmlRenderSections')

type ParsedSection = { panelId: string; sectionId: string; html: string } | null

export const createHtmlRenderSectionCollector = () => {
  // The list recomputes on every streaming flush; reuse parses of unchanged params.
  let parseCache = new Map<string, { params: string; section: ParsedSection }>()

  const parse = (params: string): ParsedSection => {
    try {
      const value = JSON.parse(params) as Record<string, unknown>
      return typeof value.panelId === 'string' &&
        typeof value.sectionId === 'string' &&
        typeof value.html === 'string'
        ? { panelId: value.panelId, sectionId: value.sectionId, html: value.html }
        : null
    } catch {
      return null
    }
  }

  return (messages: readonly DisplayMessage[]): HtmlRenderPanelSections => {
    const nextCache = new Map<string, { params: string; section: ParsedSection }>()
    const panels = new Map<string, Map<string, string>>()
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
        const section =
          cached && cached.params === toolCall.params ? cached.section : parse(toolCall.params)
        nextCache.set(key, { params: toolCall.params, section })
        if (!section) return
        const sections = panels.get(section.panelId) ?? new Map<string, string>()
        sections.set(section.sectionId, section.html)
        panels.set(section.panelId, sections)
      })
    }
    parseCache = nextCache
    return new Map(
      Array.from(panels, ([panelId, sections]) => [
        panelId,
        Array.from(sections, ([id, html]) => ({ id, html }))
      ])
    )
  }
}
