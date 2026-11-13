import { markStreamChanged, type StreamState, type IoParams } from './messageStream'
import { buildTerminalErrorBlocks } from '@/session/data/messageContent'
import {
  buildAssistantDeliverySegments,
  buildAssistantPreviewMarkdown,
  buildAssistantResponseMarkdown,
  extractWaitingInteraction
} from './sessionUpdates'

export function flushBlocksToRenderer(io: IoParams, state: StreamState): void {
  io.output.streamSnapshot({
    kind: 'snapshot',
    requestId: io.requestId,
    sessionId: io.sessionId,
    messageId: io.messageId,
    providerId: io.providerId,
    modelId: io.modelId,
    updatedAt: Date.now(),
    revision: state.blocksRevision,
    blocks: state.blocks
  })

  io.output.sessionUpdate({
    sessionId: io.sessionId,
    kind: 'blocks',
    updatedAt: Date.now(),
    messageId: io.messageId,
    previewMarkdown: buildAssistantPreviewMarkdown(state.blocks),
    responseMarkdown: buildAssistantResponseMarkdown(state.blocks),
    deliverySegments: buildAssistantDeliverySegments(io.messageId, state.blocks),
    waitingInteraction: extractWaitingInteraction(state.blocks, io.messageId)
  })
}

function stampGenerationTiming(state: StreamState): void {
  state.metadata.generationTime = Math.max(0, Date.now() - state.startTime)
  if (state.firstTokenTime !== null) {
    state.metadata.firstTokenTime = Math.max(0, state.firstTokenTime - state.startTime)
  }
  if (state.metadata.outputTokens && state.metadata.generationTime > 0) {
    state.metadata.tokensPerSecond = Math.round(
      (state.metadata.outputTokens / state.metadata.generationTime) * 1000
    )
  }
}

export function assertPausedProjectionReady(state: StreamState): void {
  const unresolvedIndex = state.blocks.findIndex((block) => {
    if (block.status !== 'pending' && block.status !== 'loading') return false
    return !(
      block.type === 'action' &&
      block.status === 'pending' &&
      (block.action_type === 'tool_call_permission' || block.action_type === 'question_request')
    )
  })
  if (unresolvedIndex < 0) return

  const block = state.blocks[unresolvedIndex]
  const blockIdentity = `index=${unresolvedIndex} type=${block.type} status=${block.status}`
  throw new Error(`Paused stream invariant violated: block ${blockIdentity} is unresolved.`)
}

export function finalizePaused(state: StreamState, io: IoParams): void {
  assertPausedProjectionReady(state)

  stampGenerationTiming(state)

  io.messageStore.updateAssistantContent(io.messageId, state.blocks, JSON.stringify(state.metadata))
  flushBlocksToRenderer(io, state)
  io.output.streamCompleted({
    requestId: io.requestId,
    sessionId: io.sessionId,
    messageId: io.messageId,
    completedAt: Date.now()
  })
}

export function finalize(state: StreamState, io: IoParams): void {
  for (const block of state.blocks) {
    if (block.status === 'pending') block.status = 'success'
  }
  markStreamChanged(state)

  stampGenerationTiming(state)

  io.messageStore.finalizeAssistantMessage(
    io.messageId,
    state.blocks,
    JSON.stringify(state.metadata)
  )
  flushBlocksToRenderer(io, state)
  io.output.streamCompleted({
    requestId: io.requestId,
    sessionId: io.sessionId,
    messageId: io.messageId,
    completedAt: Date.now()
  })
}

export function finalizeError(state: StreamState, io: IoParams, error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error)
  state.blocks = buildTerminalErrorBlocks(state.blocks, errorMessage)
  markStreamChanged(state)

  stampGenerationTiming(state)

  io.messageStore.setMessageError(io.messageId, state.blocks, JSON.stringify(state.metadata))
  flushBlocksToRenderer(io, state)
  io.output.streamFailed({
    requestId: io.requestId,
    sessionId: io.sessionId,
    messageId: io.messageId,
    failedAt: Date.now(),
    error: errorMessage
  })
}
