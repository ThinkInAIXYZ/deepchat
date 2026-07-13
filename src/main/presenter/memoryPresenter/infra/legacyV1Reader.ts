import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api'

import type { MemoryVectorRecord } from '../types'
import { escapeDuckDbSqlPath, loadLegacyVss } from './legacyVssLoader'

const LEGACY_SCHEMA = 'legacy'
export const LEGACY_V1_MIGRATION_PAGE_SIZE = 50

export class MigrationAbandonFence {
  private abandoned = false
  private committed = false

  abandon(): void {
    if (!this.committed) this.abandoned = true
  }

  markCommitted(): void {
    this.assertActive()
    this.committed = true
  }

  isAbandoned(): boolean {
    return this.abandoned
  }

  isCommitted(): boolean {
    return this.committed
  }

  assertActive(): void {
    if (this.abandoned) {
      throw new LegacyV1MigrationAbandonedError()
    }
  }
}

export class LegacyV1MigrationAbandonedError extends Error {
  constructor() {
    super('[MemoryVectorStore] legacy v1 migration attempt was abandoned')
    this.name = 'LegacyV1MigrationAbandonedError'
  }
}

export class LegacyV1Reader {
  private constructor(
    private readonly dbInstance: DuckDBInstance,
    private readonly connection: DuckDBConnection,
    private readonly expectedDimensions: number
  ) {}

  static async open(
    legacyPath: string,
    expectedDimensions: number,
    fence: MigrationAbandonFence
  ): Promise<LegacyV1Reader> {
    const dbInstance = await DuckDBInstance.create(':memory:')
    fence.assertActive()
    const connection = await dbInstance.connect()
    fence.assertActive()
    await loadLegacyVss(connection, legacyPath, fence)
    fence.assertActive()
    await connection.run(
      `ATTACH '${escapeDuckDbSqlPath(legacyPath)}' AS ${LEGACY_SCHEMA} (READ_ONLY);`
    )
    fence.assertActive()
    return new LegacyV1Reader(dbInstance, connection, expectedDimensions)
  }

  async countRows(fence: MigrationAbandonFence): Promise<number> {
    fence.assertActive()
    const reader = await this.connection.runAndReadAll(
      `SELECT count(*) AS row_count FROM ${LEGACY_SCHEMA}.memory_vector;`
    )
    fence.assertActive()
    const rowCount = Number(reader.getRowObjectsJson()[0]?.row_count)
    if (!Number.isSafeInteger(rowCount) || rowCount < 0) {
      throw new Error(`[MemoryVectorStore] invalid legacy v1 row count: ${String(rowCount)}`)
    }
    return rowCount
  }

  async readPage(
    afterId: string | null,
    fence: MigrationAbandonFence
  ): Promise<MemoryVectorRecord[]> {
    fence.assertActive()
    const reader = afterId
      ? await this.connection.runAndReadAll(
          `SELECT memory_id, embedding
           FROM ${LEGACY_SCHEMA}.memory_vector
           WHERE memory_id > ?
           ORDER BY memory_id
           LIMIT ?;`,
          [afterId, LEGACY_V1_MIGRATION_PAGE_SIZE]
        )
      : await this.connection.runAndReadAll(
          `SELECT memory_id, embedding
           FROM ${LEGACY_SCHEMA}.memory_vector
           ORDER BY memory_id
           LIMIT ?;`,
          [LEGACY_V1_MIGRATION_PAGE_SIZE]
        )
    fence.assertActive()

    const records: MemoryVectorRecord[] = []
    let previousId = afterId
    for (const row of reader.getRowObjectsJson()) {
      const memoryId = row.memory_id
      const source = row.embedding
      if (
        typeof memoryId !== 'string' ||
        !memoryId ||
        (previousId !== null && memoryId <= previousId)
      ) {
        throw new Error('[MemoryVectorStore] legacy v1 page is not strictly keyset ordered')
      }
      if (
        !Array.isArray(source) ||
        source.length !== this.expectedDimensions ||
        source.some((value) => typeof value !== 'number' || !Number.isFinite(value))
      ) {
        throw new Error(
          `[MemoryVectorStore] invalid legacy v1 embedding for ${memoryId}: expected ${this.expectedDimensions} finite values`
        )
      }
      records.push({ memoryId, embedding: source.map((value) => Number(value)) })
      previousId = memoryId
    }
    return records
  }

  closeForCommit(fence: MigrationAbandonFence): void {
    fence.assertActive()
    this.connection.closeSync()
    fence.assertActive()
    this.dbInstance.closeSync()
  }
}
