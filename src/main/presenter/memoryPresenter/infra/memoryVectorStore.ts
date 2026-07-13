import logger from '@shared/logger'
import fs from 'node:fs'
import path from 'node:path'

import { DuckDBConnection, DuckDBInstance, arrayValue } from '@duckdb/node-api'

import type { MemoryPerfObserver } from '../ports'
import type {
  IMemoryVectorStore,
  MemoryVectorMatch,
  MemoryVectorQueryOptions,
  MemoryVectorRecord
} from '../types'
import { MemoryVectorStoreMigrationPendingError } from './vectorStoreErrors'

const MEMORY_VECTOR_STORE_FORMAT_VERSION = 2

interface EmbeddingIdentity {
  providerId: string
  modelId: string
}

interface EmbeddingMeta {
  provider: string
  model: string
  dim: number
  formatVersion: number
}

export interface MemoryVectorStorePaths {
  current: string
  staging: string
  quarantine: string
  legacy: string
}

export function createMemoryVectorStorePaths(
  memoryDbDir: string,
  agentId: string
): MemoryVectorStorePaths {
  const current = path.join(memoryDbDir, `${agentId}.v2.duckdb`)
  return {
    current,
    staging: `${current}.migrating`,
    quarantine: `${current}.quarantine`,
    legacy: path.join(memoryDbDir, `${agentId}.duckdb`)
  }
}

function filesWithWal(filePath: string): string[] {
  return [filePath, `${filePath}.wal`]
}

function removeFiles(filePaths: readonly string[]): void {
  const failures: string[] = []
  for (const filePath of filePaths) {
    try {
      fs.rmSync(filePath, { force: true })
    } catch (error) {
      failures.push(`${filePath}: ${String(error)}`)
    }
  }
  if (failures.length) {
    throw new Error(`[MemoryVectorStore] failed to delete ${failures.join('; ')}`)
  }
}

function sweepLegacyBestEffort(paths: MemoryVectorStorePaths): void {
  try {
    removeFiles(filesWithWal(paths.legacy))
  } catch (error) {
    logger.warn(
      `[MemoryVectorStore] committed v2 store is authoritative; legacy cleanup will retry later: ${String(error)}`
    )
  }
}

function assertValidDimensions(dimensions: number): void {
  if (!Number.isSafeInteger(dimensions) || dimensions <= 0) {
    throw new Error(`[MemoryVectorStore] invalid vector dimensions: ${String(dimensions)}`)
  }
}

// DuckDB-backed memory vector store, isolated per agent and linked to SQLite by memory_id.
export class MemoryVectorStore implements IMemoryVectorStore {
  private dbInstance!: DuckDBInstance
  private connection!: DuckDBConnection
  private connectionOpen = false
  private instanceOpen = false
  private readonly vectorTable = 'memory_vector'
  private readonly metaTable = 'embedding_meta'
  private usable = true

  private constructor(
    private readonly dbPath: string,
    private readonly metric: 'cosine' | 'l2sq' | 'ip',
    private readonly perfObserver?: MemoryPerfObserver
  ) {}

  static async create(
    paths: MemoryVectorStorePaths,
    dimensions: number,
    embedding: EmbeddingIdentity,
    metric: 'cosine' | 'l2sq' | 'ip' = 'cosine',
    perfObserver?: MemoryPerfObserver
  ): Promise<MemoryVectorStore> {
    assertValidDimensions(dimensions)
    fs.mkdirSync(path.dirname(paths.current), { recursive: true })

    if (fs.existsSync(paths.quarantine)) {
      MemoryVectorStore.destroyFiles(paths, { includeQuarantine: false })
      const store = await MemoryVectorStore.publishFreshV2(
        paths,
        dimensions,
        embedding,
        metric,
        perfObserver
      )
      try {
        removeFiles([paths.quarantine])
      } catch (error) {
        logger.warn(
          `[MemoryVectorStore] healthy v2 store published but quarantine marker cleanup failed; next launch will rebuild once: ${String(error)}`
        )
      }
      return store
    }

    if (fs.existsSync(paths.staging) || fs.existsSync(`${paths.staging}.wal`)) {
      removeFiles(filesWithWal(paths.staging))
    }

    if (fs.existsSync(paths.current)) {
      const store = await MemoryVectorStore.openCurrent(
        paths.current,
        dimensions,
        embedding,
        metric,
        perfObserver
      )
      sweepLegacyBestEffort(paths)
      return store
    }

    if (fs.existsSync(paths.legacy) || fs.existsSync(`${paths.legacy}.wal`)) {
      throw new MemoryVectorStoreMigrationPendingError()
    }

    return MemoryVectorStore.publishFreshV2(paths, dimensions, embedding, metric, perfObserver)
  }

  static destroyFiles(
    paths: MemoryVectorStorePaths,
    options: { includeQuarantine?: boolean } = {}
  ): void {
    const includeQuarantine = options.includeQuarantine ?? true
    removeFiles([
      ...filesWithWal(paths.current),
      ...filesWithWal(paths.staging),
      ...filesWithWal(paths.legacy),
      ...(includeQuarantine ? [paths.quarantine] : [])
    ])
  }

  static markQuarantined(paths: MemoryVectorStorePaths): void {
    fs.mkdirSync(path.dirname(paths.quarantine), { recursive: true })
    try {
      fs.writeFileSync(paths.quarantine, '', { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }

  private static async openCurrent(
    dbPath: string,
    dimensions: number,
    embedding: EmbeddingIdentity,
    metric: 'cosine' | 'l2sq' | 'ip',
    perfObserver?: MemoryPerfObserver
  ): Promise<MemoryVectorStore> {
    const store = new MemoryVectorStore(dbPath, metric, perfObserver)
    try {
      await store.open(dimensions, embedding)
      return store
    } catch (error) {
      await store.close()
      throw error
    }
  }

  private static async publishFreshV2(
    paths: MemoryVectorStorePaths,
    dimensions: number,
    embedding: EmbeddingIdentity,
    metric: 'cosine' | 'l2sq' | 'ip',
    perfObserver?: MemoryPerfObserver
  ): Promise<MemoryVectorStore> {
    removeFiles(filesWithWal(paths.staging))
    let committed = false
    const staging = new MemoryVectorStore(paths.staging, metric, perfObserver)
    try {
      await staging.initialize(dimensions, embedding)
      if (!(await staging.matchesExpectedFormat(dimensions, embedding))) {
        throw new Error('[MemoryVectorStore] staged v2 verification failed')
      }
      await staging.connection.run('CHECKPOINT;')
      staging.closeStrict()
      if (fs.existsSync(`${paths.staging}.wal`)) {
        throw new Error('[MemoryVectorStore] staged v2 WAL remains after checkpoint and close')
      }
      fs.renameSync(paths.staging, paths.current)
      committed = true
      const current = await MemoryVectorStore.openCurrent(
        paths.current,
        dimensions,
        embedding,
        metric,
        perfObserver
      )
      if (!current.isUsable()) {
        await current.close()
        throw new Error('[MemoryVectorStore] published v2 store failed its post-open self-check')
      }
      return current
    } catch (error) {
      if (!committed) {
        await staging.close()
        removeFiles(filesWithWal(paths.staging))
      }
      throw error
    }
  }

  isUsable(): boolean {
    return this.usable
  }

  private async connect(): Promise<void> {
    this.dbInstance = await DuckDBInstance.create(this.dbPath)
    this.instanceOpen = true
    this.connection = await this.dbInstance.connect()
    this.connectionOpen = true
  }

  private async initialize(dimensions: number, embedding: EmbeddingIdentity): Promise<void> {
    logger.info(`[MemoryVectorStore] initializing v2 at ${this.dbPath} (dim=${dimensions})`)
    await this.connect()
    await this.connection.run(
      `CREATE TABLE ${this.vectorTable} (
         memory_id VARCHAR PRIMARY KEY,
         embedding FLOAT[${dimensions}]
       );`
    )
    await this.connection.run(
      `CREATE TABLE ${this.metaTable} (
         provider VARCHAR NOT NULL,
         model VARCHAR NOT NULL,
         dim INTEGER NOT NULL,
         format_version INTEGER NOT NULL
       );`
    )
    await this.connection.run(
      `INSERT INTO ${this.metaTable} (provider, model, dim, format_version) VALUES (?, ?, ?, ?);`,
      [embedding.providerId, embedding.modelId, dimensions, MEMORY_VECTOR_STORE_FORMAT_VERSION]
    )
  }

  private async open(expectedDim: number, embedding: EmbeddingIdentity): Promise<void> {
    await this.connect()
    const meta = await this.readEmbeddingMeta(expectedDim)
    if (!meta) {
      this.usable = false
      logger.warn(
        `[MemoryVectorStore] invalid or missing v2 metadata at ${this.dbPath}; vector recall disabled until reindex (FTS still active).`
      )
      return
    }
    if (
      meta.formatVersion !== MEMORY_VECTOR_STORE_FORMAT_VERSION ||
      meta.provider !== embedding.providerId ||
      meta.model !== embedding.modelId ||
      meta.dim !== expectedDim
    ) {
      this.usable = false
      logger.warn(
        `[MemoryVectorStore] v2 identity mismatch at ${this.dbPath}: stored format=${meta.formatVersion} ${meta.provider}/${meta.model}/${meta.dim}, requested format=${MEMORY_VECTOR_STORE_FORMAT_VERSION} ${embedding.providerId}/${embedding.modelId}/${expectedDim}. Vector recall disabled until reindex (FTS still active).`
      )
    }
  }

  private async matchesExpectedFormat(
    expectedDim: number,
    embedding: EmbeddingIdentity
  ): Promise<boolean> {
    const meta = await this.readEmbeddingMeta(expectedDim)
    return (
      meta?.formatVersion === MEMORY_VECTOR_STORE_FORMAT_VERSION &&
      meta.provider === embedding.providerId &&
      meta.model === embedding.modelId &&
      meta.dim === expectedDim
    )
  }

  private async readEmbeddingMeta(expectedDim: number): Promise<EmbeddingMeta | null> {
    const columnsReader = await this.connection.runAndReadAll(
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'main' AND table_name IN (?, ?)
       ORDER BY table_name, ordinal_position;`,
      [this.vectorTable, this.metaTable]
    )
    const columns = columnsReader.getRowObjectsJson()
    const metaColumns = new Set(
      columns
        .filter((row: Record<string, unknown>) => String(row.table_name) === this.metaTable)
        .map((row: Record<string, unknown>) => String(row.column_name))
    )
    const vectorColumns = new Map(
      columns
        .filter((row: Record<string, unknown>) => String(row.table_name) === this.vectorTable)
        .map((row: Record<string, unknown>) => [
          String(row.column_name),
          String(row.data_type).toUpperCase()
        ])
    )
    if (
      !['provider', 'model', 'dim', 'format_version'].every((column) => metaColumns.has(column)) ||
      vectorColumns.get('memory_id') !== 'VARCHAR' ||
      vectorColumns.get('embedding') !== `FLOAT[${expectedDim}]`
    ) {
      return null
    }

    const reader = await this.connection.runAndReadAll(
      `SELECT provider, model, dim, format_version FROM ${this.metaTable} LIMIT 2;`
    )
    const rows = reader.getRowObjectsJson()
    if (rows.length !== 1) return null
    const row = rows[0]
    return {
      provider: String(row.provider),
      model: String(row.model),
      dim: Number(row.dim),
      formatVersion: Number(row.format_version)
    }
  }

  private distanceFunction(): string {
    return this.metric === 'ip'
      ? 'array_negative_inner_product'
      : this.metric === 'cosine'
        ? 'array_cosine_distance'
        : 'array_distance'
  }

  async upsert(records: MemoryVectorRecord[]): Promise<void> {
    if (!records.length) return
    await this.connection.run('BEGIN TRANSACTION;')
    try {
      const deletePlaceholders = records.map(() => '?').join(', ')
      this.perfObserver?.increment('duckDbStatements')
      await this.connection.run(
        `DELETE FROM ${this.vectorTable} WHERE memory_id IN (${deletePlaceholders});`,
        records.map((record) => record.memoryId)
      )
      const insertPlaceholders = records.map(() => '(?, ?::FLOAT[])').join(', ')
      const insertParams = records.flatMap((record) => [
        record.memoryId,
        arrayValue(Array.from(record.embedding))
      ])
      this.perfObserver?.increment('duckDbStatements')
      await this.connection.run(
        `INSERT INTO ${this.vectorTable} (memory_id, embedding) VALUES ${insertPlaceholders};`,
        insertParams
      )
      await this.connection.run('COMMIT;')
    } catch (error) {
      await this.connection.run('ROLLBACK;').catch(() => undefined)
      throw error
    }
  }

  async query(
    embedding: number[],
    options: MemoryVectorQueryOptions
  ): Promise<MemoryVectorMatch[]> {
    const fn = this.distanceFunction()
    const sql = `
      SELECT memory_id, ${fn}(embedding, ?) AS distance
      FROM ${this.vectorTable}
      ORDER BY distance
      LIMIT ?;
    `
    this.perfObserver?.increment('duckDbStatements')
    const reader = await this.connection.runAndReadAll(sql, [
      arrayValue(Array.from(embedding)),
      options.topK
    ])
    const rows = reader.getRowObjectsJson()
    this.perfObserver?.increment('materializedRows', rows.length)
    return rows.map((row: Record<string, unknown>) => ({
      memoryId: String(row.memory_id),
      distance: Number(row.distance)
    }))
  }

  async queryByMemoryId(
    memoryId: string,
    options: MemoryVectorQueryOptions
  ): Promise<MemoryVectorMatch[]> {
    this.perfObserver?.increment('duckDbStatements')
    const reader = await this.connection.runAndReadAll(
      `SELECT embedding FROM ${this.vectorTable} WHERE memory_id = ? LIMIT 1;`,
      [memoryId]
    )
    const source = reader.getRowObjectsJson()[0]?.embedding
    if (source !== undefined) this.perfObserver?.increment('materializedRows')
    if (!Array.isArray(source)) return []
    const embedding = source.map(Number).filter((value) => Number.isFinite(value))
    if (embedding.length !== source.length || embedding.length === 0) return []
    const matches = await this.query(embedding, { topK: options.topK + 1 })
    return matches.filter((match) => match.memoryId !== memoryId).slice(0, options.topK)
  }

  async deleteByMemoryIds(memoryIds: string[]): Promise<void> {
    if (!memoryIds.length) return
    const placeholders = memoryIds.map(() => '?').join(', ')
    this.perfObserver?.increment('duckDbStatements')
    await this.connection.run(
      `DELETE FROM ${this.vectorTable} WHERE memory_id IN (${placeholders});`,
      memoryIds
    )
  }

  async listMemoryIds(afterId: string | null, limit: number): Promise<string[]> {
    const cappedLimit = Math.max(0, Math.floor(limit))
    if (cappedLimit === 0) return []
    this.perfObserver?.increment('duckDbStatements')
    const reader = afterId
      ? await this.connection.runAndReadAll(
          `SELECT memory_id
           FROM ${this.vectorTable}
           WHERE memory_id > ?
           ORDER BY memory_id
           LIMIT ?;`,
          [afterId, cappedLimit]
        )
      : await this.connection.runAndReadAll(
          `SELECT memory_id
           FROM ${this.vectorTable}
           ORDER BY memory_id
           LIMIT ?;`,
          [cappedLimit]
        )
    const rows = reader.getRowObjectsJson()
    this.perfObserver?.increment('materializedRows', rows.length)
    return rows.map((row: Record<string, unknown>) => String(row.memory_id))
  }

  private closeStrict(): void {
    const errors: unknown[] = []
    if (this.connectionOpen) {
      try {
        this.connection.closeSync()
        this.connectionOpen = false
      } catch (error) {
        errors.push(error)
      }
    }
    if (this.instanceOpen) {
      try {
        this.dbInstance.closeSync()
        this.instanceOpen = false
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) {
      throw new Error(`[MemoryVectorStore] close error: ${errors.map(String).join('; ')}`)
    }
  }

  async close(): Promise<void> {
    try {
      this.closeStrict()
    } catch (error) {
      logger.warn(String(error))
    }
  }
}
