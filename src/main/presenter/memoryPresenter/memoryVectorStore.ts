import logger from '@shared/logger'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'

import { DuckDBConnection, DuckDBInstance, arrayValue } from '@duckdb/node-api'
import { app } from 'electron'

import type {
  IMemoryVectorStore,
  MemoryVectorMatch,
  MemoryVectorQueryOptions,
  MemoryVectorRecord
} from './types'

const runtimeBasePath = path
  .join(app.getAppPath(), 'runtime')
  .replace('app.asar', 'app.asar.unpacked')
const extensionDir = path.join(runtimeBasePath, 'duckdb', 'extensions')
const extensionSuffix = '.duckdb_extension'
const VSS_EXTENSION_NAME = `vss${extensionSuffix}`
const PACKAGED_VSS_ASSET_SUFFIX = '.b64'
const GUNZIP_ASYNC = promisify(gunzip)
const PACKAGED_VSS_MATERIALIZATION_PROMISES = new Map<string, Promise<string>>()

function escapeSqlPath(filePath: string): string {
  return filePath.replace(/\\/g, '\\\\').replace(/'/g, "''")
}

function materializationCacheKey(assetPath: string, materializationRoot: string): string {
  return `${path.resolve(assetPath)}\0${path.resolve(materializationRoot)}`
}

interface EmbeddingIdentity {
  providerId: string
  modelId: string
}

// DuckDB-backed memory vector store, isolated per agent and linked to SQLite by memory_id.
export class MemoryVectorStore implements IMemoryVectorStore {
  private dbInstance!: DuckDBInstance
  private connection!: DuckDBConnection
  private readonly vectorTable = 'memory_vector'
  private readonly metaTable = 'embedding_meta'
  private usable = true

  private constructor(
    private readonly dbPath: string,
    private readonly metric: 'cosine' | 'l2sq' | 'ip'
  ) {}

  static async create(
    dbPath: string,
    dimensions: number,
    embedding: EmbeddingIdentity,
    metric: 'cosine' | 'l2sq' | 'ip' = 'cosine'
  ): Promise<MemoryVectorStore> {
    const parentDir = path.dirname(dbPath)
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true })
    }
    const store = new MemoryVectorStore(dbPath, metric)
    try {
      if (fs.existsSync(dbPath)) {
        await store.open(dimensions, embedding)
      } else {
        await store.initialize(dimensions, embedding)
      }
    } catch (error) {
      await store.close().catch(() => undefined)
      throw error
    }
    return store
  }

  isUsable(): boolean {
    return this.usable
  }

  private async connect(): Promise<void> {
    this.dbInstance = await DuckDBInstance.create(this.dbPath)
    this.connection = await this.dbInstance.connect()
  }

  private async loadVssFromPath(extensionPath: string, source: string): Promise<void> {
    await this.connection.run(`LOAD '${escapeSqlPath(extensionPath)}';`)
    logger.info(`[MemoryVectorStore] loaded ${source} VSS extension: ${extensionPath}`)
    await this.connection.run('SET hnsw_enable_experimental_persistence = true;')
  }

  private async inflatePackagedVssExtension(
    assetPath: string,
    materializationRoot: string
  ): Promise<string> {
    const asset = await fs.promises.readFile(assetPath)
    const digest = createHash('sha256').update(asset).digest('hex').slice(0, 16)
    const targetDir = path.join(materializationRoot, 'duckdb', 'extensions', digest)
    const targetPath = path.join(targetDir, VSS_EXTENSION_NAME)

    if (fs.existsSync(targetPath)) {
      return targetPath
    }

    await fs.promises.mkdir(targetDir, { recursive: true })
    const tempPath = path.join(
      targetDir,
      `.${VSS_EXTENSION_NAME}.${process.pid}.${randomUUID()}.tmp`
    )
    try {
      const compressed = Buffer.from(asset.toString('utf8'), 'base64')
      await fs.promises.writeFile(tempPath, await GUNZIP_ASYNC(compressed))
      if (fs.existsSync(targetPath)) {
        await fs.promises.rm(tempPath, { force: true })
        return targetPath
      }
      await fs.promises.rename(tempPath, targetPath)
    } catch (error) {
      if (fs.existsSync(targetPath)) {
        try {
          await fs.promises.rm(tempPath, { force: true })
        } catch {
          // best effort cleanup only
        }
        return targetPath
      }
      try {
        await fs.promises.rm(tempPath, { force: true })
      } catch {
        // best effort cleanup only
      }
      throw error
    }
    return targetPath
  }

  private async materializePackagedVssExtension(assetPath: string): Promise<string> {
    const resolvedAssetPath = path.resolve(assetPath)
    const materializationRoot = path.resolve(app.getPath('userData') || path.dirname(this.dbPath))
    const cacheKey = materializationCacheKey(resolvedAssetPath, materializationRoot)
    const existing = PACKAGED_VSS_MATERIALIZATION_PROMISES.get(cacheKey)
    if (existing) {
      const existingPath = await existing
      if (fs.existsSync(existingPath)) {
        return existingPath
      }
      if (PACKAGED_VSS_MATERIALIZATION_PROMISES.get(cacheKey) === existing) {
        PACKAGED_VSS_MATERIALIZATION_PROMISES.delete(cacheKey)
      } else {
        return this.materializePackagedVssExtension(resolvedAssetPath)
      }
    }

    let materializationPromise: Promise<string>
    materializationPromise = this.inflatePackagedVssExtension(
      resolvedAssetPath,
      materializationRoot
    ).catch((error) => {
      if (PACKAGED_VSS_MATERIALIZATION_PROMISES.get(cacheKey) === materializationPromise) {
        PACKAGED_VSS_MATERIALIZATION_PROMISES.delete(cacheKey)
      }
      throw error
    })
    PACKAGED_VSS_MATERIALIZATION_PROMISES.set(cacheKey, materializationPromise)
    return materializationPromise
  }

  private async loadVss(): Promise<void> {
    const extensionPath = path.join(extensionDir, VSS_EXTENSION_NAME)
    const packagedAssetPath = `${extensionPath}${PACKAGED_VSS_ASSET_SUFFIX}`
    if (fs.existsSync(extensionPath)) {
      try {
        await this.loadVssFromPath(extensionPath, 'bundled')
        return
      } catch (error) {
        const message = `[MemoryVectorStore] bundled VSS extension failed to load from ${extensionPath}: ${String(error)}`
        if (app.isPackaged) {
          logger.error(`${message}. Vector recall disabled until a valid bundled extension ships.`)
          throw error
        }
        logger.warn(`${message}; falling back to network INSTALL vss in development.`)
      }
    } else if (app.isPackaged && fs.existsSync(packagedAssetPath)) {
      try {
        const materializedPath = await this.materializePackagedVssExtension(packagedAssetPath)
        await this.loadVssFromPath(materializedPath, 'materialized packaged')
        return
      } catch (error) {
        logger.error(
          `[MemoryVectorStore] packaged VSS extension failed to materialize/load from ${packagedAssetPath}: ${String(error)}. Vector recall disabled until a valid bundled extension ships.`
        )
        throw error
      }
    } else {
      const message = `[MemoryVectorStore] bundled VSS extension missing at ${extensionPath} or ${packagedAssetPath}. Run installRuntime:duckdb:vss before packaging.`
      if (app.isPackaged) {
        logger.error(`${message} Vector recall disabled until a valid bundled extension ships.`)
        throw new Error(message)
      }
      logger.warn(`${message} Falling back to network INSTALL vss in development.`)
    }
    await this.connection.run('INSTALL vss;')
    await this.connection.run('LOAD vss;')
    await this.connection.run('SET hnsw_enable_experimental_persistence = true;')
  }

  private async initialize(dimensions: number, embedding: EmbeddingIdentity): Promise<void> {
    logger.info(`[MemoryVectorStore] initializing at ${this.dbPath} (dim=${dimensions})`)
    await this.connect()
    await this.loadVss()
    await this.connection.run(
      `CREATE TABLE IF NOT EXISTS ${this.vectorTable} (
         memory_id VARCHAR PRIMARY KEY,
         embedding FLOAT[${dimensions}]
       );`
    )
    await this.connection.run(
      `CREATE INDEX IF NOT EXISTS idx_${this.vectorTable}_emb
         ON ${this.vectorTable}
         USING HNSW (embedding)
         WITH (metric='${this.metric}', M=16, ef_construction=200);`
    )
    await this.connection.run(
      `CREATE TABLE IF NOT EXISTS ${this.metaTable} (provider VARCHAR, model VARCHAR, dim INTEGER);`
    )
    await this.connection.run(
      `INSERT INTO ${this.metaTable} (provider, model, dim) VALUES (?, ?, ?);`,
      [embedding.providerId, embedding.modelId, dimensions]
    )
  }

  private async open(expectedDim: number, embedding: EmbeddingIdentity): Promise<void> {
    await this.connect()
    await this.loadVss()

    const meta = await this.readEmbeddingMeta()
    if (!meta) {
      // Legacy store without persisted identity: the embedding model cannot be verified,
      // so disable vector recall instead of risking stale results. Clearing memories
      // rebuilds the store with the current identity.
      this.usable = false
      logger.warn(
        `[MemoryVectorStore] no embedding identity recorded at ${this.dbPath}; cannot verify the embedding model. Vector recall disabled until reindex (FTS still active).`
      )
      return
    }
    if (
      meta.provider !== embedding.providerId ||
      meta.model !== embedding.modelId ||
      meta.dim !== expectedDim
    ) {
      this.usable = false
      logger.warn(
        `[MemoryVectorStore] embedding identity mismatch at ${this.dbPath}: stored ${meta.provider}/${meta.model}/${meta.dim}, requested ${embedding.providerId}/${embedding.modelId}/${expectedDim}. Vector recall disabled until reindex (FTS still active).`
      )
    }
  }

  private async readEmbeddingMeta(): Promise<{
    provider: string
    model: string
    dim: number
  } | null> {
    try {
      const reader = await this.connection.runAndReadAll(
        `SELECT provider, model, dim FROM ${this.metaTable} LIMIT 1;`
      )
      const row = reader.getRowObjectsJson()[0]
      if (!row) return null
      return { provider: String(row.provider), model: String(row.model), dim: Number(row.dim) }
    } catch {
      return null
    }
  }

  async upsert(records: MemoryVectorRecord[]): Promise<void> {
    if (!records.length) return
    await this.connection.run('BEGIN TRANSACTION;')
    try {
      for (const record of records) {
        const vec = arrayValue(Array.from(record.embedding))
        await this.connection.run(`DELETE FROM ${this.vectorTable} WHERE memory_id = ?;`, [
          record.memoryId
        ])
        await this.connection.run(
          `INSERT INTO ${this.vectorTable} (memory_id, embedding) VALUES (?, ?::FLOAT[]);`,
          [record.memoryId, vec]
        )
      }
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
    const fn =
      this.metric === 'ip'
        ? 'array_negative_inner_product'
        : this.metric === 'cosine'
          ? 'array_cosine_distance'
          : 'array_distance'
    const sql = `
      SELECT memory_id, ${fn}(embedding, ?) AS distance
      FROM ${this.vectorTable}
      ORDER BY distance
      LIMIT ?;
    `
    const reader = await this.connection.runAndReadAll(sql, [
      arrayValue(Array.from(embedding)),
      options.topK
    ])
    const rows = reader.getRowObjectsJson()
    return rows.map((row: Record<string, unknown>) => ({
      memoryId: String(row.memory_id),
      distance: Number(row.distance)
    }))
  }

  async deleteByMemoryIds(memoryIds: string[]): Promise<void> {
    if (!memoryIds.length) return
    const placeholders = memoryIds.map(() => '?').join(', ')
    await this.connection.run(
      `DELETE FROM ${this.vectorTable} WHERE memory_id IN (${placeholders});`,
      memoryIds
    )
  }

  /**
   * Delete an agent's store files from disk without needing an open instance (e.g. after
   * restart). `force` ignores missing files; a real failure (lock/permission) is thrown so
   * callers can surface that the on-disk store still persists instead of assuming success.
   */
  static destroyFile(dbPath: string): void {
    const failures: string[] = []
    for (const file of [dbPath, `${dbPath}.wal`]) {
      try {
        fs.rmSync(file, { force: true })
      } catch (error) {
        failures.push(`${file}: ${String(error)}`)
      }
    }
    if (failures.length) {
      throw new Error(`[MemoryVectorStore] failed to delete ${failures.join('; ')}`)
    }
  }

  async close(): Promise<void> {
    try {
      if (this.connection) this.connection.closeSync()
      if (this.dbInstance) this.dbInstance.closeSync()
    } catch (error) {
      console.error('[MemoryVectorStore] close error', error)
    }
  }
}
