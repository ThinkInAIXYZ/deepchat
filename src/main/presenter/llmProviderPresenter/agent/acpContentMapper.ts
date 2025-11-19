import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'
import type { AssistantMessageBlock } from '@shared/chat'
import { createStreamEvent, type LLMCoreStreamEvent } from '@shared/types/core/llm-events'

export interface MappedContent {
  events: LLMCoreStreamEvent[]
  blocks: AssistantMessageBlock[]
}

interface ToolCallState {
  sessionId: string
  toolCallId: string
  toolName: string
  argumentsBuffer: string
  status?: schema.ToolCallStatus | null
  started: boolean
}

const now = () => Date.now()

export class AcpContentMapper {
  private readonly toolCallStates = new Map<string, ToolCallState>()

  map(notification: schema.SessionNotification): MappedContent {
    const { update, sessionId } = notification
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
        this.handleToolCallUpdate(sessionId, update, payload)
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
    sessionId: string,
    update: Extract<
      schema.SessionNotification['update'],
      { sessionUpdate: 'tool_call' | 'tool_call_update' }
    >,
    payload: MappedContent
  ) {
    const toolCallId = update.toolCallId
    if (!toolCallId) return

    const rawTitle = 'title' in update ? (update.title ?? undefined) : undefined
    const title = typeof rawTitle === 'string' ? rawTitle.trim() || undefined : undefined
    const status = 'status' in update ? (update.status ?? undefined) : undefined

    const state = this.getOrCreateToolCallState(sessionId, toolCallId, title)
    if (title && state.toolName !== title) {
      state.toolName = title
    }

    const previousStatus = state.status
    if (status) {
      state.status = status
    }

    this.emitToolCallStartIfNeeded(state, payload)

    const shouldEmitReasoning =
      update.sessionUpdate === 'tool_call' || (status && status !== previousStatus)
    if (shouldEmitReasoning) {
      const reasoningText = this.buildToolCallReasoning(state.toolName, status)
      if (reasoningText) {
        payload.events.push(createStreamEvent.reasoning(reasoningText))
        payload.blocks.push(
          this.createBlock('action', reasoningText, { action_type: 'tool_call_permission' })
        )
      }
    }

    const content = 'content' in update ? (update.content ?? undefined) : undefined
    const chunk = this.formatToolCallContent(content, '')
    if (chunk) {
      this.emitToolCallChunk(state, chunk, payload)
    }

    if (status === 'completed' || status === 'failed') {
      this.emitToolCallEnd(state, payload, status === 'failed')
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

  private formatToolCallContent(
    contents?: schema.ToolCallContent[] | null,
    joiner: string = '\n'
  ): string {
    if (!contents?.length) {
      return ''
    }

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
      .join(joiner)
  }

  private tryParseJsonArguments(buffer: string, toolCallId: string): string | undefined {
    const trimmed = buffer.trim()
    if (!trimmed) {
      return undefined
    }

    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return trimmed
    }

    try {
      JSON.parse(trimmed)
      return trimmed
    } catch (error) {
      const preview = trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed
      console.warn(
        `[ACP] Tool call arguments appear incomplete (toolCallId=${toolCallId}): ${preview}`,
        error
      )
      return trimmed
    }
  }

  private buildToolCallReasoning(
    title?: string,
    status?: schema.ToolCallStatus | null
  ): string | null {
    const statusText = status ? status.replace(/_/g, ' ') : undefined
    const segments = ['Tool call', title, statusText].filter(Boolean)
    return segments.length ? segments.join(' - ') : null
  }

  private emitToolCallStartIfNeeded(state: ToolCallState, payload: MappedContent) {
    if (state.started) return
    state.started = true
    payload.events.push(createStreamEvent.toolCallStart(state.toolCallId, state.toolName))
  }

  private emitToolCallChunk(state: ToolCallState, chunk: string, payload: MappedContent) {
    state.argumentsBuffer += chunk
    payload.events.push(createStreamEvent.toolCallChunk(state.toolCallId, chunk))
    payload.blocks.push(
      this.createBlock('tool_call', state.argumentsBuffer, {
        status: 'loading',
        tool_call: {
          id: state.toolCallId,
          name: state.toolName,
          params: state.argumentsBuffer
        }
      })
    )
  }

  private emitToolCallEnd(state: ToolCallState, payload: MappedContent, isError: boolean) {
    const toolCallId = state.toolCallId
    const finalArgs = this.tryParseJsonArguments(state.argumentsBuffer, toolCallId)
    payload.events.push(createStreamEvent.toolCallEnd(toolCallId, finalArgs))
    payload.blocks.push(
      this.createBlock('tool_call', finalArgs, {
        status: isError ? 'error' : 'success',
        tool_call: {
          id: toolCallId,
          name: state.toolName,
          params: finalArgs
        }
      })
    )
    this.toolCallStates.delete(this.getToolCallStateKey(state.sessionId, toolCallId))
  }

  private getOrCreateToolCallState(
    sessionId: string,
    toolCallId: string,
    toolName?: string
  ): ToolCallState {
    const key = this.getToolCallStateKey(sessionId, toolCallId)
    const existing = this.toolCallStates.get(key)
    if (existing) {
      if (toolName && existing.toolName !== toolName) {
        existing.toolName = toolName
      }
      return existing
    }

    const state: ToolCallState = {
      sessionId,
      toolCallId,
      toolName: toolName ?? toolCallId,
      argumentsBuffer: '',
      status: undefined,
      started: false
    }
    this.toolCallStates.set(key, state)
    return state
  }

  private getToolCallStateKey(sessionId: string, toolCallId: string): string {
    return `${sessionId}:${toolCallId}`
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
