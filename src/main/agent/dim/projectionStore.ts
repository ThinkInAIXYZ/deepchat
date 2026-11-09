import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { SessionDatabase } from '@/session/data/database'
import { TranscriptProjectionApplier } from '@/session/data/transcriptProjection'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { DimEvent } from './sessionConnection'
import { projectDimEvent, dimProjectionInputKey, type DimProjection } from './messageProjection'

/** Existing desktop transcript tables are a cache. Only dim accepts inputs or executes a turn. */
export class DimProjectionStore {
  private readonly applier: TranscriptProjectionApplier
  constructor(private readonly database: SessionDatabase) {
    this.applier = new TranscriptProjectionApplier(database)
  }
  installGeneration(
    previous: DimSessionBinding,
    next: DimSessionBinding,
    messages: ChatMessageRecord[]
  ): void {
    this.database.getDatabase().transaction(() => {
      const retained = new Set(messages.map((message) => message.id))
      for (const message of messages) {
        const row = this.database.deepchatMessagesTable.get(message.id)
        if (message.sessionId !== next.sessionId || (row && row.session_id !== next.sessionId))
          throw new Error('Native transition message belongs to another product session')
      }
      this.database.dimSessionBindingsTable.replace(previous, next)
      this.applier.applyRetractions(
        this.database.deepchatMessagesTable
          .getIdsBySession(next.sessionId)
          .filter((id) => !retained.has(id))
      )
      for (const message of messages) this.applier.applyRecord(message)
      this.database.dimInputProjectionTable.deleteBySession(next.sessionId)
    })()
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
      const projection = projectDimEvent(
        binding,
        event,
        (id) => {
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
        },
        (inputId) => this.database.dimInputProjectionTable.get(sessionId, inputId)
      )
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
      for (const input of projection.inputEvents ?? [])
        this.database.dimInputProjectionTable.put(sessionId, input, dimProjectionInputKey(input))
      for (const inputId of projection.consumedInputs ?? [])
        this.database.dimInputProjectionTable.delete(sessionId, inputId)
      if (projection.retractions) this.applier.applyRetractions(projection.retractions)
      if (projection.resetTranscript) {
        const retained = new Set(projection.messages.map((message) => message.id))
        this.applier.applyRetractions(
          this.database.deepchatMessagesTable
            .getIdsBySession(sessionId)
            .filter((id) => !retained.has(id))
        )
      }
      for (const message of projection.messages) {
        const existing = this.database.deepchatMessagesTable.get(message.id)
        if (existing && existing.session_id !== sessionId)
          throw new Error('Native projection message belongs to another product session')
        this.applier.applyRecord(message)
      }
      this.database.dimSessionBindingsTable.advance(binding, projection.binding)
      return projection
    })()
  }
}
