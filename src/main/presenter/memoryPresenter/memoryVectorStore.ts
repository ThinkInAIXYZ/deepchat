import logger from '@shared/logger'
import fs from 'node:fs'
import path from 'node:path'

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

/**
 * 记忆向量存储（DuckDB + VSS）。与知识库向量库分离：每个 agent 一个独立 .duckdb 文件，
 * 维度由首条记忆决定。表只有一张 memory_vector，按 memory_id 关联回 SQLite 的 agent_memory。
 */
export class MemoryVectorStore implements IMemoryVectorStore {
  private dbInstance!: DuckDBInstance
  private connection!: DuckDBConnection
  private readonly vectorTable = 'memory_vector'

  private constructor(
    private readonly dbPath: string,
    private readonly metric: 'cosine' | 'l2sq' | 'ip'
  ) {}

  static async create(
    dbPath: string,
    dimensions: number,
    metric: 'cosine' | 'l2sq' | 'ip' = 'cosine'
  ): Promise<MemoryVectorStore> {
    const parentDir = path.dirname(dbPath)
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true })
    }
    const store = new MemoryVectorStore(dbPath, metric)
    if (fs.existsSync(dbPath)) {
      await store.open()
    } else {
      await store.initialize(dimensions)
    }
    return store
  }

  private async connect(): Promise<void> {
    this.dbInstance = await DuckDBInstance.create(this.dbPath)
    this.connection = await this.dbInstance.connect()
  }

  private async loadVss(): Promise<void> {
    const extensionPath = path.join(extensionDir, `vss${extensionSuffix}`)
    if (fs.existsSync(extensionPath)) {
      const escapedPath = extensionPath.replace(/\\/g, '\\\\')
      await this.connection.run(`LOAD '${escapedPath}';`)
    } else {
      await this.connection.run('INSTALL vss;')
      await this.connection.run('LOAD vss;')
    }
    await this.connection.run('SET hnsw_enable_experimental_persistence = true;')
  }

  private async initialize(dimensions: number): Promise<void> {
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
  }

  private async open(): Promise<void> {
    await this.connect()
    await this.loadVss()
  }

  async upsert(records: MemoryVectorRecord[]): Promise<void> {
    if (!records.length) return
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

  async clear(): Promise<void> {
    await this.connection.run(`DELETE FROM ${this.vectorTable};`)
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
