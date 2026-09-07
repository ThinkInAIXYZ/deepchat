import type Database from 'better-sqlite3-multiple-ciphers'
import type { TapeEntryLifecycleStore, TapeMutationProjection } from '../../ports/storage'

export class SqliteTapeLifecycleAdapter implements TapeEntryLifecycleStore {
  constructor(
    private readonly db: Database.Database,
    private readonly mutationProjection?: TapeMutationProjection
  ) {}

  deleteBySession(sessionId: string): void {
    const remove = this.db.transaction(() => {
      this.db.prepare('DELETE FROM deepchat_tape_entries WHERE session_id = ?').run(sessionId)
      this.mutationProjection?.deleteBySession(sessionId)
    })
    remove()
  }
}
