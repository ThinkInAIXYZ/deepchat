import type {
  AssistantMessageBlock,
  ChatMessageRecord,
  MessageMetadata,
  UserMessageContent
} from '@shared/types/agent-interface'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import { dimSequence, type DimEvent } from './sessionConnection'
import { dimQuestions } from '@shared/dimQuestions'

export interface DimProjection {
  event?: DimEvent
  binding: DimSessionBinding
  messages: ChatMessageRecord[]
  retractions?: string[]
  inputEvents?: DimEvent[]
  consumedInputs?: string[]
  completed?: { requestId: string; messageId: string; error?: string }
}

/** A desktop read-model fold; none of these decisions can advance dim's execution. */
export function projectDimEvent(
  binding: DimSessionBinding,
  event: DimEvent,
  readMessage: (id: string) => ChatMessageRecord | null,
  readInput: (id: string) => DimEvent | null
): DimProjection {
  if (dimSequence(event.sequence) <= dimSequence(binding.cursor)) return { binding, messages: [] }
  const next = { ...binding, cursor: String(event.sequence) }
  const messages: ChatMessageRecord[] = []
  const result: DimProjection = { binding: next, messages, event }
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
        sequence: String(event.sequence),
        revision: 0
      }
    }),
    createdAt: now,
    updatedAt: now
  })
  if (key === 'deepchat/input-representation') {
    result.inputEvents = [event]
    return result
  }
  if (key === 'deepchat/input-rejected' && typeof event.data.submissionId === 'string') {
    result.consumedInputs = [`submission:${event.data.submissionId}`]
    return result
  }
  const clearInputCache = (inputId: string) => {
    const input = readInput(inputId)
    result.consumedInputs = [inputId]
    if (typeof input?.data.submission_id === 'string')
      result.consumedInputs.push(`submission:${input.data.submission_id}`)
  }
  if (key === 'input/deleted' && typeof event.data.input_id === 'string') {
    result.retractions = [dimUserMessageId(binding, event.data.input_id)]
    clearInputCache(event.data.input_id)
    return result
  }
  if (key === 'input/message') {
    result.inputEvents = [event]
    return result
  }
  if (key === 'input/consumed' && typeof event.data.input_id === 'string') {
    clearInputCache(event.data.input_id)
    const original = readMessage(dimUserMessageId(binding, event.data.input_id))
    if (original) {
      const metadata = JSON.parse(original.metadata) as MessageMetadata
      if (metadata.inputReceipt) {
        metadata.inputReceipt = { ...metadata.inputReceipt, readAt: now, delivery: 'applied' }
        messages.push({ ...original, metadata: JSON.stringify(metadata), updatedAt: now })
      }
    }
    return result
  }
  if (key === 'input/applied' && typeof event.data.input_id === 'string') {
    const input = readInput(event.data.input_id)
    const nativeUser = input?.data.user
    if (!input || !nativeUser || typeof nativeUser !== 'object' || Array.isArray(nativeUser))
      return result
    const content = Array.isArray(nativeUser.content) ? nativeUser.content : []
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
    const representation =
      typeof input.data.submission_id === 'string'
        ? readInput(`submission:${input.data.submission_id}`)?.data.content
        : undefined
    if (
      representation !== undefined &&
      (!representation ||
        typeof representation !== 'object' ||
        Array.isArray(representation) ||
        typeof representation.text !== 'string' ||
        !Array.isArray(representation.files) ||
        !Array.isArray(representation.links) ||
        typeof representation.search !== 'boolean' ||
        typeof representation.think !== 'boolean')
    )
      throw new Error('Invalid native product input representation')
    const record = createMessage(
      dimUserMessageId(binding, input.id),
      'user',
      JSON.stringify(representation ?? user),
      'sent'
    )
    record.createdAt = input.create_at
    if (input.data.mode === 'steer')
      record.metadata = JSON.stringify({
        ...JSON.parse(record.metadata),
        inputReceipt: { mode: 'steer', readAt: null, delivery: 'applied' }
      })
    messages.push(record)
    return result
  }
  if (key === 'turn/start' && turnId) {
    next.activeTurnId = turnId
    next.assistantMessageId = `dim:${binding.dimSessionId}:${binding.branchId}:${turnId}`
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
  } else if (key === 'step/tool-call' && Array.isArray(event.data.calls)) {
    for (const value of event.data.calls) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      blocks.push({
        id: `${event.data.request_id}:${value.id}`,
        type: 'tool_call',
        extra: { dimRequestId: String(event.data.request_id) },
        status: 'loading',
        timestamp: now,
        tool_call: {
          id: String(value.id),
          name: String(value.name),
          params: JSON.stringify(value.input ?? {})
        }
      })
      const input = value.input
      const questions =
        value.name === 'ask_user' && input && typeof input === 'object' && !Array.isArray(input)
          ? dimQuestions(input.questions)
          : []
      if (questions.length)
        blocks.push({
          id: `question:${event.data.request_id}:${value.id}`,
          type: 'action',
          action_type: 'question_request',
          status: 'pending',
          timestamp: now,
          content: questions.map((question) => question.question).join('\n'),
          tool_call: {
            id: String(value.id),
            name: 'ask_user',
            params: JSON.stringify(value.input)
          },
          extra: {
            needsUserAction: true,
            questionResolution: 'asked',
            dimRequestId: String(event.data.request_id),
            dimQuestions: JSON.stringify(questions),
            questionText: questions.map((question) => question.question).join('\n'),
            questionOptions: questions[0].options,
            questionMultiple: questions[0].multiSelect,
            questionCustom: questions[0].allowCustom
          }
        })
    }
    changed = true
  } else if (key === 'step/tool-completed' || key === 'step/tool-result') {
    const results =
      key === 'step/tool-completed'
        ? [{ call_id: event.data.call_id, result: event.data.result }]
        : event.data.results
    if (Array.isArray(results))
      for (const value of results) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue
        const block = blocks.find(
          (candidate) =>
            candidate.tool_call?.id === value.call_id &&
            candidate.extra?.dimRequestId === event.data.request_id
        )
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
        const action = blocks.find(
          (candidate) =>
            candidate.type === 'action' &&
            candidate.tool_call?.id === value.call_id &&
            candidate.extra?.dimRequestId === event.data.request_id
        )
        if (action) {
          action.status = block.status
          const content =
            toolResult && typeof toolResult === 'object' && !Array.isArray(toolResult)
              ? toolResult.content
              : ''
          action.extra = {
            ...action.extra,
            needsUserAction: false,
            questionResolution: block.status === 'error' ? 'rejected' : 'replied',
            answerText: typeof content === 'string' ? content : JSON.stringify(content)
          }
        }
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
      else if (block.type === 'action' && block.status === 'pending') {
        block.status = 'denied'
        block.extra = { ...block.extra, needsUserAction: false, questionResolution: 'rejected' }
      }
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
        sequence: String(event.sequence),
        revision: (metadata.dim?.revision ?? 0) + 1
      }
    })
    messages.push(message)
  }
  return result
}

export function dimUserMessageId(
  binding: Pick<DimSessionBinding, 'dimSessionId' | 'branchId'>,
  inputId: string
): string {
  return `dim:${binding.dimSessionId}:${binding.branchId}:${inputId}`
}
