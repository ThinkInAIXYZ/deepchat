import type { SessionDatabase } from '@/session/data/database'
import type { HtmlRenderSource, HtmlRenderSourceRef } from '@/htmlRender/source'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import { HTML_RENDER_SECTION_TOOL_NAME, HTML_RENDER_TOOL_NAME } from '@shared/agentHtmlRenderTool'
import { DimContent } from './content'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'

/** HTML is canonical tool content, so native panels never read it from the product SQL cache. */
export class DimHtmlRender {
  private readonly content: DimContent

  constructor(
    private readonly options: {
      database: SessionDatabase
      host: DimRuntimeSupervisor
      synchronize(sessionId: string): Promise<void>
    }
  ) {
    this.content = new DimContent(options.host)
  }

  private async read(id: string) {
    const { database } = this.options
    const binding = database.dimSessionBindingsTable.get(id)
    if (!binding) throw new Error('Native HTML source is unavailable')
    const isCurrent = () => {
      const current = database.dimSessionBindingsTable.get(id)
      return Boolean(
        current &&
        current.dimSessionId === binding.dimSessionId &&
        current.branchId === binding.branchId &&
        current.generation === binding.generation &&
        !database.dimScopeChangesTable.get(id)
      )
    }
    const assertCurrent = () => {
      if (!isCurrent()) throw new Error('Native HTML source changed; restart this read')
    }
    assertCurrent()
    await this.options.synchronize(id)
    assertCurrent()
    const snapshot = await this.content.transcript(
      { sessionId: binding.dimSessionId, branchId: binding.branchId },
      id,
      database.dimSessionBindingsTable.get(id)!.cursor
    )
    assertCurrent()
    return { snapshot, isCurrent }
  }

  async source(input: HtmlRenderSourceRef): Promise<HtmlRenderSource | null> {
    const { snapshot, isCurrent } = await this.read(input.conversationId)
    const message = snapshot.messages.find((message) => message.id === input.messageId)
    const block =
      message?.role === 'assistant'
        ? this.blocks(message.content).find((block) => block.id === input.blockId)
        : undefined
    const tool = block?.tool_call
    if (block?.status !== 'success' || tool?.name !== HTML_RENDER_TOOL_NAME || !tool.htmlRender)
      return null
    const params = this.parameters(tool.params)
    if (typeof params?.html !== 'string') return null
    return {
      title: tool.htmlRender.title,
      html: params.html,
      panelId: tool.htmlRender.panelId,
      isCurrent: () =>
        isCurrent() &&
        this.options.database.deepchatMessagesTable.get(input.messageId)?.session_id ===
          input.conversationId &&
        this.options.database.deepchatAssistantBlocksTable
          .listByMessageId(input.messageId)
          .some((row) => {
            if (
              row.block_type !== 'tool_call' ||
              row.status !== 'success' ||
              row.tool_name !== HTML_RENDER_TOOL_NAME ||
              row.tool_call_id !== tool.id
            )
              return false
            try {
              const extra = JSON.parse(row.extra_json ?? '{}')
              return (
                (extra.id ?? row.tool_call_id) === input.blockId &&
                extra.toolCallExtra?.htmlRender?.panelId === tool.htmlRender!.panelId
              )
            } catch {
              return false
            }
          })
    }
  }

  async panel(id: string, panelId: string) {
    const { snapshot } = await this.read(id)
    let shell: string | null = null
    const sections = new Map<string, string>()
    for (const message of snapshot.messages) {
      if (message.role !== 'assistant') continue
      for (const block of this.blocks(message.content)) {
        const tool = block.tool_call
        if (block.status !== 'success' || !tool) continue
        const params = this.parameters(tool.params)
        if (typeof params?.html !== 'string') continue
        if (tool.name === HTML_RENDER_TOOL_NAME && tool.htmlRender?.panelId === panelId)
          shell = params.html
        if (
          tool.name === HTML_RENDER_SECTION_TOOL_NAME &&
          params.panelId === panelId &&
          typeof params.sectionId === 'string'
        )
          sections.set(params.sectionId, params.html)
      }
    }
    if (shell === null) return null
    return {
      shellBytes: Buffer.byteLength(shell, 'utf8'),
      sectionBytes: new Map(
        [...sections].map(([id, html]) => [id, Buffer.byteLength(html, 'utf8')])
      ),
      sections: [...sections].map(([id, html]) => ({ id, html }))
    }
  }

  private parameters(text?: string) {
    try {
      const value: unknown = JSON.parse(text ?? '{}')
      return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }

  private blocks(text: string): AssistantMessageBlock[] {
    try {
      const value: unknown = JSON.parse(text)
      return Array.isArray(value) ? value : []
    } catch {
      return []
    }
  }
}
