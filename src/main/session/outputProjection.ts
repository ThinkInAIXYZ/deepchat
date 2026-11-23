import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { DeepChatOutputPort } from '@/agent/shared/output'
import type { SessionEventPublisher } from '@/events/sessionEventRouter'
import type { DeepChatInternalSessionUpdate } from '@/agent/shared/sessionUpdates'
import { cloneBlocksForRenderer } from './clientMessageProjection'

export function createDeepChatOutputProjection(ports: {
  publishEvent: SessionEventPublisher
  publishSessionUpdate(update: DeepChatInternalSessionUpdate): void
}): DeepChatOutputPort {
  return {
    streamSnapshot: (snapshot) =>
      ports.publishEvent('chat.stream.updated', {
        ...snapshot,
        blocks: cloneBlocksForRenderer(snapshot.blocks)
      }),
    streamCompleted: (completion) => ports.publishEvent('chat.stream.completed', completion),
    streamFailed: (failure) => ports.publishEvent('chat.stream.failed', failure),
    compactionChanged: (change) => ports.publishEvent('sessions.compaction.changed', change),
    sessionUpdate: (update) =>
      ports.publishSessionUpdate(
        update.waitingInteraction
          ? {
              ...update,
              waitingInteraction: {
                ...update.waitingInteraction,
                actionBlock: cloneBlocksForRenderer([
                  update.waitingInteraction.actionBlock
                ])[0] as AssistantMessageBlock
              }
            }
          : update
      )
  }
}
