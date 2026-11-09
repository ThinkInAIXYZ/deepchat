import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { SessionDatabase } from '@/session/data/database'
import { TranscriptProjectionApplier } from '@/session/data/transcriptProjection'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { DimEvent } from './sessionConnection'
import { projectDimEvent, type DimProjection } from './messageProjection'

/** Existing desktop transcript tables are a cache. Only dim accepts inputs or executes a turn. */
export class DimProjectionStore {
  private readonly applier: TranscriptProjectionApplier
  constructor(private readonly database: SessionDatabase) {
    this.applier = new TranscriptProjectionApplier(database)
  }
  apply(
    scope: Pick<DimSessionBinding, 'sessionId' | 'dimSessionId' | 'branchId' | 'generation'>,
    event: DimEvent
  ): DimProjection {
    const { sessionId } = scope
    return this.database.getDatabase().transaction(() => {
      const binding = this.database.dimSessionBindingsTable.get(sessionId)
      if (
        !binding ||
        binding.dimSessionId !== scope.dimSessionId ||
        binding.branchId !== scope.branchId ||
        binding.generation !== scope.generation
      )
        throw new Error('Stale dim session binding')
      const projection = projectDimEvent(binding, event, (id) => {
        const row = this.database.deepchatMessagesTable.get(id)
        if (!row) return null
        return {
          id: row.id,
          sessionId: row.session_id,
          orderSeq: row.order_seq,
          role: row.role,
          content: row.content,
          status: row.status,
          isContextEdge: row.is_context_edge,
          metadata: row.metadata,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        } as ChatMessageRecord
      })
      if (projection.binding === binding) return projection
      if (
        event.type === 'input' &&
        event.name === 'message' &&
        typeof event.data.submission_id === 'string'
      ) {
        const intent = this.database.dimInputIntentsTable.get(event.data.submission_id)
        if (
          intent &&
          intent.sessionId === sessionId &&
          intent.dimSessionId === scope.dimSessionId &&
          intent.branchId === scope.branchId
        ) {
          this.database.dimInputIntentsTable.settle(intent.submissionId, 'accepted', {
            inputId: event.id,
            sequence: event.sequence
          })
        }
      }
      if (projection.retractions) this.applier.applyRetractions(projection.retractions)
      for (const message of projection.messages) this.applier.applyRecord(message)
      this.database.dimSessionBindingsTable.advance(binding, projection.binding)
      return projection
    })()
  }
}
