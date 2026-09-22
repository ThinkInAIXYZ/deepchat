import { buildMemoryTombstoneIdentities } from '@/memory/core/tombstone'
import { memoryScopeFromRow } from '@/memory/core/scope'
import type { AgentMemoryRow } from '@/memory/domain/types'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3-multiple-ciphers'
import {
  configureDatabaseChangeNotification,
  subscribeDatabaseChanges
} from '@/data/databaseChanges'
import {
  SyncBatchSchema,
  SYNC_MAX_UNITS,
  SYNC_MAX_BATCH_BYTES,
  SYNC_TARGET_BATCH_BYTES,
  type SyncBatch,
  type SyncRow,
  type SyncUnit
} from '@shared/contracts/syncReplica'
import {
  SYNC_UNITS,
  quoteIdentifier as q,
  sessionIdForRow,
  type SyncTable,
  type SyncUnitDefinition
} from './units'

type Change = {
  kind: string
  id: string
  modified_at: number
  origin: string
  revision: number
  deleted: number
}
type Definition = SyncUnitDefinition & { columns: Map<string, string[]> }

export interface SyncReplicaStoreDeps {
  database(): Database.Database
  directory: string
  canApply(kind: string, id: string): boolean
  guard?(units: SyncUnit[], operation: () => boolean): Promise<boolean>
  applied(kind: string, id: string, deleted: boolean): void
}

/** Latest-state index and canonical writes share the same SQLite transaction. */
export class SyncReplicaStore {
  replicaId: string
  private connection: Database.Database | null = null
  private definitions: Definition[] = []
  private unsubscribe: (() => void) | null = null
  private readonly listeners = new Set<() => void>()
  private notifiedRevision = -1
  private identityExisted = false

  constructor(private readonly deps: SyncReplicaStoreDeps) {
    fs.mkdirSync(deps.directory, { recursive: true, mode: 0o700 })
    const identity = path.join(deps.directory, 'replica-id')
    try {
      this.replicaId = fs.readFileSync(identity, 'utf8').trim()
      this.identityExisted = true
      if (!/^[a-f0-9-]{36}$/.test(this.replicaId)) throw new Error('Invalid replica identity')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.replicaId = randomUUID()
      fs.writeFileSync(identity, this.replicaId, { flag: 'wx', mode: 0o600 })
    }
    this.database()
  }

  private database(): Database.Database {
    const db = this.deps.database()
    if (this.connection === db) return db
    this.unsubscribe?.()
    this.connection = db
    configureDatabaseChangeNotification(db)
    const existed = Boolean(
      db.prepare("SELECT 1 FROM sqlite_master WHERE name='_sync_state'").get()
    )
    if (!existed && (this.identityExisted || this.notifiedRevision >= 0)) {
      this.replicaId = randomUUID()
      fs.writeFileSync(path.join(this.deps.directory, 'replica-id'), this.replicaId, {
        mode: 0o600
      })
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS _sync_state (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), replica TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0, suppress INTEGER NOT NULL DEFAULT 0,
        last_start INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS _sync_changes (
        kind TEXT NOT NULL, id TEXT NOT NULL, modified_at INTEGER NOT NULL,
        origin TEXT NOT NULL, revision INTEGER NOT NULL, deleted INTEGER NOT NULL,
        PRIMARY KEY(kind,id)
      );
      CREATE INDEX IF NOT EXISTS _sync_changes_revision ON _sync_changes(revision);
      CREATE TABLE IF NOT EXISTS _sync_receipts (
        replica TEXT PRIMARY KEY, cursor INTEGER NOT NULL
      );
    `)
    const prior = db.prepare('SELECT replica FROM _sync_state WHERE singleton=1').get() as
      | { replica: string }
      | undefined
    const seed = prior?.replica !== this.replicaId
    if (seed) {
      db.transaction(() => {
        db.exec('DELETE FROM _sync_changes; DELETE FROM _sync_receipts; DELETE FROM _sync_state')
        db.prepare('INSERT INTO _sync_state(singleton,replica) VALUES(1,?)').run(this.replicaId)
      })()
    }
    this.definitions = SYNC_UNITS.flatMap((definition) => {
      const columns = new Map<string, string[]>()
      for (const table of definition.tables) {
        const info = db.prepare(`PRAGMA table_info(${q(table.table)})`).all() as { name: string }[]
        if (info.length)
          columns.set(
            table.table,
            info.map((column) => column.name)
          )
      }
      if (!columns.has(definition.tables[0].table)) return []
      return [
        {
          ...definition,
          tables: definition.tables.filter((table) => columns.has(table.table)),
          columns
        }
      ]
    })
    db.transaction(() => {
      for (const definition of this.definitions) {
        for (const table of definition.tables) this.installTriggers(db, definition, table)
        if (!seed) continue
        const root = definition.tables[0]
        const columns = definition.columns.get(root.table)!
        const timestamp = columns.includes('updated_at')
          ? 'updated_at'
          : columns.includes('created_at')
            ? 'created_at'
            : '0'
        const rows = db
          .prepare(`SELECT ${q(root.key)} AS id, ${timestamp} AS timestamp FROM ${q(root.table)}`)
          .all() as { id: string; timestamp: number }[]
        for (const row of rows) {
          if (definition.keys && !definition.keys.includes(row.id)) continue
          if (!this.change(db, definition.kind, row.id))
            this.record(
              db,
              definition.kind,
              row.id,
              Math.max(0, row.timestamp || 0),
              this.replicaId,
              false
            )
        }
      }
    })()
    this.notifiedRevision = this.revision()
    this.unsubscribe = subscribeDatabaseChanges(db.name, () => {
      if (!db.open) return
      const revision = this.revision()
      if (revision === this.notifiedRevision) return
      this.notifiedRevision = revision
      for (const listener of this.listeners) listener()
    })
    return db
  }

  private installTriggers(db: Database.Database, definition: Definition, table: SyncTable): void {
    const columns = definition.columns.get(table.table)!
    const ignored = new Set([...(table.local ?? []), 'updated_at', 'revision'])
    if (definition.kind === 'memory') ignored.add('status')
    const portable = columns.filter((column) => !ignored.has(column))
    for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
      const row = operation === 'DELETE' ? 'OLD' : 'NEW'
      const key = table.messageChild
        ? `(SELECT session_id FROM deepchat_messages WHERE id=${row}.${q(table.key)})`
        : `${row}.${q(table.key)}`
      const root = table === definition.tables[0]
      const deleted = root && operation === 'DELETE' ? 1 : 0
      const filter = definition.keys
        ? `AND ${key} IN (${definition.keys.map((key) => `'${key}'`).join(',')})`
        : ''
      const changed =
        operation === 'UPDATE'
          ? `AND (${portable.map((column) => `OLD.${q(column)} IS NOT NEW.${q(column)}`).join(' OR ')})`
          : ''
      const trigger = q(`_sync_${table.table}_${operation.toLowerCase()}`)
      // BEFORE DELETE preserves a child's parent identity while a cascade still has it available.
      db.exec(`DROP TRIGGER IF EXISTS ${trigger}; CREATE TRIGGER ${trigger}
        ${operation === 'DELETE' ? 'BEFORE' : 'AFTER'} ${operation} ON ${q(table.table)}
        WHEN (SELECT suppress FROM _sync_state WHERE singleton=1)=0 AND ${key} IS NOT NULL ${filter} ${changed}
        BEGIN
          UPDATE _sync_state SET revision=revision+1 WHERE singleton=1;
          INSERT INTO _sync_changes(kind,id,modified_at,origin,revision,deleted)
          VALUES('${definition.kind}',${key},CAST(unixepoch('subsec')*1000 AS INTEGER),
            (SELECT replica FROM _sync_state WHERE singleton=1),
            (SELECT revision FROM _sync_state WHERE singleton=1),${deleted})
          ON CONFLICT(kind,id) DO UPDATE SET
            modified_at=MAX(excluded.modified_at,_sync_changes.modified_at+1),
            origin=excluded.origin, revision=excluded.revision,
            deleted=${root ? 'excluded.deleted' : '_sync_changes.deleted'};
          SELECT deepchat_sync_notify();
        END;`)
    }
  }

  private change(db: Database.Database, kind: string, id: string): Change | undefined {
    return db.prepare('SELECT * FROM _sync_changes WHERE kind=? AND id=?').get(kind, id) as
      | Change
      | undefined
  }

  private record(
    db: Database.Database,
    kind: string,
    id: string,
    timestamp: number,
    origin: string,
    deleted: boolean
  ): void {
    db.exec('UPDATE _sync_state SET revision=revision+1 WHERE singleton=1')
    db.prepare(`INSERT INTO _sync_changes(kind,id,modified_at,origin,revision,deleted)
      VALUES(?,?,?,?,(SELECT revision FROM _sync_state WHERE singleton=1),?)
      ON CONFLICT(kind,id) DO UPDATE SET modified_at=excluded.modified_at,origin=excluded.origin,
      revision=excluded.revision,deleted=excluded.deleted`).run(
      kind,
      id,
      timestamp,
      origin,
      Number(deleted)
    )
  }

  revision(): number {
    return (
      this.database().prepare('SELECT revision FROM _sync_state WHERE singleton=1').get() as {
        revision: number
      }
    ).revision
  }

  cursor(replica: string): number {
    return (
      (
        this.database()
          .prepare('SELECT cursor FROM _sync_receipts WHERE replica=?')
          .get(replica) as { cursor: number } | undefined
      )?.cursor ?? 0
    )
  }

  lastStart(): number {
    return (
      this.database().prepare('SELECT last_start FROM _sync_state WHERE singleton=1').get() as {
        last_start: number
      }
    ).last_start
  }

  started(at: number): void {
    this.database().prepare('UPDATE _sync_state SET last_start=? WHERE singleton=1').run(at)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private where(table: SyncTable): string {
    return table.messageChild
      ? `${q(table.key)} IN (SELECT id FROM deepchat_messages WHERE session_id=?)`
      : `${q(table.key)}=?`
  }

  export(after: number): SyncBatch {
    const db = this.database()
    return db.transaction(() => {
      const changes = db
        .prepare('SELECT * FROM _sync_changes WHERE revision>? ORDER BY revision LIMIT ?')
        .all(after, SYNC_MAX_UNITS) as Change[]
      const units: SyncUnit[] = []
      let through = after
      let bytes = 1024
      for (const change of changes) {
        if (!this.deps.canApply(change.kind, change.id)) break
        const definition = this.definitions.find((value) => value.kind === change.kind)!
        const tables: Record<string, SyncRow[]> = {}
        if (!change.deleted) {
          for (const table of definition.tables) {
            const columns = definition.columns
              .get(table.table)!
              .filter((column) => !table.local?.includes(column))
            tables[table.table] = db
              .prepare(
                `SELECT ${columns.map(q).join(',')} FROM ${q(table.table)} WHERE ${this.where(table)}`
              )
              .all(change.id) as SyncRow[]
          }
        }
        const absent = !change.deleted && (tables[definition.tables[0].table]?.length ?? 0) === 0
        const unit: SyncUnit = {
          kind: change.kind,
          id: change.id,
          modifiedAt: change.modified_at,
          origin: change.origin,
          revision: change.revision,
          deleted: Boolean(change.deleted) || absent,
          tables: absent ? {} : tables
        }
        const size = Buffer.byteLength(JSON.stringify(unit))
        if (size > SYNC_MAX_BATCH_BYTES - 4096) throw new Error('sync.tunnel.error.batchTooLarge')
        if (units.length && bytes + size > SYNC_TARGET_BATCH_BYTES) break
        bytes += size
        units.push(unit)
        through = change.revision
      }
      return { protocol: 2, replicaId: this.replicaId, after, through, units }
    })()
  }

  async apply(input: SyncBatch, authorized: () => boolean = () => true): Promise<boolean> {
    this.database()
    const batch = SyncBatchSchema.parse(input)
    for (const unit of batch.units) this.validateUnit(unit)
    const commit = () => {
      if (!authorized()) throw new Error('sync.tunnel.error.cancelled')
      return this.applyCommitted(batch)
    }
    return this.deps.guard
      ? this.deps.guard(
          batch.units.filter((unit) => {
            const local = this.change(this.database(), unit.kind, unit.id)
            return (
              !local ||
              local.modified_at < unit.modifiedAt ||
              (local.modified_at === unit.modifiedAt && local.origin < unit.origin)
            )
          }),
          commit
        )
      : commit()
  }

  private applyCommitted(batch: SyncBatch): boolean {
    if (batch.replicaId === this.replicaId || batch.through < batch.after)
      throw new Error('Invalid sync batch')
    const db = this.database()
    const applied: SyncUnit[] = []
    const completed = db.transaction(() => {
      const cursor = this.cursor(batch.replicaId)
      if (batch.through <= cursor) return true
      if (batch.after > cursor) throw new Error('Sync cursor gap')
      let previous = batch.after
      for (const unit of batch.units) {
        if (unit.revision <= previous || unit.revision > batch.through)
          throw new Error('Invalid sync revision')
        previous = unit.revision
        const local = this.change(db, unit.kind, unit.id)
        if (
          local &&
          (local.modified_at > unit.modifiedAt ||
            (local.modified_at === unit.modifiedAt && local.origin >= unit.origin))
        )
          continue
        if (!this.deps.canApply(unit.kind, unit.id)) return false
      }
      if (previous !== batch.through) throw new Error('Incomplete sync batch')
      db.exec('UPDATE _sync_state SET suppress=1 WHERE singleton=1')
      for (const unit of batch.units) {
        const local = this.change(db, unit.kind, unit.id)
        if (
          local &&
          (local.modified_at > unit.modifiedAt ||
            (local.modified_at === unit.modifiedAt && local.origin >= unit.origin))
        )
          continue
        this.applyUnit(db, unit)
        const suppressedMemory =
          unit.kind === 'memory' &&
          !unit.deleted &&
          !db.prepare('SELECT 1 FROM agent_memory WHERE id=?').get(unit.id)
        this.record(
          db,
          unit.kind,
          unit.id,
          unit.modifiedAt + Number(suppressedMemory),
          unit.origin,
          unit.deleted || suppressedMemory
        )
        applied.push(unit)
      }
      db.exec('UPDATE _sync_state SET suppress=0 WHERE singleton=1')
      db.prepare(`INSERT INTO _sync_receipts(replica,cursor) VALUES(?,?)
        ON CONFLICT(replica) DO UPDATE SET cursor=MAX(cursor,excluded.cursor)`).run(
        batch.replicaId,
        batch.through
      )
      return true
    })()
    for (const unit of applied) {
      try {
        this.deps.applied(unit.kind, unit.id, unit.deleted)
      } catch (error) {
        console.warn('[Sync] Refresh after committed import failed', error)
      }
    }
    this.notifiedRevision = this.revision()
    if (applied.length) for (const listener of this.listeners) listener()
    return completed
  }

  private validateUnit(unit: SyncUnit): Definition {
    const definition = this.definitions.find((value) => value.kind === unit.kind)
    if (!definition || (definition.keys && !definition.keys.includes(unit.id)))
      throw new Error('Unsupported sync unit')
    const allowed = new Set(definition.tables.map((table) => table.table))
    if (Object.keys(unit.tables).some((table) => !allowed.has(table)))
      throw new Error('Unsupported sync table')
    const root = definition.tables[0]
    const rootRows = unit.tables[root.table] ?? []
    if (!unit.deleted && (rootRows.length !== 1 || rootRows[0][root.key] !== unit.id))
      throw new Error('Invalid sync root')
    const messages = unit.tables.deepchat_messages ?? []
    for (const table of definition.tables) {
      for (const row of unit.tables[table.table] ?? []) {
        if (sessionIdForRow(table, row, messages) !== unit.id)
          throw new Error('Invalid sync ownership')
        if (
          Object.keys(row).some(
            (column) =>
              !definition.columns.get(table.table)!.includes(column) ||
              table.local?.includes(column)
          )
        )
          throw new Error('Unsupported sync field')
      }
    }
    if (unit.deleted && Object.values(unit.tables).some((rows) => rows.length))
      throw new Error('Deleted unit contains rows')
    return definition
  }

  private applyUnit(db: Database.Database, unit: SyncUnit): void {
    const definition = this.validateUnit(unit)
    const root = definition.tables[0]
    const preserved = db
      .prepare(`SELECT * FROM ${q(root.table)} WHERE ${q(root.key)}=?`)
      .get(unit.id) as SyncRow | undefined
    for (const table of [...definition.tables].reverse())
      db.prepare(`DELETE FROM ${q(table.table)} WHERE ${this.where(table)}`).run(unit.id)
    if (!unit.deleted) {
      for (const table of definition.tables) {
        for (const input of unit.tables[table.table] ?? []) {
          const row = { ...input }
          for (const column of table.local ?? []) {
            if (table === root && preserved && column in preserved) row[column] = preserved[column]
          }
          if (
            table.table === 'new_sessions' &&
            definition.columns.get(table.table)!.includes('revision')
          ) {
            row.revision = Number(preserved?.revision ?? 0) + 1
          }
          if (table.table === 'agent_memory') {
            if (this.memoryDeleted(db, row)) continue
            row.embedding_state = 'pending'
            row.status =
              row.lifecycle_state === 'active' ? 'pending_embedding' : row.lifecycle_state
          }
          const columns = Object.keys(row)
          db.prepare(
            `INSERT INTO ${q(table.table)} (${columns.map(q).join(',')}) VALUES (${columns.map(() => '?').join(',')})`
          ).run(...columns.map((column) => row[column]))
        }
      }
    }
    if (unit.kind === 'memory-tombstone' && !unit.deleted) {
      const tombstone = unit.tables.agent_memory_tombstone[0]
      const memories = db
        .prepare('SELECT * FROM agent_memory WHERE agent_id=?')
        .all(tombstone.agent_id) as SyncRow[]
      for (const row of memories) {
        if (this.memoryDeleted(db, row)) {
          db.prepare('DELETE FROM agent_memory WHERE id=?').run(row.id)
          const prior = this.change(db, 'memory', String(row.id))
          // A domain tombstone also deletes matching duplicate IDs. Derive its stamp from the
          // original facts, never the receiver clock, so that deletion can propagate onward.
          this.record(
            db,
            'memory',
            String(row.id),
            Math.max(unit.modifiedAt, prior?.modified_at ?? 0) + 1,
            unit.origin,
            true
          )
        }
      }
    }
    if (unit.kind === 'session') {
      for (const table of [
        'deepchat_transcript_projection_meta',
        'deepchat_search_documents',
        'deepchat_tape_search_projection',
        'deepchat_tape_search_projection_meta',
        'deepchat_tape_search_fts_meta',
        'deepchat_tape_search_fts',
        'deepchat_memory_ingestion_projection',
        'deepchat_memory_ingestion_projection_meta'
      ]) {
        if (
          (db.prepare(`PRAGMA table_info(${q(table)})`).all() as { name: string }[]).some(
            (column) => column.name === 'session_id'
          )
        )
          db.prepare(`DELETE FROM ${q(table)} WHERE session_id=?`).run(unit.id)
      }
    }
  }

  private memoryDeleted(db: Database.Database, row: SyncRow): boolean {
    if (
      row.kind === 'persona' ||
      row.kind === 'working' ||
      !this.definitions.some((item) => item.kind === 'memory-tombstone')
    )
      return false
    const identities = buildMemoryTombstoneIdentities({
      agentId: row.agent_id as string,
      content: row.content as string,
      provenanceKey: typeof row.provenance_key === 'string' ? row.provenance_key : null,
      scope: memoryScopeFromRow(row as unknown as AgentMemoryRow)
    })
    const lookup = db.prepare(
      'SELECT 1 FROM agent_memory_tombstone WHERE agent_id=? AND identity_kind=? AND identity_hash=?'
    )
    return identities.some((identity) =>
      Boolean(lookup.get(row.agent_id, identity.identityKind, identity.identityHash))
    )
  }

  wake(): void {
    for (const listener of this.listeners) listener()
  }

  close(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.listeners.clear()
  }
}
