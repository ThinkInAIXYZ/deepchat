import { describe, it } from 'vitest'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)

export const Database = sqliteModule?.default
export const requireNativeSqlite = process.env.DEEPCHAT_REQUIRE_NATIVE_SQLITE === '1'

export let nativeSqliteAvailable = false
let nativeSqliteUnavailableReason =
  'better-sqlite3-multiple-ciphers is unavailable for the current Node ABI'
if (Database) {
  try {
    const smokeDb = new Database(':memory:')
    smokeDb.close()
    nativeSqliteAvailable = true
  } catch (error) {
    nativeSqliteUnavailableReason = error instanceof Error ? error.message : String(error)
  }
}

export function nativeSqliteDescribeIf(
  dependenciesAvailable = true,
  dependencyUnavailableReason = 'native SQLite test dependency is unavailable'
): typeof describe {
  if (nativeSqliteAvailable && dependenciesAvailable) return describe
  if (!requireNativeSqlite) return describe.skip
  const reason = nativeSqliteAvailable ? dependencyUnavailableReason : nativeSqliteUnavailableReason
  return ((name: string, _suite: () => void) =>
    describe(name, () => {
      it('requires native SQLite support', () => {
        throw new Error(reason)
      })
    })) as typeof describe
}

export function nativeSqliteItIf(
  dependenciesAvailable = true,
  dependencyUnavailableReason = 'native SQLite test dependency is unavailable'
): typeof it {
  if (nativeSqliteAvailable && dependenciesAvailable) return it
  if (!requireNativeSqlite) return it.skip
  const reason = nativeSqliteAvailable ? dependencyUnavailableReason : nativeSqliteUnavailableReason
  return ((name: string, _test: () => unknown, timeout?: number) =>
    it(
      name,
      () => {
        throw new Error(reason)
      },
      timeout
    )) as typeof it
}

export const describeIfNativeSqlite = nativeSqliteDescribeIf()
export const itIfNativeSqlite = nativeSqliteItIf()

export function dropV48DerivedArtifacts(db: { exec(sql: string): unknown }): void {
  db.exec(`
    DROP TRIGGER IF EXISTS agent_memory_dirty_ai;
    DROP TRIGGER IF EXISTS agent_memory_dirty_au;
    DROP TRIGGER IF EXISTS agent_memory_dirty_ad;
    DROP TABLE IF EXISTS agent_memory_dirty;
    DROP TABLE IF EXISTS agent_memory_derivation;
  `)
}

export function requireDatabase(): NonNullable<typeof Database> {
  if (!Database || !nativeSqliteAvailable) throw new Error(nativeSqliteUnavailableReason)
  return Database
}
