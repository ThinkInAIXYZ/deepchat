import type { SessionDatabase } from '@/session/data/database'
import type { SessionReferenceContentSource } from '@/session/data/sessionReferences'
import { DimContent } from './content'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'

/** Storage-plugin reads own raw detail; existing SQL tables remain bounded preview indexes. */
export function createDimSessionReferenceSource(options: {
  database: SessionDatabase
  host: DimRuntimeSupervisor
  synchronize(sessionId: string): Promise<void>
}): SessionReferenceContentSource {
  const content = new DimContent(options.host)
  return {
    has: (id) => !!options.database.dimSessionBindingsTable.get(id),
    prepare: async (id) => {
      const binding = options.database.dimSessionBindingsTable.get(id)
      if (!binding) throw new Error('Native reference source is unavailable')
      const assertCurrent = () => {
        const current = options.database.dimSessionBindingsTable.get(id)
        if (
          !current ||
          current.dimSessionId !== binding.dimSessionId ||
          current.branchId !== binding.branchId ||
          current.generation !== binding.generation ||
          options.database.dimScopeChangesTable.get(id)
        )
          throw new Error('Native reference source changed; restart this read')
      }
      assertCurrent()
      await options.synchronize(id)
      assertCurrent()
      const through = options.database.dimSessionBindingsTable.get(id)!.cursor
      return {
        assertCurrent,
        message: async (messageId) => {
          assertCurrent()
          const snapshot = await content.transcript(
            { sessionId: binding.dimSessionId, branchId: binding.branchId },
            id,
            through
          )
          assertCurrent()
          return snapshot.messages.find((message) => message.id === messageId) ?? null
        }
      }
    }
  }
}
