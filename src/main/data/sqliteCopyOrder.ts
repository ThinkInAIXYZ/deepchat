import type Database from 'better-sqlite3-multiple-ciphers'

type NamedTable = { name: string }

type ForeignKeyRow = {
  table: string
}

// These dependencies are enforced by triggers rather than FOREIGN KEY clauses, so SQLite cannot
// expose them through PRAGMA foreign_key_list. Keep them beside the generic copy planner instead of
// duplicating ad-hoc preferred-order arrays in import and encryption paths.
const TRIGGER_ENFORCED_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  live_delegations: ['new_sessions']
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function readForeignKeyParents(
  db: Database.Database,
  tableName: string,
  schemaName: string
): string[] {
  return (
    db
      .prepare(
        `PRAGMA ${quoteIdentifier(schemaName)}.foreign_key_list(${quoteIdentifier(tableName)})`
      )
      .all() as ForeignKeyRow[]
  )
    .map((row) => row.table)
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
}

/**
 * Orders a database snapshot so every referenced parent row is copied before its children.
 *
 * A cycle is rejected explicitly: copying cyclic immediate foreign keys requires a separate,
 * transaction-wide deferral contract and must not silently fall back to an unsafe lexical order.
 */
export function orderSqliteTablesForCopy<T extends NamedTable>(
  db: Database.Database,
  tables: readonly T[],
  schemaName = 'main'
): T[] {
  const tableByName = new Map<string, T>()
  for (const table of tables) {
    if (tableByName.has(table.name)) {
      throw new Error(`Duplicate SQLite copy table: ${table.name}`)
    }
    tableByName.set(table.name, table)
  }

  const dependencies = new Map<string, Set<string>>()
  const dependents = new Map<string, Set<string>>()
  for (const table of tables) {
    const parents = new Set(
      [
        ...readForeignKeyParents(db, table.name, schemaName),
        ...(TRIGGER_ENFORCED_DEPENDENCIES[table.name] ?? [])
      ].filter((parent) => parent !== table.name && tableByName.has(parent))
    )
    dependencies.set(table.name, parents)
    for (const parent of parents) {
      const children = dependents.get(parent) ?? new Set<string>()
      children.add(table.name)
      dependents.set(parent, children)
    }
  }

  const ready = [...tableByName.keys()].filter((name) => dependencies.get(name)?.size === 0).sort()
  const ordered: T[] = []

  while (ready.length > 0) {
    const name = ready.shift()!
    ordered.push(tableByName.get(name)!)
    for (const child of dependents.get(name) ?? []) {
      const childDependencies = dependencies.get(child)!
      childDependencies.delete(name)
      if (childDependencies.size === 0) {
        ready.push(child)
        ready.sort()
      }
    }
  }

  if (ordered.length !== tables.length) {
    const cyclicTables = [...dependencies.entries()]
      .filter(([, parents]) => parents.size > 0)
      .map(([name]) => name)
      .sort()
    throw new Error(`Cyclic SQLite copy dependencies: ${cyclicTables.join(', ')}`)
  }

  return ordered
}
