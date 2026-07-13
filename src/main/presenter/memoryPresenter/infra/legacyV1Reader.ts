import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api'

import type { MemoryVectorRecord } from '../types'
import { escapeDuckDbSqlPath, LegacyVssUnavailableError, loadLegacyVss } from './legacyVssLoader'
import { readSafeMemoryVectorRowCount } from './memoryVectorStoreFormat'

const LEGACY_SCHEMA = 'legacy'
export const LEGACY_V1_MIGRATION_PAGE_SIZE = 50

export class MigrationAbandonFence {
  private abandoned = false
  private committed = false
  private progressListener: (() => void) | undefined

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

  onProgress(listener: () => void): void {
    this.progressListener = listener
  }

  markProgress(): void {
    this.assertActive()
    this.progressListener?.()
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

export interface LegacyV1EmbeddingIdentity {
  providerId: string
  modelId: string
  dimensions: number
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
    fence.markProgress()
    const connection = await dbInstance.connect()
    fence.markProgress()
    try {
      await loadLegacyVss(connection, legacyPath, fence)
    } catch (error) {
      if (!(error instanceof LegacyVssUnavailableError)) throw error
      fence.assertActive()
      connection.closeSync()
      fence.assertActive()
      dbInstance.closeSync()
      throw error
    }
    fence.assertActive()
    await connection.run(
      `ATTACH '${escapeDuckDbSqlPath(legacyPath)}' AS ${LEGACY_SCHEMA} (READ_ONLY);`
    )
    fence.markProgress()
    return new LegacyV1Reader(dbInstance, connection, expectedDimensions)
  }

  async readEmbeddingIdentity(
    fence: MigrationAbandonFence
  ): Promise<LegacyV1EmbeddingIdentity | null> {
    fence.assertActive()
    const columnsReader = await this.connection.runAndReadAll(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_catalog = '${LEGACY_SCHEMA}'
         AND table_schema = 'main'
         AND table_name = 'embedding_meta';`
    )
    fence.markProgress()
    const columns = new Set(columnsReader.getRowObjectsJson().map((row) => String(row.column_name)))
    if (!['provider', 'model', 'dim'].every((column) => columns.has(column))) return null

    const reader = await this.connection.runAndReadAll(
      `SELECT provider, model, dim FROM ${LEGACY_SCHEMA}.embedding_meta LIMIT 2;`
    )
    fence.markProgress()
    const rows = reader.getRowObjectsJson()
    if (rows.length !== 1) return null
    const row = rows[0]
    if (
      typeof row.provider !== 'string' ||
      !row.provider ||
      typeof row.model !== 'string' ||
      !row.model
    ) {
      return null
    }
    const dimensions = Number(row.dim)
    if (!Number.isSafeInteger(dimensions) || dimensions <= 0) return null
    return { providerId: row.provider, modelId: row.model, dimensions }
  }

  async countRows(fence: MigrationAbandonFence): Promise<number> {
    fence.assertActive()
    const reader = await this.connection.runAndReadAll(
      `SELECT count(*) AS row_count FROM ${LEGACY_SCHEMA}.memory_vector;`
    )
    fence.markProgress()
    return readSafeMemoryVectorRowCount(reader.getRowObjectsJson(), 'legacy v1')
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
    fence.markProgress()

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
      records.push({ memoryId, embedding: source as number[] })
      previousId = memoryId
    }
    return records
  }

  closeBeforeFileMutation(fence: MigrationAbandonFence): void {
    fence.assertActive()
    this.connection.closeSync()
    fence.assertActive()
    this.dbInstance.closeSync()
  }
}
