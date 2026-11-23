import type Database from 'better-sqlite3-multiple-ciphers'

type Row = Record<string, unknown>
const scopeKey = (row: Row) => JSON.stringify([row.dim_session_id, row.branch_id])

/** Product metadata only. Canonical histories have already been admitted by the storage plugin. */
export class NativeImportRows {
  private readonly protectedSessions = new Set<string>()
  private readonly messages = new Set<string>()
  private readonly inspectorHeads = new Set<string>()
  private readonly delegations = new Set<string>()
  private readonly generations = new Map<string, number>()

  constructor(source: Database.Database, target: Database.Database) {
    if (!this.exists(source, 'new_sessions') || !this.exists(target, 'new_sessions')) return
    const incoming = this.rows(source, 'dim_session_bindings')
    const local = this.rows(target, 'dim_session_bindings')
    const existing = new Set(this.rows(target, 'new_sessions').map((row) => row.id))
    for (const row of this.rows(source, 'new_sessions')) {
      if (!existing.has(row.id)) continue
      const before = local.find((binding) => binding.session_id === row.id)
      const after = incoming.find((binding) => binding.session_id === row.id)
      // Existing native projections replay an admitted tail from their own cursor.
      // Importing another device's derived rows would bypass that cursor fence.
      if (before || after) this.protectedSessions.add(String(row.id))
    }
    for (const row of this.rows(source, 'deepchat_messages')) {
      if (this.protectedSessions.has(String(row.session_id))) this.messages.add(String(row.id))
    }
    for (const row of this.rows(source, 'dim_timeline_inspector_heads')) {
      if (this.protectedSessions.has(String(row.session_id)))
        this.inspectorHeads.add(String(row.id))
    }
    for (const row of this.rows(source, 'live_delegations')) {
      if (this.protectedSessions.has(String(row.parent_session_id)))
        this.delegations.add(String(row.delegation_id))
    }
    const occupied = this.rows(target, 'dim_session_scopes')
    for (const row of incoming) {
      const owner = [...occupied, ...local].find((scope) => scopeKey(scope) === scopeKey(row))
      if (owner && owner.session_id !== row.session_id)
        throw new Error('Native history belongs to another desktop session')
    }
    for (const row of this.rows(source, 'dim_session_scopes')) {
      const known = occupied.find((scope) => scopeKey(scope) === scopeKey(row))
      if (known && known.session_id !== row.session_id)
        throw new Error('Native history belongs to another desktop session')
      let generation = known?.generation ?? row.generation
      if (!Number.isSafeInteger(generation)) throw new Error('Invalid imported Native generation')
      if (!known && existing.has(row.session_id)) {
        // Imported closed scopes must not occupy a future active generation. Immutable
        // content references use native identity; negative slots retain read-only ownership.
        generation =
          occupied.reduce(
            (lowest, scope) =>
              scope.session_id === row.session_id
                ? Math.min(lowest, Number(scope.generation))
                : lowest,
            0
          ) - 1
      }
      this.generations.set(scopeKey(row), Number(generation))
      if (!known) occupied.push({ ...row, generation })
    }
  }

  skip(table: string, row: Row): boolean {
    if (table === 'dim_session_scopes') return false
    const session =
      table === 'new_sessions' || table === 'deepchat_sessions' ? row.id : row.session_id
    return (
      this.protectedSessions.has(String(session)) ||
      this.messages.has(String(row.message_id)) ||
      this.inspectorHeads.has(String(row.head_id)) ||
      this.delegations.has(String(row.delegation_id))
    )
  }

  value(table: string, row: Row, column: string): unknown {
    if (column === 'generation') {
      if (table === 'dim_session_scopes') return this.generations.get(scopeKey(row)) ?? row[column]
      if (table === 'dim_timeline_inspector_heads')
        return (
          this.generations.get(JSON.stringify([row.native_session_id, row.branch_id])) ??
          row[column]
        )
    }
    return row[column]
  }

  private exists(database: Database.Database, table: string): boolean {
    return !!database
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table)
  }
  private rows(database: Database.Database, table: string): Row[] {
    return this.exists(database, table)
      ? (database.prepare(`SELECT * FROM "${table}"`).all() as Row[])
      : []
  }
}
