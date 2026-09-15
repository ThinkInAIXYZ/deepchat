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

export async function withBackupReadLock<T>(
  mainDb: CheckpointDb | undefined,
  openDb: () => Database.Database,
  work: () => Promise<T>
): Promise<BackupReadLockOutcome<T>> {
  if (!mainDb?.open || !(await drainWal(mainDb))) {
    return { acquired: false }
  }
  const db = openDb()
  db.exec('BEGIN')
  try {
    db.prepare('SELECT count(*) FROM sqlite_master').get()
    const result = await work()
    db.exec('COMMIT')
    return { acquired: true, result }
  } catch (error) {
    if (db.inTransaction) {
      db.exec('ROLLBACK')
    }
    throw error
  } finally {
    db.close()
  }
}
