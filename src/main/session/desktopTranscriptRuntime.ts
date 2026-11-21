import type { SessionDatabase } from './data/database'
import type { SessionTranscriptRuntimePort } from './data/contracts'
import type { SessionPendingInputs } from './data/pendingInputs'

/** Direct ACP transcript edits only. Native transcript edits use dim's owner instead. */
export function createDesktopTranscriptRuntime(options: {
  database: SessionDatabase
  pending: SessionPendingInputs
  cancel(sessionId: string): Promise<void>
}): SessionTranscriptRuntimePort {
  const assertEmpty = (id: string) => {
    if (options.pending.hasActiveInputs(id))
      throw new Error('Finish or remove queued input before editing this conversation')
  }
  return {
    prepareClearMessages: options.cancel,
    finishClearMessages: (id) => options.database.deepchatSessionsTable.resetSummaryState(id),
    prepareRetry: async (id) => {
      assertEmpty(id)
      await options.cancel(id)
      return { projectDir: options.database.newSessionsTable.get(id)?.project_dir ?? null }
    },
    assertNoActivePendingInputs: assertEmpty,
    cancelForTranscriptMutation: options.cancel,
    invalidateTranscriptFrom: (id, order) => {
      options.database.deepchatSessionsTable.rewindMemoryCursorOrderSeq(id, order - 1)
      options.database.deepchatSessionsTable.resetSummaryState(id)
    },
    finishTranscriptTruncate: () => {},
    resetForkTarget: (id, cursor) => {
      options.database.deepchatSessionsTable.resetSummaryState(id)
      options.database.deepchatSessionsTable.updateMemoryCursorOrderSeq(id, cursor)
    }
  }
}
