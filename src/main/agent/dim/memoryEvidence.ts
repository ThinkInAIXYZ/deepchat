import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { DimMemorySource } from '@shared/types/agent-memory'
import type { SessionDatabase } from '@/session/data/database'
import type { DimContent } from './content'

interface MemoryEvidenceOptions {
  database: SessionDatabase
  content: Pick<DimContent, 'transcript'>
}

/** Immutable source views are read through dim's public content owner, including old generations. */
export class DimMemoryEvidence {
  constructor(private readonly options: MemoryEvidenceOptions) {}

  readonly read = async (
    productSessionId: string,
    sources: DimMemorySource[]
  ): Promise<Array<{ timeline: DimMemorySource; record: ChatMessageRecord }>> => {
    const owned = () =>
      new Set(
        this.options.database.dimSessionScopesTable
          .list(productSessionId)
          .map((scope) => JSON.stringify([scope.dimSessionId, scope.branchId]))
      )
    const belongs = (source: DimMemorySource, scopes: Set<string>) =>
      scopes.has(JSON.stringify([source.sessionId, source.branchId]))
    const scopes = owned()
    if (sources.some((source) => !belongs(source, scopes)))
      throw new Error('Memory evidence belongs to another desktop session')
    const snapshots = new Map<string, Awaited<ReturnType<DimContent['transcript']>>>()
    const seen = new Set<string>()
    const result: Array<{ timeline: DimMemorySource; record: ChatMessageRecord }> = []
    for (const timeline of sources) {
      const key = JSON.stringify([timeline.sessionId, timeline.branchId, timeline.through])
      let snapshot = snapshots.get(key)
      if (!snapshot) {
        snapshot = await this.options.content.transcript(
          { sessionId: timeline.sessionId, branchId: timeline.branchId },
          productSessionId,
          timeline.through
        )
        snapshots.set(key, snapshot)
      }
      const record = snapshot.messages.find((message) => message.id === timeline.messageId)
      if (!record) throw new Error('Memory evidence is absent from its immutable native view')
      if (record.sessionId !== productSessionId)
        throw new Error('Memory evidence has a different desktop owner')
      const identity = JSON.stringify([
        timeline.sessionId,
        timeline.branchId,
        timeline.through,
        timeline.messageId
      ])
      if (!seen.has(identity)) {
        result.push({ timeline, record })
        seen.add(identity)
      }
    }
    const current = owned()
    if (sources.some((source) => !belongs(source, current)))
      throw new Error('Memory evidence owner was removed during its read')
    return result
  }
}
