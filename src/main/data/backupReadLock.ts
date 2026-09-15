import type Database from 'better-sqlite3-multiple-ciphers'

export type BackupReadLockOutcome<T> =
  | { acquired: true; result: T }
  | { acquired: false; result?: undefined }

type CheckpointDb = Pick<Database.Database, 'open' | 'pragma'>

async function drainWal(mainDb: CheckpointDb): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const rows = mainDb.pragma('wal_checkpoint(PASSIVE)') as Array<{
      busy: number
      log: number
      checkpointed: number
    }>
    const result = Array.isArray(rows) ? rows[0] : undefined
    if (result && result.busy === 0 && result.checkpointed === result.log) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return false
}

function rollbackSilently(db: Database.Database): void {
  if (!db.inTransaction) {
    return
  }
  try {
    db.exec('ROLLBACK')
  } catch (rollbackError) {
    console.warn('[Backup] ROLLBACK failed while handling another error:', rollbackError)
  }
}

export class BackupSnapshotNotDrainedError extends Error {}

export async function withBackupSnapshot<T>(
  openDb: () => Database.Database,
  work: () => Promise<T>,
  guard?: () => Promise<boolean>
): Promise<T> {
  const db = openDb()
  try {
    db.exec('BEGIN')
    db.prepare('SELECT count(*) FROM sqlite_master').get()
    if (guard && !(await guard())) {
      throw new BackupSnapshotNotDrainedError()
    }
    const result = await work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    rollbackSilently(db)
    throw error
  } finally {
    db.close()
  }
}

export async function withBackupReadLock<T>(
  mainDb: CheckpointDb | undefined,
  openDb: () => Database.Database,
  work: () => Promise<T>
): Promise<BackupReadLockOutcome<T>> {
  if (!mainDb?.open || !(await drainWal(mainDb))) {
    return { acquired: false }
  }
  try {
    // A commit can land between the pre-drain above and the snapshot mark; those frames
    // sit at or below the mark and could be backfilled mid-copy. Re-drain while holding
    // the mark so nothing backfillable remains, or bail to the WAL-shipping fallback.
    const result = await withBackupSnapshot(openDb, work, () => drainWal(mainDb))
    return { acquired: true, result }
  } catch (error) {
    if (error instanceof BackupSnapshotNotDrainedError) {
      return { acquired: false }
    }
    throw error
  }
}
