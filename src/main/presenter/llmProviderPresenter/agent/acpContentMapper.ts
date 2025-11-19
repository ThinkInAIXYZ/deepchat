import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'
import type { AssistantMessageBlock } from '@shared/chat'
import { createStreamEvent, type LLMCoreStreamEvent } from '@shared/types/core/llm-events'

export interface MappedContent {
  events: LLMCoreStreamEvent[]
  blocks: AssistantMessageBlock[]
}

const now = () => Date.now()

export class AcpContentMapper {
  map(notification: schema.SessionNotification): MappedContent {
    const { update } = notification
    const payload: MappedContent = { events: [], blocks: [] }

    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        this.pushContent(update.content, 'text', payload)
        break
      case 'agent_thought_chunk':
        this.pushContent(update.content, 'reasoning', payload)
        break
      case 'tool_call':
      case 'tool_call_update':
        this.handleToolCallUpdate(update, payload)
        break
      case 'plan':
        this.handlePlanUpdate(update, payload)
        break
      case 'user_message_chunk':
        // ignore echo
        break
      default:
        console.debug('[ACP] Unhandled session update', update.sessionUpdate)
        break
    }

    return payload
  }

  private pushContent(
    content:
      | { type: 'text'; text: string }
      | { type: 'image'; data: string; mimeType: string }
      | { type: 'audio'; data: string; mimeType: string }
      | { type: 'resource_link'; uri: string }
      | { type: 'resource'; resource: unknown }
      | undefined,
    channel: 'text' | 'reasoning',
    payload: MappedContent
  ) {
    if (!content) return

    switch (content.type) {
      case 'text':
        if (channel === 'text') {
          payload.events.push(createStreamEvent.text(content.text))
          payload.blocks.push(this.createBlock('content', content.text))
        } else {
          payload.events.push(createStreamEvent.reasoning(content.text))
          payload.blocks.push(this.createBlock('reasoning_content', content.text))
        }
        break
      case 'image':
        payload.events.push(
          createStreamEvent.imageData({ data: content.data, mimeType: content.mimeType })
        )
        payload.blocks.push(
          this.createBlock('image', undefined, {
            image_data: { data: content.data, mimeType: content.mimeType }
          })
        )
        break
      case 'audio':
        this.emitAsText(`[audio ${content.mimeType}]`, channel, payload)
        break
      case 'resource_link':
        this.emitAsText(content.uri, channel, payload)
        break
      case 'resource':
        this.emitAsText(JSON.stringify(content.resource), channel, payload)
        break
      default:
        this.emitAsText(JSON.stringify(content), channel, payload)
        break
    }
  }

  private emitAsText(text: string, channel: 'text' | 'reasoning', payload: MappedContent) {
    if (channel === 'text') {
      payload.events.push(createStreamEvent.text(text))
      payload.blocks.push(this.createBlock('content', text))
    } else {
      payload.events.push(createStreamEvent.reasoning(text))
      payload.blocks.push(this.createBlock('reasoning_content', text))
    }
  }

  private handleToolCallUpdate(
    update: Extract<
      schema.SessionNotification['update'],
      { sessionUpdate: 'tool_call' | 'tool_call_update' }
    >,
    payload: MappedContent
  ) {
    const title = 'title' in update ? update.title : null
    const status = 'status' in update ? update.status : null
    const reasoningText = ['Tool call', title, status].filter(Boolean).join(' - ')
    if (reasoningText) {
      payload.events.push(createStreamEvent.reasoning(reasoningText))
      payload.blocks.push(
        this.createBlock('action', reasoningText, { action_type: 'tool_call_permission' })
      )
    }

    if ('content' in update && update.content) {
      const serialized = this.formatToolCallContent(update.content)
      if (serialized) {
        payload.events.push(createStreamEvent.text(serialized))
        payload.blocks.push(this.createBlock('tool_call', serialized))
      }
    }
  }

  private handlePlanUpdate(
    update: Extract<schema.SessionNotification['update'], { sessionUpdate: 'plan' }>,
    payload: MappedContent
  ) {
    const summary = (update.entries || [])
      .map((entry) => `${entry.content} (${entry.status})`)
      .join('; ')
    if (!summary) return
    const text = `Plan updated: ${summary}`
    payload.events.push(createStreamEvent.reasoning(text))
    payload.blocks.push(this.createBlock('reasoning_content', text))
  }

  private formatToolCallContent(contents: schema.ToolCallContent[]): string {
    return contents
      .map((item) => {
        if (item.type === 'content') {
          const block = item.content
          switch (block.type) {
            case 'text':
              return block.text
            case 'image':
              return '[image]'
            case 'audio':
              return '[audio]'
            case 'resource':
              return '[resource]'
            case 'resource_link':
              return block.uri
            default:
              return JSON.stringify(block)
          }
        }
        if (item.type === 'terminal') {
          return 'output' in item && typeof item.output === 'string'
            ? item.output
            : `[terminal:${item.terminalId}]`
        }
        if (item.type === 'diff') {
          return item.path ? `diff: ${item.path}` : '[diff]'
        }
        return JSON.stringify(item)
      })
      .filter(Boolean)
      .join('\n')
  }

  private createBlock(
    type: AssistantMessageBlock['type'],
    content?: string,
    extra?: Partial<AssistantMessageBlock>
  ): AssistantMessageBlock {
    return {
      type,
      content,
      status: 'success',
      timestamp: now(),
      ...extra
    } as AssistantMessageBlock
  }
}
