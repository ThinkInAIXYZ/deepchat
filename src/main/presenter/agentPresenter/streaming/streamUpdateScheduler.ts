import { eventBus, SendTarget } from '@/eventbus'
import { STREAM_EVENTS } from '@/events'
import type { LLMAgentEventData } from '@shared/presenter'

export const STREAM_RENDER_FLUSH_INTERVAL_MS = 120
export const STREAM_DB_FLUSH_INTERVAL_MS = 600

interface PendingDelta {
  content?: string
  reasoning_content?: string
  tool_call?: LLMAgentEventData['tool_call']
  tool_call_id?: string
  tool_call_name?: string
  tool_call_params?: string
  tool_call_response?: string | Array<unknown>
  tool_call_server_name?: string
  tool_call_server_icons?: string
  tool_call_server_description?: string
  tool_call_response_raw?: unknown
  maximum_tool_calls_reached?: boolean
  image_data?: { data: string; mimeType: string }
  rate_limit?: LLMAgentEventData['rate_limit']
  totalUsage?: LLMAgentEventData['totalUsage']
}

interface SchedulerState {
  eventId: string
  conversationId: string
  parentId?: string
  isVariant: boolean
  tabId?: number
  pendingDelta: PendingDelta
  contentSnapshot?: unknown
  seq: number
  hasSentInit: boolean
  lastRenderFlushAt: number
  lastDbFlushAt: number
  renderTimer?: NodeJS.Timeout
  dbTimer?: NodeJS.Timeout
}

export class StreamUpdateScheduler {
  private readonly states: Map<string, SchedulerState> = new Map()
  private readonly messageManager: any
  private readonly onFlushRender?: () => void

  constructor(options: { messageManager: any; onFlushRender?: () => void }) {
    this.messageManager = options.messageManager
    this.onFlushRender = options.onFlushRender
  }

  private getStateOrCreate(options: {
    eventId: string
    conversationId: string
    parentId?: string
    isVariant: boolean
    tabId?: number
  }): SchedulerState {
    let state = this.states.get(options.eventId)
    if (!state) {
      state = {
        eventId: options.eventId,
        conversationId: options.conversationId,
        parentId: options.parentId,
        isVariant: options.isVariant,
        tabId: options.tabId,
        pendingDelta: {},
        seq: 0,
        hasSentInit: false,
        lastRenderFlushAt: 0,
        lastDbFlushAt: 0
      }
      this.states.set(options.eventId, state)
    }
    return state
  }

  enqueueDelta(
    eventId: string,
    conversationId: string,
    parentId: string | undefined,
    isVariant: boolean,
    tabId: number | undefined,
    delta: Partial<LLMAgentEventData>,
    contentSnapshot?: unknown
  ): void {
    if (delta.content && delta.reasoning_content) {
      const { content, reasoning_content, ...rest } = delta
      this.enqueueDelta(
        eventId,
        conversationId,
        parentId,
        isVariant,
        tabId,
        {
          ...rest,
          content
        },
        contentSnapshot
      )
      this.enqueueDelta(
        eventId,
        conversationId,
        parentId,
        isVariant,
        tabId,
        {
          reasoning_content
        },
        contentSnapshot
      )
      return
    }

    const state = this.getStateOrCreate({
      eventId,
      conversationId,
      parentId,
      isVariant,
      tabId
    })

    if (contentSnapshot !== undefined) {
      state.contentSnapshot = contentSnapshot
    }

    if (!state.hasSentInit) {
      this.sendInit(state)
    }

    const shouldFlushImmediately = this.shouldFlushBeforeEnqueue(state, delta)
    if (shouldFlushImmediately) {
      this.flushRender(state)
    }

    if (delta.content) {
      state.pendingDelta.content = (state.pendingDelta.content ?? '') + delta.content
    }
    if (delta.reasoning_content) {
      state.pendingDelta.reasoning_content =
        (state.pendingDelta.reasoning_content ?? '') + delta.reasoning_content
    }
    if (delta.tool_call !== undefined) {
      state.pendingDelta.tool_call = delta.tool_call
    }
    if (delta.tool_call_id !== undefined) {
      state.pendingDelta.tool_call_id = delta.tool_call_id
    }
    if (delta.tool_call_name !== undefined) {
      state.pendingDelta.tool_call_name = delta.tool_call_name
    }
    if (delta.tool_call_params !== undefined) {
      state.pendingDelta.tool_call_params = delta.tool_call_params
    }
    if (delta.tool_call_response !== undefined) {
      state.pendingDelta.tool_call_response = delta.tool_call_response
    }
    if (delta.tool_call_server_name !== undefined) {
      state.pendingDelta.tool_call_server_name = delta.tool_call_server_name
    }
    if (delta.tool_call_server_icons !== undefined) {
      state.pendingDelta.tool_call_server_icons = delta.tool_call_server_icons
    }
    if (delta.tool_call_server_description !== undefined) {
      state.pendingDelta.tool_call_server_description = delta.tool_call_server_description
    }
    if (delta.tool_call_response_raw !== undefined) {
      state.pendingDelta.tool_call_response_raw = delta.tool_call_response_raw
    }
    if (delta.maximum_tool_calls_reached !== undefined) {
      state.pendingDelta.maximum_tool_calls_reached = delta.maximum_tool_calls_reached
    }
    if (delta.image_data !== undefined) {
      state.pendingDelta.image_data = delta.image_data
    }
    if (delta.rate_limit !== undefined) {
      state.pendingDelta.rate_limit = delta.rate_limit
    }
    if (delta.totalUsage !== undefined) {
      state.pendingDelta.totalUsage = delta.totalUsage
    }

    const now = Date.now()

    if (shouldFlushImmediately) {
      this.flushRender(state)
    } else {
      const renderDelay = Math.max(
        0,
        STREAM_RENDER_FLUSH_INTERVAL_MS - (now - state.lastRenderFlushAt)
      )
      this.scheduleRenderFlush(state, renderDelay)
    }

    const dbDelay = Math.max(0, STREAM_DB_FLUSH_INTERVAL_MS - (now - state.lastDbFlushAt))
    this.scheduleDbFlush(state, dbDelay)
  }

  private sendInit(state: SchedulerState): void {
    state.hasSentInit = true

    const eventData: LLMAgentEventData = {
      eventId: state.eventId,
      conversationId: state.conversationId,
      parentId: state.parentId,
      is_variant: state.isVariant,
      stream_kind: 'init',
      seq: state.seq
    }

    eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, eventData)
  }

  private scheduleRenderFlush(state: SchedulerState, delayMs: number): void {
    if (state.renderTimer) return

    state.renderTimer = setTimeout(() => {
      this.flushRender(state)
    }, delayMs)
  }

  private flushRender(state: SchedulerState): void {
    if (state.renderTimer) {
      clearTimeout(state.renderTimer)
      state.renderTimer = undefined
    }

    const delta = state.pendingDelta
    const hasContent = Object.keys(delta).length > 0

    if (hasContent) {
      state.lastRenderFlushAt = Date.now()
      state.seq += 1

      const eventData: LLMAgentEventData = {
        eventId: state.eventId,
        conversationId: state.conversationId,
        parentId: state.parentId,
        is_variant: state.isVariant,
        stream_kind: 'delta',
        seq: state.seq,
        content: delta.content,
        reasoning_content: delta.reasoning_content,
        tool_call: delta.tool_call,
        tool_call_id: delta.tool_call_id,
        tool_call_name: delta.tool_call_name,
        tool_call_params: delta.tool_call_params,
        tool_call_response: delta.tool_call_response,
        tool_call_server_name: delta.tool_call_server_name,
        tool_call_server_icons: delta.tool_call_server_icons,
        tool_call_server_description: delta.tool_call_server_description,
        tool_call_response_raw: delta.tool_call_response_raw,
        maximum_tool_calls_reached: delta.maximum_tool_calls_reached,
        image_data: delta.image_data,
        rate_limit: delta.rate_limit,
        totalUsage: delta.totalUsage
      }

      eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, eventData)
      state.pendingDelta = {}
    }

    this.onFlushRender?.()
  }

  private scheduleDbFlush(state: SchedulerState, delayMs: number): void {
    if (state.dbTimer) return

    state.dbTimer = setTimeout(() => {
      void this.flushDb(state)
    }, delayMs)
  }

  private getDeltaKind(
    delta: Partial<LLMAgentEventData> | PendingDelta
  ): 'tool_call' | 'image' | 'rate_limit' | 'reasoning' | 'content' | 'mixed' | null {
    if (delta.tool_call !== undefined) return 'tool_call'
    if (delta.image_data !== undefined) return 'image'
    if (delta.rate_limit !== undefined) return 'rate_limit'
    if (delta.content && delta.reasoning_content) return 'mixed'
    if (delta.reasoning_content) return 'reasoning'
    if (delta.content) return 'content'
    return null
  }

  private shouldFlushBeforeEnqueue(
    state: SchedulerState,
    delta: Partial<LLMAgentEventData>
  ): boolean {
    if (Object.keys(state.pendingDelta).length === 0) return false

    const pendingKind = this.getDeltaKind(state.pendingDelta)
    const incomingKind = this.getDeltaKind(delta)
    if (!pendingKind || !incomingKind) return false

    if (pendingKind !== incomingKind) return true

    if (pendingKind === 'image' || pendingKind === 'rate_limit') {
      return true
    }

    if (pendingKind === 'tool_call') {
      if (state.pendingDelta.tool_call !== delta.tool_call) return true
      if (
        state.pendingDelta.tool_call_id &&
        delta.tool_call_id &&
        state.pendingDelta.tool_call_id !== delta.tool_call_id
      ) {
        return true
      }
      if (
        state.pendingDelta.tool_call_name &&
        delta.tool_call_name &&
        state.pendingDelta.tool_call_name !== delta.tool_call_name
      ) {
        return true
      }
    }

    return false
  }

  private flushDb(state: SchedulerState): Promise<void> {
    state.lastDbFlushAt = Date.now()

    if (state.dbTimer) {
      clearTimeout(state.dbTimer)
      state.dbTimer = undefined
    }

    if (!state.contentSnapshot) {
      return Promise.resolve()
    }

    return this.messageManager
      .editMessageSilently(state.eventId, JSON.stringify(state.contentSnapshot))
      .catch((err: unknown) => {
        console.error('[StreamUpdateScheduler] Failed to flush DB:', err)
      })
  }

  async flushAll(eventId: string, kind: 'final' = 'final'): Promise<void> {
    const state = this.states.get(eventId)
    if (!state) return

    if (state.renderTimer) {
      clearTimeout(state.renderTimer)
      state.renderTimer = undefined
    }
    if (state.dbTimer) {
      clearTimeout(state.dbTimer)
      state.dbTimer = undefined
    }

    const delta = state.pendingDelta
    const hasContent = Object.keys(delta).length > 0

    if (hasContent) {
      state.seq += 1

      const eventData: LLMAgentEventData = {
        eventId: state.eventId,
        conversationId: state.conversationId,
        parentId: state.parentId,
        is_variant: state.isVariant,
        stream_kind: kind,
        seq: state.seq,
        content: delta.content,
        reasoning_content: delta.reasoning_content,
        tool_call: delta.tool_call,
        tool_call_id: delta.tool_call_id,
        tool_call_name: delta.tool_call_name,
        tool_call_params: delta.tool_call_params,
        tool_call_response: delta.tool_call_response,
        tool_call_server_name: delta.tool_call_server_name,
        tool_call_server_icons: delta.tool_call_server_icons,
        tool_call_server_description: delta.tool_call_server_description,
        tool_call_response_raw: delta.tool_call_response_raw,
        maximum_tool_calls_reached: delta.maximum_tool_calls_reached,
        image_data: delta.image_data,
        rate_limit: delta.rate_limit,
        totalUsage: delta.totalUsage
      }

      eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, eventData)
    }

    await this.flushDb(state)

    this.states.delete(eventId)
  }

  cleanup(eventId: string): void {
    const state = this.states.get(eventId)
    if (!state) return

    if (state.renderTimer) {
      clearTimeout(state.renderTimer)
      state.renderTimer = undefined
    }
    if (state.dbTimer) {
      clearTimeout(state.dbTimer)
      state.dbTimer = undefined
    }

    this.states.delete(eventId)
  }
}
