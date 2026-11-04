import type { MemoryIngestionProjection } from '../ports'
import type { DeepChatMemoryIngestionProjectionTable } from './tables/deepchatMemoryIngestionProjection'

export function createMemoryIngestionProjectionPort(
  getProjection: () => Pick<
    DeepChatMemoryIngestionProjectionTable,
    'readCurrentRange' | 'replaceSession' | 'invalidateSession'
  >
): MemoryIngestionProjection {
  return {
    readCurrentRange: (...args) => {
      const range = getProjection().readCurrentRange(...args)
      return {
        ...range,
        rows: range.rows.map((row) => ({
          sessionId: row.session_id,
          messageId: row.message_id,
          orderSeq: row.order_seq,
          entryId: row.entry_id,
          role: row.role,
          content: row.content,
          status: row.status,
          hadToolUse: row.had_tool_use === 1
        }))
      }
    },
    replaceSession: (...args) => getProjection().replaceSession(...args),
    invalidateSession: (sessionId) => getProjection().invalidateSession(sessionId)
  }
}
