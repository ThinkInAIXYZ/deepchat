import type {
  AssistantMessageBlock,
  ChatMessageRecord,
  MessageMetadata,
  UserMessageContent
} from '@shared/types/agent-interface'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import { dimSequence, type DimEvent } from './sessionConnection'

export interface DimProjection {
  binding: DimSessionBinding
  messages: ChatMessageRecord[]
  retractions?: string[]
  completed?: { requestId: string; messageId: string; error?: string }
}

/** A desktop read-model fold; none of these decisions can advance dim's execution. */
export function projectDimEvent(
  binding: DimSessionBinding,
  event: DimEvent,
  readMessage: (id: string) => ChatMessageRecord | null
): DimProjection {
  if (dimSequence(event.sequence) <= dimSequence(binding.cursor)) return { binding, messages: [] }
  const next = { ...binding, cursor: String(event.sequence) }
  const messages: ChatMessageRecord[] = []
  const result: DimProjection = { binding: next, messages }
  const key = `${event.type}/${event.name}`
  const now = event.create_at
  const source = event.data.source
  const sourceTurnId =
    source &&
    typeof source === 'object' &&
    !Array.isArray(source) &&
    typeof source.turn_id === 'string'
      ? source.turn_id
      : null
  const turnId =
    typeof event.data.turn_id === 'string'
      ? event.data.turn_id
      : (sourceTurnId ?? (event.type === 'approval' ? binding.activeTurnId : null))
  const createMessage = (
    id: string,
    role: 'user' | 'assistant',
    content: string,
    status: ChatMessageRecord['status']
  ): ChatMessageRecord => ({
    id,
    sessionId: binding.sessionId,
    orderSeq: next.nextOrderSeq++,
    role,
    content,
    status,
    isContextEdge: 0,
    metadata: JSON.stringify({
      dim: {
        sessionId: binding.dimSessionId,
        branchId: binding.branchId,
        eventId: event.id,
        sequence: String(event.sequence)
      }
    }),
    createdAt: now,
    updatedAt: now
  })
  if (key === 'input/deleted' && typeof event.data.input_id === 'string') {
    result.retractions = [event.data.input_id]
    return result
  }
  if (
    key === 'input/message' &&
    event.data.user &&
    typeof event.data.user === 'object' &&
    !Array.isArray(event.data.user)
  ) {
    const content = Array.isArray(event.data.user.content) ? event.data.user.content : []
    const text = content
      .flatMap((item) =>
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        item.type === 'text' &&
        typeof item.text === 'string'
          ? [item.text]
          : []
      )
      .join('\n')
    const user: UserMessageContent = { text, files: [], links: [], search: false, think: false }
    // Native attachment references are preserved with the input rather than silently dropping them.
    for (const item of content) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || item.type !== 'image')
        continue
      const source = item.source
      if (source && typeof source === 'object' && !Array.isArray(source)) {
        const mediaType =
          typeof source.mediaType === 'string' ? source.mediaType : 'application/octet-stream'
        const url =
          typeof source.url === 'string'
            ? source.url
            : `data:${mediaType};base64,${source.data ?? ''}`
        user.files.push({
          name: `image-${user.files.length + 1}`,
          path: url,
          mimeType: mediaType,
          type: mediaType
        })
      }
    }
    messages.push(createMessage(event.id, 'user', JSON.stringify(user), 'sent'))
    return result
  }
  if (key === 'turn/start' && turnId) {
    next.activeTurnId = turnId
    next.assistantMessageId = `dim:${binding.dimSessionId}:${turnId}`
    next.status = 'generating'
    const message = createMessage(next.assistantMessageId, 'assistant', '[]', 'pending')
    message.metadata = JSON.stringify({ ...JSON.parse(message.metadata), runId: turnId })
    messages.push(message)
    return result
  }
  if (!turnId || turnId !== binding.activeTurnId || !binding.assistantMessageId) return result
  const original = readMessage(binding.assistantMessageId)
  if (!original) throw new Error('dim projection is missing its active assistant message')
  const message: ChatMessageRecord = { ...original, updatedAt: now }
  const blocks = JSON.parse(original.content) as AssistantMessageBlock[]
  const metadata = JSON.parse(original.metadata) as MessageMetadata
  let changed = false
  if (key === 'approval/request' && typeof event.data.approval_id === 'string') {
    const call = event.data.call
    blocks.push({
      id: event.data.approval_id,
      type: 'action',
      action_type: 'tool_call_permission',
      status: 'pending',
      timestamp: now,
      content: typeof event.data.reason === 'string' ? event.data.reason : '',
      tool_call: {
        id: event.data.approval_id,
        name: call && typeof call === 'object' && !Array.isArray(call) ? String(call.name) : ''
      },
      extra: { needsUserAction: true, permissionRequest: JSON.stringify(call) }
    })
    changed = true
  } else if (key === 'approval/respond' || key === 'approval/cancelled') {
    const block = blocks.find((candidate) => candidate.id === event.data.approval_id)
    if (block) {
      block.status = event.data.decision === 'allow' ? 'granted' : 'denied'
      block.extra = { ...block.extra, needsUserAction: false }
    }
    changed = true
  } else if (key === 'step/text' || key === 'step/thinking') {
    const type = key === 'step/text' ? 'content' : 'reasoning_content'
    const delta = typeof event.data.delta === 'string' ? event.data.delta : ''
    const last = blocks.at(-1)
    if (last?.type === type && last.status === 'loading')
      last.content = (last.content ?? '') + delta
    else blocks.push({ id: event.id, type, content: delta, status: 'loading', timestamp: now })
    changed = true
  } else if (key === 'tool/call' && Array.isArray(event.data.calls)) {
    for (const value of event.data.calls) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      blocks.push({
        id: String(value.id),
        type: 'tool_call',
        status: 'loading',
        timestamp: now,
        tool_call: {
          id: String(value.id),
          name: String(value.name),
          params: JSON.stringify(value.input ?? {})
        }
      })
    }
    changed = true
  } else if (key === 'tool/completed' || key === 'tool/result') {
    const results =
      key === 'tool/completed'
        ? [{ call_id: event.data.call_id, result: event.data.result }]
        : event.data.results
    if (Array.isArray(results))
      for (const value of results) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue
        const block = blocks.find((candidate) => candidate.tool_call?.id === value.call_id)
        if (!block?.tool_call) continue
        const toolResult = value.result
        block.tool_call.response = JSON.stringify(toolResult)
        block.status =
          toolResult &&
          typeof toolResult === 'object' &&
          !Array.isArray(toolResult) &&
          toolResult.isError
            ? 'error'
            : 'success'
      }
    changed = true
  } else if (
    key === 'model/usage' &&
    event.data.usage &&
    typeof event.data.usage === 'object' &&
    !Array.isArray(event.data.usage)
  ) {
    const usage = event.data.usage
    const add = (
      key:
        | 'inputTokens'
        | 'outputTokens'
        | 'totalTokens'
        | 'cachedInputTokens'
        | 'cacheWriteInputTokens',
      value: unknown
    ) => {
      if (typeof value === 'number' && Number.isFinite(value))
        metadata[key] = (metadata[key] ?? 0) + value
    }
    add('inputTokens', usage.promptTokens)
    add('outputTokens', usage.completionTokens)
    add('totalTokens', usage.totalTokens)
    add('cachedInputTokens', usage.cacheReadTokens)
    add('cacheWriteInputTokens', usage.cacheWriteTokens)
    changed = true
  } else if (key === 'turn/end') {
    const error = typeof event.data.error === 'string' ? event.data.error : undefined
    const cancelled = event.data.status === 'cancelled'
    for (const block of blocks)
      if (block.status === 'loading') block.status = error || cancelled ? 'error' : 'success'
    if (error)
      blocks.push({ id: event.id, type: 'error', content: error, status: 'error', timestamp: now })
    metadata.runOutcome = error ? 'error' : cancelled ? 'aborted' : 'completed'
    if (typeof event.data.reason === 'string') metadata.runStopReason = event.data.reason
    message.status = error || cancelled ? 'error' : 'sent'
    next.status = error ? 'error' : 'idle'
    next.activeTurnId = null
    next.assistantMessageId = null
    result.completed = { requestId: turnId, messageId: message.id, ...(error ? { error } : {}) }
    changed = true
  }
  if (changed) {
    message.content = JSON.stringify(blocks)
    message.metadata = JSON.stringify({
      ...metadata,
      dim: {
        sessionId: binding.dimSessionId,
        branchId: binding.branchId,
        eventId: event.id,
        sequence: String(event.sequence)
      }
    })
    messages.push(message)
  }
  return result
}
