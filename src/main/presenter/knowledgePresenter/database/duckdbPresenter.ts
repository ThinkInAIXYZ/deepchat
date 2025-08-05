/**
 * DuckDB 数据库 Presenter
 */
import fs from 'node:fs'
import path from 'node:path'

import { DuckDBConnection, DuckDBInstance, arrayValue } from '@duckdb/node-api'
import {
  IndexOptions,
  VectorInsertOptions,
  QueryOptions,
  QueryResult,
  IVectorDatabasePresenter,
  KnowledgeFileMessage,
  KnowledgeChunkMessage,
  KnowledgeTaskStatus
} from '@shared/presenter'

import { nanoid } from 'nanoid'
import { app } from 'electron'

const runtimeBasePath = path
  .join(app.getAppPath(), 'runtime')
  .replace('app.asar', 'app.asar.unpacked')
const extensionDir = path.join(runtimeBasePath, 'duckdb', 'extensions')
const extensionSuffix = '.duckdb_extension'

// 数据库版本常量
const CURRENT_DB_VERSION = 1
const DB_VERSION_KEY = 'db_version'

// 迁移接口定义
interface DatabaseMigration {
  version: number
  description: string
  up: (presenter: DuckDBPresenter) => Promise<void>
  down?: (presenter: DuckDBPresenter) => Promise<void>
}

// 数据库迁移定义
const MIGRATIONS: DatabaseMigration[] = [
  {
    version: 1,
    description: 'Initial database schema',
    up: async (_presenter: DuckDBPresenter) => {
      // 初始版本的迁移在 initialize 方法中已经处理
      console.log('[DuckDB Migration] Applied initial schema (v1)')
    }
  }
  // 未来的迁移示例：
  // {
  //   version: 2,
  //   description: 'Add file size and hash columns',
  //   up: async (presenter: DuckDBPresenter) => {
  //     await presenter.safeRun('ALTER TABLE file ADD COLUMN file_size BIGINT;')
  //     await presenter.safeRun('ALTER TABLE file ADD COLUMN file_hash VARCHAR;')
  //     await presenter.safeRun('CREATE INDEX IF NOT EXISTS idx_file_hash ON file (file_hash);')
  //   },
  //   down: async (presenter: DuckDBPresenter) => {
  //     await presenter.safeRun('ALTER TABLE file DROP COLUMN file_size;')
  //     await presenter.safeRun('ALTER TABLE file DROP COLUMN file_hash;')
  //   }
  // }
]

export class DuckDBPresenter implements IVectorDatabasePresenter {
  private dbInstance!: DuckDBInstance
  private connection!: DuckDBConnection

  private readonly dbPath: string

  private readonly vectorTable = 'vector'
  private readonly fileTable = 'file'
  private readonly chunkTable = 'chunk'
  private readonly metadataTable = 'metadata'

  constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  async initialize(dimensions: number, opts?: IndexOptions): Promise<void> {
    try {
      console.log(`[DuckDB] Initializing DuckDB database at ${this.dbPath}`)
      if (fs.existsSync(this.dbPath)) {
        console.error(`[DuckDB] Database ${this.dbPath} already exists`)
        throw new Error('Database already exists, cannot initialize again.')
      }
      console.log(`[DuckDB] connect to db`)
      await this.create()
      console.log(`[DuckDB] load vss extension`)
      await this.installAndLoadExtension('vss', async () => {
        await this.safeRun(`SET hnsw_enable_experimental_persistence = true;`)
      })
      console.log(`[DuckDB] create metadata table`)
      await this.initMetadataTable()
      console.log(`[DuckDB] create file table`)
      await this.initFileTable()
      console.log(`[DuckDB] create chunk table`)
      await this.initChunkTable()
      console.log(`[DuckDB] create vector table`)
      await this.initVectorTable(dimensions)
      console.log(`[DuckDB] create vector index`)
      await this.initTableIndex(opts)
      console.log(`[DuckDB] set initial database version`)
      await this.setDatabaseVersion(CURRENT_DB_VERSION)
    } catch (error) {
      console.error('[DuckDB] initialization failed:', error)
      this.close()
    }
  }

  async open(): Promise<void> {
    if (!fs.existsSync(this.dbPath)) {
      console.error(`[DuckDB] Database ${this.dbPath} does not exist`)
      throw new Error('Database does not exist, please initialize first.')
    }

    if (await this.hasWal()) {
      try {
        await this.repairIndex()
      } catch (error) {
        // TODO 数据库已无法修复，提示用户重建
        console.error('[DuckDB] Error opening database:', error)
        throw new Error('Failed to open database, please check the logs for details.')
      }
    }

    // 清理任何残留的事务队列
    if (this.transactionQueue.length > 0) {
      this.transactionQueue = []
    }

    console.log(`[DuckDB] connect to db`)
    await this.connect()
    console.log(`[DuckDB] load vss extension`)
    await this.installAndLoadExtension('vss', async () => {
      await this.safeRun(`SET hnsw_enable_experimental_persistence = true;`)
    })
    console.log(`[DuckDB] check and run database migrations`)
    await this.runMigrations()
    console.log(`[DuckDB] clear dirty data`)
    await this.clearDirtyData()
    console.log(`[DuckDB] paused all running tasks`)
    await this.pauseAllRunningTasks()
  }

  async close(): Promise<void> {
    try {
      // 等待当前事务处理完成
      if (this.isProcessingTransaction && this.currentTransactionPromise) {
        try {
          await this.currentTransactionPromise
        } catch (error) {
          console.warn('[DuckDB] Error waiting for transaction to complete during close:', error)
        }
      }

      // 清理任何剩余的事务队列
      if (this.transactionQueue.length > 0) {
        const remainingOperations = [...this.transactionQueue]
        this.transactionQueue = []
        const error = new Error('Database is closing, operations cancelled')
        for (const { reject } of remainingOperations) {
          reject(error)
        }
      }

      // CLOSE 时不需要显式执行 CHECKPOINT，因为 DuckDB 会自动处理 WAL 文件
      // await this.safeRun('CHECKPOINT;')

      if (this.connection) {
        this.connection.closeSync()
      }
      if (this.dbInstance) {
        this.dbInstance.closeSync()
      }
      console.log('[DuckDB] DuckDB connection closed')
    } catch (err) {
      console.error('[DuckDB] close error', err)
    }
  }

  async destroy(): Promise<void> {
    await this.close()
    // 删除数据库文件
    try {
      if (fs.existsSync(this.dbPath)) {
        fs.rmSync(this.dbPath, { recursive: true })
      }
      if (fs.existsSync(this.dbPath + '.wal')) {
        fs.rmSync(this.dbPath + '.wal', { recursive: true })
      }
      console.log(`[DuckDB] Database at ${this.dbPath} destroyed.`)
    } catch (err) {
      console.error(`[DuckDB] Error destroying database at ${this.dbPath}:`, err)
    }
  }

  // ==================== IVectorDatabasePresenter 接口实现 ====================

  async insertFile(file: KnowledgeFileMessage): Promise<void> {
    const sql = `
        INSERT INTO ${this.fileTable} (id, name, path, mime_type, status, uploaded_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?);
      `
    await this.executeInTransaction(async () => {
      await this.safeRun(sql, [
        file.id,
        file.name,
        file.path,
        file.mimeType,
        file.status,
        String(file.uploadedAt),
        JSON.stringify(file.metadata)
      ])
    })
  }

  async updateFile(file: KnowledgeFileMessage): Promise<void> {
    const sql = `
        UPDATE ${this.fileTable}
        SET name = ?, path = ?, mime_type = ?, status = ?, uploaded_at = ?, metadata = ?
        WHERE id = ?;
      `
    await this.executeInTransaction(async () => {
      await this.safeRun(sql, [
        file.name,
        file.path,
        file.mimeType,
        file.status,
        String(file.uploadedAt),
        JSON.stringify(file.metadata),
        file.id
      ])
    })
  }

  async queryFile(id: string): Promise<KnowledgeFileMessage | null> {
    const sql = `SELECT * FROM ${this.fileTable} WHERE id = ?;`
    try {
      const reader = await this.connection.runAndReadAll(sql, [id])
      const rows = reader.getRowObjectsJson()
      if (rows.length === 0) return null
      const row = rows[0]
      return this.toKnowledgeFileMessage(row)
    } catch (err) {
      console.error('[DuckDB] queryFile error', sql, id, err)
      throw err
    }
  }

  async queryFiles(where: Partial<KnowledgeFileMessage>): Promise<KnowledgeFileMessage[]> {
    const camelToSnake = (key: string) =>
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

    const entries = Object.entries(where).filter(([, value]) => value !== undefined)

    let sql = `SELECT * FROM ${this.fileTable}`
    const params: any[] = []

    if (entries.length > 0) {
      const conditions = entries.map(([key]) => `${camelToSnake(key)} = ?`).join(' AND ')
      sql += ` WHERE ${conditions}`
      params.push(...entries.map(([, value]) => value))
    }

    sql += ` ORDER BY uploaded_at DESC;`

    try {
      const reader = await this.connection.runAndReadAll(sql, params)
      const rows = reader.getRowObjectsJson()
      return rows.map((row) => this.toKnowledgeFileMessage(row))
    } catch (err) {
      console.error('[DuckDB] queryFiles error', sql, params, err)
      throw err
    }
  }

  async listFiles(): Promise<KnowledgeFileMessage[]> {
    const sql = `SELECT * FROM ${this.fileTable} ORDER BY uploaded_at DESC;`
    try {
      const reader = await this.connection.runAndReadAll(sql)
      const rows = reader.getRowObjectsJson()
      return rows.map((row) => this.toKnowledgeFileMessage(row))
    } catch (err) {
      console.error('[DuckDB] listFiles error', sql, err)
      throw err
    }
  }

  async deleteFile(id: string): Promise<void> {
    await this.executeInTransaction(async () => {
      await this.safeRun(`DELETE FROM ${this.chunkTable} WHERE file_id = ?;`, [id])
      await this.safeRun(`DELETE FROM ${this.vectorTable} WHERE file_id = ?;`, [id])
      await this.safeRun(`DELETE FROM ${this.fileTable} WHERE id = ?;`, [id])
    })
  }

  async insertChunks(chunks: KnowledgeChunkMessage[]): Promise<void> {
    if (!chunks.length) return
    const valuesSql = chunks.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')
    const sql = `INSERT INTO ${this.chunkTable} (id, file_id, chunk_index, content, status, error) VALUES ${valuesSql};`
    const params: any[] = []
    for (const chunk of chunks) {
      params.push(
        chunk.id,
        chunk.fileId,
        chunk.chunkIndex,
        chunk.content,
        chunk.status,
        chunk.error ?? ''
      )
    }
    await this.executeInTransaction(async () => {
      await this.safeRun(sql, params)
    })
  }

  async updateChunkStatus(
    chunkId: string,
    status: KnowledgeTaskStatus,
    error?: string
  ): Promise<void> {
    await this.executeInTransaction(async () => {
      await this.safeRun(`UPDATE ${this.chunkTable} SET status = ?, error = ? WHERE id = ?;`, [
        status,
        error ?? '',
        chunkId
      ])
    })
  }

  async queryChunks(where: Partial<KnowledgeChunkMessage>): Promise<KnowledgeChunkMessage[]> {
    const camelToSnake = (key: string) =>
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

    const entries = Object.entries(where).filter(([, value]) => value !== undefined)

    let sql = `SELECT * FROM ${this.chunkTable}`
    const params: any[] = []

    if (entries.length > 0) {
      const conditions = entries.map(([key]) => `${camelToSnake(key)} = ?`).join(' AND ')
      sql += ` WHERE ${conditions}`
      params.push(...entries.map(([, value]) => value))
    }

    try {
      const reader = await this.connection.runAndReadAll(sql, params)
      const rows = reader.getRowObjectsJson()
      return rows.map((row) => this.toKnowledgeChunkMessage(row))
    } catch (err) {
      console.error('[DuckDB] queryChunks error', sql, params, err)
      throw err
    }
  }

  async deleteChunksByFile(fileId: string): Promise<void> {
    await this.executeInTransaction(async () => {
      await this.safeRun(`DELETE FROM ${this.chunkTable} WHERE file_id = ?;`, [fileId])
    })
  }

  async insertVector(opts: VectorInsertOptions): Promise<void> {
    // 查询文件是否存在
    const file = await this.queryFile(opts.fileId)
    if (!file) {
      throw new Error(`File with ID ${opts.fileId} does not exist`)
    }
    const vec = arrayValue(Array.from(opts.vector))
    await this.executeInTransaction(async () => {
      await this.safeRun(
        `INSERT INTO ${this.vectorTable} (id, embedding, file_id, chunk_id)
         VALUES (?, ?::FLOAT[], ?, ?);`,
        [nanoid(), vec, opts.fileId, opts.chunkId]
      )
    })
  }

  async insertVectors(records: VectorInsertOptions[]): Promise<void> {
    if (!records.length) return
    // 构造批量插入 SQL
    const valuesSql = records.map(() => '(?, ?::FLOAT[], ?, ?)').join(', ')
    const sql = `INSERT INTO ${this.vectorTable} (id, embedding, file_id, chunk_id) VALUES ${valuesSql};`
    const params: any[] = []
    for (const r of records) {
      params.push(nanoid())
      params.push(arrayValue(Array.from(r.vector)))
      params.push(r.fileId)
      params.push(r.chunkId)
    }
    await this.executeInTransaction(async () => {
      await this.safeRun(sql, params)
    })
  }

  async similarityQuery(vector: number[], options: QueryOptions): Promise<QueryResult[]> {
    const k = options.topK
    const fn =
      options.metric === 'ip'
        ? 'array_negative_inner_product'
        : options.metric === 'cosine'
          ? 'array_cosine_distance'
          : 'array_distance'
    const sql = `
      SELECT t.id as id, ${fn}(embedding, ?) AS distance, t1.content as content, t2.name as name, t2.path as path
      FROM ${this.vectorTable} t
      LEFT JOIN ${this.chunkTable} t1 ON t1.id = t.chunk_id
      LEFT JOIN ${this.fileTable} t2 ON t2.id = t.file_id
      ORDER BY distance
      LIMIT ?;
    `
    const embParam = arrayValue(Array.from(vector))
    const paramsArr: any[] = [embParam]
    if (options.threshold != null) {
      paramsArr.push(options.threshold)
    }
    paramsArr.push(k)
    try {
      const reader = await this.connection.runAndReadAll(sql, paramsArr)
      const rows = reader.getRowObjectsJson()
      return rows.map((r: any) => ({
        id: r.id,
        distance: r.distance,
        metadata: {
          from: r.name,
          filePath: r.path,
          content: r.content
        }
      }))
    } catch (err) {
      console.error('[DuckDB] similarityQuery error', sql, paramsArr, err)
      throw err
    }
  }

  async deleteVectorsByFile(fileId: string): Promise<void> {
    await this.executeInTransaction(async () => {
      await this.safeRun(`DELETE FROM ${this.vectorTable} WHERE file_id = ?;`, [fileId])
    })
  }

  // ==================== 转换工具 ====================

  private toKnowledgeFileMessage(o: any): KnowledgeFileMessage {
    return {
      id: o.id,
      name: o.name,
      path: o.path,
      mimeType: o.mime_type,
      status: o.status,
      uploadedAt: Number(o.uploaded_at),
      metadata: typeof o.metadata === 'string' ? JSON.parse(o.metadata) : o.metadata
    }
  }

  private toKnowledgeChunkMessage(o: any): KnowledgeChunkMessage {
    return {
      id: o.id,
      fileId: o.file_id,
      chunkIndex: o.chunk_index,
      content: o.content,
      status: o.status,
      error: o.error
    }
  }

  // ==================== 事务管理 ====================
  private transactionQueue: Array<{
    operation: () => Promise<any>
    resolve: (value: any) => void
    reject: (error: any) => void
    timestamp: number // 添加时间戳用于超时检测
  }> = []

  private isProcessingTransaction = false
  private currentTransactionPromise: Promise<void> | null = null
  private readonly TRANSACTION_TIMEOUT = 30000 // 30秒超时

  /**
   * 将操作添加到事务队列中，确保所有数据库操作串行执行
   */
  private async executeInTransaction<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.transactionQueue.push({
        operation,
        resolve,
        reject,
        timestamp: Date.now()
      })

      // 如果当前没有正在处理事务，则开始处理队列
      if (!this.isProcessingTransaction) {
        this.processTransactionQueue()
      }
    })
  }

  /**
   * 处理事务队列，确保所有操作串行执行
   */
  private async processTransactionQueue(): Promise<void> {
    if (this.isProcessingTransaction || this.transactionQueue.length === 0) {
      return
    }

    this.isProcessingTransaction = true

    // 创建当前事务 Promise，供 close 方法等待
    this.currentTransactionPromise = (async () => {
      try {
        // 开始事务
        await this.safeRun('BEGIN TRANSACTION;')

        // 处理队列中的所有操作
        const operations = [...this.transactionQueue]
        this.transactionQueue = []

        // 检查是否有超时的操作
        const now = Date.now()
        const timeoutOps = operations.filter((op) => now - op.timestamp > this.TRANSACTION_TIMEOUT)

        if (timeoutOps.length > 0) {
          console.warn(`[DuckDB] Found ${timeoutOps.length} timeout operations, rejecting them`)
          const timeoutError = new Error('Transaction operation timeout')
          for (const { reject } of timeoutOps) {
            reject(timeoutError)
          }
        }

        // 只处理未超时的操作
        const validOperations = operations.filter(
          (op) => now - op.timestamp <= this.TRANSACTION_TIMEOUT
        )

        if (validOperations.length === 0) {
          return // 没有有效操作需要处理
        }

        const results: any[] = []
        let hasError = false
        let errorToThrow: any = null

        for (const { operation, resolve, reject } of validOperations) {
          try {
            const result = await operation()
            results.push({ success: true, result, resolve, reject })
          } catch (error) {
            results.push({ success: false, error, resolve, reject })
            hasError = true
            if (!errorToThrow) {
              errorToThrow = error
            }
          }
        }

        if (hasError) {
          // 如果有错误，回滚事务
          await this.safeRun('ROLLBACK;')

          // 拒绝所有操作
          for (const { success, error, reject } of results) {
            if (success) {
              reject(errorToThrow) // 即使成功的操作也要因为事务回滚而失败
            } else {
              reject(error)
            }
          }
        } else {
          // 如果没有错误，提交事务
          await this.safeRun('COMMIT;')

          // 解析所有操作
          for (const { result, resolve } of results) {
            resolve(result)
          }
        }
      } catch (error) {
        // 处理事务操作本身的错误
        console.error('[DuckDB] Transaction processing error:', error)

        try {
          await this.safeRun('ROLLBACK;')
        } catch (rollbackError) {
          console.error('[DuckDB] Rollback error:', rollbackError)
        }

        // 拒绝所有队列中的操作
        for (const { reject } of this.transactionQueue) {
          reject(error)
        }
        this.transactionQueue = []
      } finally {
        this.isProcessingTransaction = false
        this.currentTransactionPromise = null

        // 如果队列中还有新的操作，继续处理
        if (this.transactionQueue.length > 0) {
          // 使用 setImmediate 避免递归调用栈过深
          setImmediate(() => this.processTransactionQueue())
        }
      }
    })()

    await this.currentTransactionPromise
  }

  private async safeRun(sql: string, params?: any[]): Promise<any> {
    try {
      if (!this.connection) await this.create()
      if (params) {
        return await this.connection.run(sql, params)
      } else {
        return await this.connection.run(sql)
      }
    } catch (err) {
      console.error('[DuckDB] sql error', sql, params, err)
      throw err
    }
  }

  async pauseAllRunningTasks(): Promise<void> {
    // paused chunk
    await this.executeInTransaction(async () => {
      await this.safeRun(
        `UPDATE ${this.chunkTable} SET status = 'paused' WHERE status = 'processing';`
      )
    })
    // paused file
    await this.executeInTransaction(async () => {
      await this.safeRun(
        `UPDATE ${this.fileTable} SET status = 'paused' WHERE status = 'processing';`
      )
    })
  }

  async resumeAllPausedTasks(): Promise<void> {
    // resumed chunk
    await this.executeInTransaction(async () => {
      await this.safeRun(
        `UPDATE ${this.chunkTable} SET status = 'processing' WHERE status = 'paused';`
      )
    })
    // resumed file
    await this.executeInTransaction(async () => {
      await this.safeRun(
        `UPDATE ${this.fileTable} SET status = 'processing' WHERE status = 'paused';`
      )
    })
  }

  // ==================== 初始化相关 ====================

  private async create() {
    this.dbInstance = await DuckDBInstance.create(this.dbPath)
    this.connection = await this.dbInstance.connect()
    console.log(`[DuckDB] Connected to DuckDB at ${this.dbPath}`)
  }

  private async connect() {
    this.dbInstance = await DuckDBInstance.create(this.dbPath)
    this.connection = await this.dbInstance.connect()
    console.log(`[DuckDB] Connected to DuckDB at ${this.dbPath}`)
  }

  /**
   * 通过 memory 附加 DuckDB 数据库并修复索引问题
   *
   * - 正常关闭链接时会自动checkpoint，但异常关闭软件（崩溃， kill）无法触发
   * - 连接时如果存在wal文件会自动checkpoint，但由于使用了vss插件，自动checkpoint会失败导致无法连接
   * - 必须先通过内存安装并加载vss插件，附加到本地数据库，再执行checkpoint
   */
  private async repairIndex(): Promise<void> {
    const ins = await DuckDBInstance.create(':memory:')
    const conn = await ins.connect()

    // load vss
    const extensionPath = path.join(extensionDir, `vss${extensionSuffix}`)
    if (fs.existsSync(extensionPath)) {
      const escapedPath = extensionPath.replace(/\\/g, '\\\\')
      console.log(`[DuckDB] LOAD VSS extension from ${escapedPath}`)
      await conn.run(`LOAD '${escapedPath}';`)
    } else {
      console.log('[DuckDB] LOAD VSS extension online')
      await conn.run(`INSTALL vss;`)
      await conn.run(`LOAD vss;`)
    }
    await conn.run(`SET hnsw_enable_experimental_persistence = true;`)

    // attach to the existing database
    await conn.run(`ATTACH DATABASE '${this.dbPath}' AS db;`)
    // await conn.run(`CHECKPOINT;`)

    // close
    conn.closeSync()
    ins.closeSync()
  }

  /** 安装并加载 VSS 扩展 */
  private async installAndLoadExtension(
    name: string,
    afterRun?: () => Promise<void>
  ): Promise<void> {
    const extensionPath = path.join(extensionDir, `${name}${extensionSuffix}`)
    if (fs.existsSync(extensionPath)) {
      const escapedPath = extensionPath.replace(/\\/g, '\\\\')
      console.log(`[DuckDB] LOAD ${name} extension from ${escapedPath}`)
      await this.safeRun(`LOAD '${escapedPath}';`)
    } else {
      console.log(`[DuckDB] LOAD ${name} extension online`)
      await this.safeRun(`INSTALL ${name};`)
      await this.safeRun(`LOAD ${name};`)
    }
    if (afterRun instanceof Function) await afterRun()
  }

  /** 创建文件元数据表 */
  private async initFileTable(): Promise<void> {
    await this.safeRun(
      `CREATE TABLE IF NOT EXISTS ${this.fileTable} (
        id VARCHAR PRIMARY KEY,
        name VARCHAR,
        path VARCHAR,
        mime_type VARCHAR,
        status VARCHAR,
        uploaded_at BIGINT,
        metadata JSON
      );`
    )
  }

  /** 创建chunks表 */
  private async initChunkTable(): Promise<void> {
    await this.safeRun(
      `CREATE TABLE IF NOT EXISTS ${this.chunkTable} (
        id VARCHAR PRIMARY KEY,
        file_id VARCHAR,
        content TEXT,
        status VARCHAR,
        chunk_index INTEGER,
        error VARCHAR
      );`
    )
  }

  /** 创建定长向量表 */
  private async initVectorTable(dimensions: number): Promise<void> {
    await this.safeRun(
      `CREATE TABLE IF NOT EXISTS ${this.vectorTable} (
         id VARCHAR PRIMARY KEY,
         embedding FLOAT[${dimensions}],
         file_id VARCHAR,
         chunk_id VARCHAR
       );`
    )
  }

  /** 创建索引 */
  private async initTableIndex(opts?: IndexOptions): Promise<void> {
    // file
    await this.safeRun(
      `CREATE INDEX IF NOT EXISTS idx_${this.fileTable}_file_id ON ${this.fileTable} (id);`
    )
    await this.safeRun(
      `CREATE INDEX IF NOT EXISTS idx_${this.fileTable}_file_status ON ${this.fileTable} (status);`
    )
    await this.safeRun(
      `CREATE INDEX IF NOT EXISTS idx_${this.fileTable}_file_path ON ${this.fileTable} (path);`
    )
    // chunk
    await this.safeRun(
      `CREATE INDEX IF NOT EXISTS idx_${this.chunkTable}_chunk_id ON ${this.chunkTable} (id);`
    )
    await this.safeRun(
      `CREATE INDEX IF NOT EXISTS idx_${this.chunkTable}_file_id ON ${this.chunkTable} (file_id);`
    )
    await this.safeRun(
      `CREATE INDEX IF NOT EXISTS idx_${this.chunkTable}_status ON ${this.chunkTable} (status);`
    )
    // vector
    const metric = opts?.metric || 'cosine' // 支持 'l2sq' | 'cosine' | 'ip'
    const M = opts?.M || 16
    const efConstruction = opts?.efConstruction || 200
    const sql = `CREATE INDEX IF NOT EXISTS idx_${this.vectorTable}_emb
     ON ${this.vectorTable}
     USING HNSW (embedding)
     WITH (
       metric='${metric}',
       M=${M},
       ef_construction=${efConstruction}
     );`
    await this.safeRun(sql)
    await this.safeRun(
      `CREATE INDEX IF NOT EXISTS idx_${this.vectorTable}_file_id ON ${this.vectorTable} (file_id);`
    )
    await this.safeRun(
      `CREATE INDEX IF NOT EXISTS idx_${this.vectorTable}_chunk_id ON ${this.vectorTable} (chunk_id);`
    )
  }

  /**
   * 清理异常任务引入的脏数据
   */
  private async clearDirtyData(): Promise<void> {
    // 清理向量表中没有对应文件的向量
    await this.safeRun(`
      DELETE FROM ${this.vectorTable}
      WHERE file_id NOT IN (SELECT id FROM ${this.fileTable});
    `)

    // 清理chunks表中没有对应文件的分块
    await this.safeRun(`
      DELETE FROM ${this.chunkTable}
      WHERE file_id NOT IN (SELECT id FROM ${this.fileTable});
    `)
  }

  /**
   * 检查是否存在 WAL 文件
   * @returns 是否存在 WAL 文件
   */
  private async hasWal(): Promise<boolean> {
    const walPath = this.dbPath + '.wal'
    return fs.existsSync(walPath)
  }

  // ==================== 数据库版本控制和迁移 ====================

  /**
   * 初始化元数据表
   */
  private async initMetadataTable(): Promise<void> {
    await this.safeRun(
      `CREATE TABLE IF NOT EXISTS ${this.metadataTable} (
        key VARCHAR PRIMARY KEY,
        value VARCHAR
      );`
    )
  }

  /**
   * 运行数据库迁移
   */
  private async runMigrations(): Promise<void> {
    // 确保元数据表存在
    await this.initMetadataTable()

    const currentVersion = await this.getDatabaseVersion()
    console.log(`[DuckDB] Current database version: ${currentVersion}`)
    console.log(`[DuckDB] Target database version: ${CURRENT_DB_VERSION}`)

    if (currentVersion === CURRENT_DB_VERSION) {
      console.log('[DuckDB] Database is up to date, no migrations needed')
      return
    }

    if (currentVersion > CURRENT_DB_VERSION) {
      console.warn(
        `[DuckDB] Database version (${currentVersion}) is newer than supported version (${CURRENT_DB_VERSION})`
      )
      return
    }

    // 执行从当前版本到目标版本的所有迁移
    const migrationsToRun = MIGRATIONS.filter(
      (m) => m.version > currentVersion && m.version <= CURRENT_DB_VERSION
    )

    if (migrationsToRun.length === 0) {
      console.log('[DuckDB] No migrations found to run')
      return
    }

    console.log(`[DuckDB] Running ${migrationsToRun.length} migrations...`)

    // 按版本号排序执行迁移
    migrationsToRun.sort((a, b) => a.version - b.version)

    for (const migration of migrationsToRun) {
      console.log(`[DuckDB] Running migration v${migration.version}: ${migration.description}`)

      try {
        await this.executeInTransaction(async () => {
          await migration.up(this)
        })
        await this.setDatabaseVersion(migration.version)

        console.log(`[DuckDB] Migration v${migration.version} completed successfully`)
      } catch (error) {
        console.error(`[DuckDB] Migration v${migration.version} failed:`, error)
        throw new Error(`Database migration v${migration.version} failed: ${error}`)
      }
    }

    console.log(
      `[DuckDB] All migrations completed successfully. Database updated to version ${CURRENT_DB_VERSION}`
    )
  }

  /**
   * 获取数据库元数据信息
   */
  async getDatabaseMetadata(): Promise<Record<string, any>> {
    try {
      const sql = `SELECT key, value FROM ${this.metadataTable};`
      const reader = await this.connection.runAndReadAll(sql)
      const rows = reader.getRowObjectsJson()

      const metadata: Record<string, any> = {}
      for (const row of rows) {
        const key = typeof row.key === 'string' ? row.key : String(row.key)
        metadata[key] = row.value
      }
      return metadata
    } catch (error) {
      console.error('[DuckDB] Error getting database metadata:', error)
      return {}
    }
  }

  /**
   * 设置数据库元数据
   */
  async setDatabaseMetadata(key: string, value: string): Promise<void> {
    const sql = `
      INSERT OR REPLACE INTO ${this.metadataTable} (key, value)
      VALUES (?, ?);
    `
    await this.executeInTransaction(async () => {
      await this.safeRun(sql, [key, value])
    })
  }
  /**
   * 获取数据库版本
   */
  private async getDatabaseVersion(): Promise<number> {
    try {
      const metadata = await this.getDatabaseMetadata()
      const version = metadata[DB_VERSION_KEY]
      return version ? parseInt(typeof version === 'string' ? version : String(version), 10) : 0
    } catch (error) {
      // 如果元数据表不存在，说明是旧版本数据库
      console.warn('[DuckDB] Cannot get database version, assuming version 0:', error)
      return 0
    }
  }

  /**
   * 设置数据库版本
   */
  private async setDatabaseVersion(version: number): Promise<void> {
    await this.setDatabaseMetadata(DB_VERSION_KEY, String(version))
  }
}
