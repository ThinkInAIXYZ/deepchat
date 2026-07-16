import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('better-sqlite3-multiple-ciphers', () => ({
  default: vi.fn()
}))

describe('sqlitePresenter migration SQL splitting', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('ignores line and block comments when splitting migration SQL blocks', async () => {
    const { MainDatabase } = await import('../../../src/main/data/mainDatabase')
    const exec = vi.fn()
    const insertVersion = vi.fn()
    const transaction = vi.fn((callback: () => void) => callback)
    const prepare = vi.fn((statement: string) => {
      if (statement === 'INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)') {
        return {
          run: insertVersion
        }
      }

      throw new Error(`Unexpected prepared statement: ${statement}`)
    })

    const presenter = Object.create(MainDatabase.prototype) as any
    presenter.db = {
      exec,
      transaction,
      prepare
    }
    presenter.currentVersion = 0
    presenter.databaseFileExistedBeforeOpen = true

    const emptyTable = {
      getLatestVersion: () => 0,
      getMigrationSQL: () => undefined
    }
    const migrationTable = {
      getLatestVersion: () => 1,
      getMigrationSQL: (version: number) =>
        version === 1
          ? `-- comment with ; and ' and "
CREATE TABLE sample (
  value TEXT DEFAULT '; -- not comment'
);
/* block comment with ; and ' and " */
CREATE INDEX sample_value_idx ON sample(value);`
          : undefined
    }

    presenter.schemaCatalog = {
      migrationTables: [migrationTable, emptyTable]
    }

    presenter.migrate()

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(exec).toHaveBeenCalledTimes(2)
    expect(exec.mock.calls.map(([statement]) => statement)).toEqual([
      "CREATE TABLE sample (\n  value TEXT DEFAULT '; -- not comment'\n)",
      'CREATE INDEX sample_value_idx ON sample(value)'
    ])
    expect(insertVersion).toHaveBeenCalledTimes(1)
    expect(insertVersion).toHaveBeenCalledWith(1, expect.any(Number))
  })
})
