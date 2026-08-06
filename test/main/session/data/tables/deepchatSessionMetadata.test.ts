import { afterEach, beforeEach, expect, it } from 'vitest'
import { Database, nativeSqliteDescribeIf } from '../../../nativeSqliteHarness'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule
  ? await import('@/session/data/tables/deepchatSessionMetadata').catch(() => null)
  : null
const DeepChatSessionMetadataTable = tableModule?.DeepChatSessionMetadataTable
const DatabaseCtor = Database!
const TableCtor = DeepChatSessionMetadataTable!
const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(DeepChatSessionMetadataTable),
  'Session metadata native table module is unavailable'
)

describeIfSqlite('DeepChatSessionMetadataTable', () => {
  let db: InstanceType<typeof DatabaseCtor> | null
  let table: InstanceType<typeof TableCtor>

  beforeEach(() => {
    db = new DatabaseCtor(':memory:')
    table = new TableCtor(db)
    table.createTable()
  })

  afterEach(() => {
    db?.close()
    db = null
  })

  it('round-trips CLI run ownership without adding a second run table', () => {
    table.upsert('session-1', { source: 'cli_run' }, 123)

    expect(table.get('session-1')).toEqual({ source: 'cli_run' })
  })

  it('preserves scheduled-run metadata compatibility', () => {
    table.upsert(
      'session-1',
      {
        source: 'cron_job',
        cronJobId: 'job-1',
        cronJobRunId: 'job-run-1',
        scheduledAt: 100
      },
      123
    )

    expect(table.get('session-1')).toEqual({
      source: 'cron_job',
      cronJobId: 'job-1',
      cronJobRunId: 'job-run-1',
      scheduledAt: 100
    })
  })
})
