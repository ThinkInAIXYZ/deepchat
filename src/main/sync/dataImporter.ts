import Database from 'better-sqlite3-multiple-ciphers'
import { configureSQLiteConnection } from '@/data/connectionConfig'
import { shouldExcludeFromSqliteCopy } from '@/data/sqliteCopyExclusions'
import { orderSqliteTablesForCopy } from '@/data/sqliteCopyOrder'
import {
  isAgentMemoryEmbeddingState,
  isAgentMemoryKind,
  isAgentMemoryLifecycleState,
  isLegacyAgentMemoryStatus,
  normalizeCanonicalStateFromLegacy,
  projectLegacyStatus
} from '../memory/domain/stateModel'
import {
  buildMemoryTombstoneIdentities,
  isTombstoneEligibleMemoryKind
} from '../memory/core/tombstone'
import { tryNormalizeMemoryTemporalMetadata } from '../memory/core/temporal'
import { legacyUserScopeForMemoryScope, memoryScopeFromRow } from '../memory/core/scope'
import type {
  AgentMemoryEmbeddingState,
  AgentMemoryLifecycleState,
  AgentMemoryStatus,
  MemoryScope,
  MemoryTemporalMetadata
} from '../memory/domain/types'

export interface ImportSummary {
  tableCounts: Record<string, number>
  repairedRowCounts: Record<string, number>
  skippedRowCounts: Record<string, number>
}

type ColumnInfo = {
  name: string
  pk: number
}

const AGENT_MEMORY_TEMPORAL_COLUMNS = [
  'temporal_kind',
  'valid_from',
  'valid_until',
  'temporal_confidence',
  'temporal_precision',
  'temporal_timezone'
] as const
const AGENT_MEMORY_SCOPE_COLUMNS = ['scope_type', 'scope_id'] as const

function parseImportedMemoryScope(row: Record<string, unknown>): MemoryScope | null {
  const scopeType = row.scope_type
  const scopeId = row.scope_id
  if (scopeType === 'agent') {
    return scopeId === null
      ? memoryScopeFromRow({ scope_type: scopeType, scope_id: scopeId })
      : null
  }
  if (
    (scopeType !== 'user' && scopeType !== 'project' && scopeType !== 'session') ||
    typeof scopeId !== 'string'
  ) {
    return null
  }
  try {
    return memoryScopeFromRow({ scope_type: scopeType, scope_id: scopeId })
  } catch {
    return null
  }
}

/**
 * 数据导入类
 * 用于从外部SQLite数据库导入数据到当前数据库
 */
export class DataImporter {
  private sourceDb: Database.Database
  private targetDb: Database.Database

  constructor(
    sourcePath: string,
    targetDbOrPath: Database.Database | string,
    sourcePassword?: string,
    targetPassword?: string
  ) {
    this.sourceDb = new Database(sourcePath)
    this.configureConnection(this.sourceDb, sourcePassword)

    if (typeof targetDbOrPath === 'string') {
      this.targetDb = new Database(targetDbOrPath)
      this.configureConnection(this.targetDb, targetPassword)
    } else {
      this.targetDb = targetDbOrPath
    }
  }

  private configureConnection(db: Database.Database, password?: string): void {
    configureSQLiteConnection(db, password)
  }

  /**
   * 开始导入数据
   */
  public async importData(): Promise<ImportSummary> {
    const tableCounts: Record<string, number> = {}
    const repairedRowCounts: Record<string, number> = {}
    const skippedRowCounts: Record<string, number> = {}
    const tables = this.getTablesInOrder()

    const importTransaction = this.targetDb.transaction(() => {
      for (const table of tables) {
        try {
          const result = this.importTable(table)
          if (result.inserted > 0) {
            tableCounts[table] = result.inserted
          }
          if (result.repaired > 0) repairedRowCounts[table] = result.repaired
          if (result.skipped > 0) skippedRowCounts[table] = result.skipped
        } catch (error) {
          throw new Error(
            `Failed to import table ${table}: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
      if (
        tableCounts.agent_memory > 0 &&
        this.tableExists(this.targetDb, 'agent_memory_fts_meta')
      ) {
        this.targetDb
          .prepare("DELETE FROM agent_memory_fts_meta WHERE key = 'agent_memory_fts'")
          .run()
      }
    })

    try {
      importTransaction()
      return { tableCounts, repairedRowCounts, skippedRowCounts }
    } catch (transactionError) {
      throw new Error(
        `Failed to import database: ${
          transactionError instanceof Error ? transactionError.message : String(transactionError)
        }`
      )
    }
  }

  private getTablesInOrder(): string[] {
    const allTables = this.sourceDb
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      )
      .all() as { name: string; sql: string | null }[]

    // Virtual tables (e.g. FTS5) and their shadow tables cannot be written by a plain column-copy
    // INSERT — SQLite raises "table X may not be modified". Note FTS5 shadow tables
    // (<vtab>_data/_idx/_docsize/_config/_content) DO carry a real CREATE TABLE sql in
    // sqlite_master, so they must be excluded by name prefix, not by inspecting their sql.
    // For external-content FTS the index is rebuilt by triggers when the content table is imported.
    const virtualTableNames = allTables
      .filter((table) => typeof table.sql === 'string' && /^CREATE VIRTUAL TABLE/i.test(table.sql))
      .map((table) => table.name)

    const isVirtualOrShadow = (name: string): boolean =>
      virtualTableNames.some((vtab) => name === vtab || name.startsWith(`${vtab}_`))

    const tables = allTables.filter(
      (table) => !isVirtualOrShadow(table.name) && !shouldExcludeFromSqliteCopy(table.name)
    )

    return orderSqliteTablesForCopy(this.targetDb, tables).map((table) => table.name)
  }

  private importTable(tableName: string): {
    inserted: number
    repaired: number
    skipped: number
  } {
    const sourceColumns = this.getTableColumns(this.sourceDb, tableName)
    const targetColumns = this.getTableColumns(this.targetDb, tableName)

    if (targetColumns.length === 0) {
      return { inserted: 0, repaired: 0, skipped: 0 }
    }

    const targetColumnNames = new Set(targetColumns.map((column) => column.name))
    const commonColumns = sourceColumns.filter((column) => targetColumnNames.has(column.name))

    if (commonColumns.length === 0) {
      return { inserted: 0, repaired: 0, skipped: 0 }
    }

    const pkColumns = targetColumns
      .filter((column) => column.pk > 0 && commonColumns.some((col) => col.name === column.name))
      .sort((a, b) => a.pk - b.pk)

    const sourceColumnNames = new Set(sourceColumns.map((column) => column.name))
    const targetColumnNamesInInsert = commonColumns.map((column) => column.name)
    const normalizeAgentMemoryState =
      tableName === 'agent_memory' &&
      targetColumnNames.has('lifecycle_state') &&
      targetColumnNames.has('embedding_state')
    const targetSupportsAgentMemoryTemporal =
      tableName === 'agent_memory' &&
      AGENT_MEMORY_TEMPORAL_COLUMNS.every((column) => targetColumnNames.has(column))
    const sourceAgentMemoryTemporalColumnCount = AGENT_MEMORY_TEMPORAL_COLUMNS.filter((column) =>
      sourceColumnNames.has(column)
    ).length
    const targetSupportsAgentMemoryScope =
      tableName === 'agent_memory' &&
      AGENT_MEMORY_SCOPE_COLUMNS.every((column) => targetColumnNames.has(column))
    const sourceAgentMemoryScopeColumnCount = AGENT_MEMORY_SCOPE_COLUMNS.filter((column) =>
      sourceColumnNames.has(column)
    ).length
    if (normalizeAgentMemoryState) {
      if (!targetColumnNames.has('status')) {
        throw new Error(
          'Unsupported target agent_memory schema: canonical state requires legacy status shadow'
        )
      }
      if (!targetColumnNamesInInsert.includes('status')) {
        targetColumnNamesInInsert.push('status')
      }
      if (!targetColumnNamesInInsert.includes('lifecycle_state')) {
        targetColumnNamesInInsert.push('lifecycle_state')
      }
      if (!targetColumnNamesInInsert.includes('embedding_state')) {
        targetColumnNamesInInsert.push('embedding_state')
      }
    }
    if (
      targetSupportsAgentMemoryScope &&
      sourceAgentMemoryScopeColumnCount === AGENT_MEMORY_SCOPE_COLUMNS.length &&
      targetColumnNames.has('user_scope') &&
      !targetColumnNamesInInsert.includes('user_scope')
    ) {
      targetColumnNamesInInsert.push('user_scope')
    }

    const wrappedTableName = this.wrapIdentifier(tableName)
    const selectColumnsSql = commonColumns
      .map((column) => this.wrapIdentifier(column.name))
      .join(', ')
    const rows = this.sourceDb
      .prepare(`SELECT ${selectColumnsSql} FROM ${wrappedTableName}`)
      .all() as Record<string, unknown>[]

    if (rows.length === 0) {
      return { inserted: 0, repaired: 0, skipped: 0 }
    }

    const insertColumnsSql = targetColumnNamesInInsert
      .map((column) => this.wrapIdentifier(column))
      .join(', ')
    const insertPlaceholders = Array.from(
      { length: targetColumnNamesInInsert.length },
      () => '?'
    ).join(', ')
    const insertSql =
      pkColumns.length > 0
        ? `INSERT OR IGNORE INTO ${wrappedTableName} (${insertColumnsSql}) VALUES (${insertPlaceholders})`
        : `INSERT INTO ${wrappedTableName} (${insertColumnsSql}) VALUES (${insertPlaceholders})`
    const insertStmt = this.targetDb.prepare(insertSql)
    const tombstoneLookups =
      tableName === 'agent_memory'
        ? [this.sourceDb, this.targetDb]
            .filter((db) => this.tableExists(db, 'agent_memory_tombstone'))
            .map((db) =>
              db.prepare(
                `SELECT 1 AS present
                 FROM agent_memory_tombstone
                 WHERE agent_id = ? AND identity_kind = ? AND identity_hash = ?
                 LIMIT 1`
              )
            )
        : []

    let inserted = 0
    let repaired = 0
    let skipped = 0
    for (const row of rows) {
      let normalizedState:
        | {
            lifecycleState: AgentMemoryLifecycleState
            embeddingState: AgentMemoryEmbeddingState
            status: AgentMemoryStatus
          }
        | undefined
      let repairedState = false
      let normalizedTemporal: MemoryTemporalMetadata | undefined
      let normalizedScope: MemoryScope | undefined
      let repairedMetadata = false
      if (normalizeAgentMemoryState) {
        if (!isAgentMemoryKind(row.kind)) {
          skipped += 1
          continue
        }
        const derived = normalizeCanonicalStateFromLegacy({
          status: row.status,
          kind: row.kind,
          embedding_id: typeof row.embedding_id === 'string' ? row.embedding_id : null,
          embedding_dim: typeof row.embedding_dim === 'number' ? row.embedding_dim : null,
          embedding_model: typeof row.embedding_model === 'string' ? row.embedding_model : null
        })
        const hasLifecycleState = sourceColumnNames.has('lifecycle_state')
        const hasEmbeddingState = sourceColumnNames.has('embedding_state')
        if (hasLifecycleState && !isAgentMemoryLifecycleState(row.lifecycle_state)) {
          skipped += 1
          continue
        }
        if (hasEmbeddingState && !isAgentMemoryEmbeddingState(row.embedding_state)) {
          skipped += 1
          continue
        }
        const lifecycleState: AgentMemoryLifecycleState = hasLifecycleState
          ? (row.lifecycle_state as AgentMemoryLifecycleState)
          : derived.state.lifecycleState
        const embeddingState: AgentMemoryEmbeddingState = hasEmbeddingState
          ? (row.embedding_state as AgentMemoryEmbeddingState)
          : derived.state.embeddingState
        const projectedStatus = projectLegacyStatus(lifecycleState, embeddingState)
        repairedState =
          derived.repairedLegacyStatus ||
          !isLegacyAgentMemoryStatus(row.status) ||
          row.status !== projectedStatus
        normalizedState = {
          lifecycleState,
          embeddingState,
          status: projectedStatus
        }
      }
      if (targetSupportsAgentMemoryTemporal) {
        if (
          sourceAgentMemoryTemporalColumnCount > 0 &&
          sourceAgentMemoryTemporalColumnCount < AGENT_MEMORY_TEMPORAL_COLUMNS.length
        ) {
          skipped += 1
          continue
        }
        if (sourceAgentMemoryTemporalColumnCount === AGENT_MEMORY_TEMPORAL_COLUMNS.length) {
          normalizedTemporal =
            tryNormalizeMemoryTemporalMetadata({
              temporalKind: row.temporal_kind,
              validFrom: row.valid_from,
              validUntil: row.valid_until,
              temporalConfidence: row.temporal_confidence,
              temporalPrecision: row.temporal_precision,
              temporalTimeZone: row.temporal_timezone
            }) ?? undefined
          if (!normalizedTemporal) {
            skipped += 1
            continue
          }
          repairedMetadata =
            row.temporal_kind !== normalizedTemporal.temporalKind ||
            row.valid_from !== normalizedTemporal.validFrom ||
            row.valid_until !== normalizedTemporal.validUntil ||
            row.temporal_confidence !== normalizedTemporal.temporalConfidence ||
            row.temporal_precision !== normalizedTemporal.temporalPrecision ||
            row.temporal_timezone !== normalizedTemporal.temporalTimeZone
        }
      }
      if (targetSupportsAgentMemoryScope) {
        if (
          sourceAgentMemoryScopeColumnCount > 0 &&
          sourceAgentMemoryScopeColumnCount < AGENT_MEMORY_SCOPE_COLUMNS.length
        ) {
          skipped += 1
          continue
        }
        if (sourceAgentMemoryScopeColumnCount === AGENT_MEMORY_SCOPE_COLUMNS.length) {
          normalizedScope = parseImportedMemoryScope(row) ?? undefined
          if (!normalizedScope) {
            skipped += 1
            continue
          }
          const expectedLegacyUserScope = legacyUserScopeForMemoryScope(normalizedScope)
          const hasLegacyUserScope = sourceColumnNames.has('user_scope')
          const legacyUserScopeIsValid =
            normalizedScope.type === 'agent' ||
            !hasLegacyUserScope ||
            row.user_scope === expectedLegacyUserScope
          if (!legacyUserScopeIsValid) {
            skipped += 1
            continue
          }
          repairedMetadata ||= !hasLegacyUserScope && expectedLegacyUserScope !== null
        }
      }
      if (
        tombstoneLookups.length > 0 &&
        typeof row.agent_id === 'string' &&
        isAgentMemoryKind(row.kind) &&
        isTombstoneEligibleMemoryKind(row.kind) &&
        typeof row.content === 'string'
      ) {
        const identities = buildMemoryTombstoneIdentities({
          agentId: row.agent_id,
          content: row.content,
          provenanceKey: typeof row.provenance_key === 'string' ? row.provenance_key : null,
          scope: normalizedScope ?? { type: 'agent' }
        })
        if (
          tombstoneLookups.some((lookup) =>
            identities.some((identity) =>
              lookup.get(row.agent_id, identity.identityKind, identity.identityHash)
            )
          )
        ) {
          skipped += 1
          continue
        }
      }
      const values = targetColumnNamesInInsert.map((column) => {
        if (normalizedState) {
          if (column === 'lifecycle_state') return normalizedState.lifecycleState
          if (column === 'embedding_state') return normalizedState.embeddingState
          if (column === 'status') return normalizedState.status
        }
        if (normalizedTemporal) {
          if (column === 'temporal_kind') return normalizedTemporal.temporalKind
          if (column === 'valid_from') return normalizedTemporal.validFrom
          if (column === 'valid_until') return normalizedTemporal.validUntil
          if (column === 'temporal_confidence') return normalizedTemporal.temporalConfidence
          if (column === 'temporal_precision') return normalizedTemporal.temporalPrecision
          if (column === 'temporal_timezone') return normalizedTemporal.temporalTimeZone
        }
        if (normalizedScope) {
          if (column === 'scope_type') return normalizedScope.type
          if (column === 'scope_id')
            return normalizedScope.type === 'agent' ? null : normalizedScope.id
          if (column === 'user_scope') {
            return normalizedScope.type === 'agent'
              ? (row.user_scope ?? null)
              : legacyUserScopeForMemoryScope(normalizedScope)
          }
        }
        return row[column]
      })
      const info = insertStmt.run(...values)
      if (pkColumns.length === 0 || info.changes > 0) {
        inserted++
        if (repairedState || repairedMetadata) repaired++
      }
    }

    return { inserted, repaired, skipped }
  }

  private getTableColumns(db: Database.Database, tableName: string): ColumnInfo[] {
    const wrappedTableName = this.wrapIdentifier(tableName)
    try {
      const columns = db.prepare(`PRAGMA table_info(${wrappedTableName})`).all() as ColumnInfo[]
      return columns
    } catch (error) {
      console.warn(`Failed to read table info for ${tableName}:`, error)
      return []
    }
  }

  private tableExists(db: Database.Database, tableName: string): boolean {
    const row = db
      .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName) as { found: number } | undefined
    return row?.found === 1
  }

  private wrapIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`
  }

  public close(): void {
    if (this.sourceDb) {
      this.sourceDb.close()
    }
    if (this.targetDb) {
      this.targetDb.close()
    }
  }
}
