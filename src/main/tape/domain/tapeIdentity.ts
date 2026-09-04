import { createHash } from 'node:crypto'
import type { DeepChatTapeEntryRow } from './entry'

export function computeTapeIdentity(row: DeepChatTapeEntryRow): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        row.session_id,
        row.entry_id,
        row.kind,
        row.name,
        row.source_type,
        row.source_id,
        row.source_seq,
        row.provenance_key,
        row.payload_json,
        row.meta_json,
        row.created_at
      ])
    )
    .digest('hex')
}
