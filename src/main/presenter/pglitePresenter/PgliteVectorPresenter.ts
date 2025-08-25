import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import fs from 'fs'
import { nanoid } from 'nanoid'
import {
  IVectorDatabasePresenter,
  VectorInsertOptions,
  QueryOptions,
  QueryResult,
  IndexOptions,
  KnowledgeFileMessage,
  KnowledgeChunkMessage,
  KnowledgeTaskStatus
} from '@shared/presenter'

export class PgliteVectorPresenter implements IVectorDatabasePresenter {
  private pgLite!: PGlite
  private dbPath: string
  private isConnected: boolean = false

  // 表名常量
  private readonly vectorTable = 'vector'
  private readonly fileTable = 'file'
  private readonly chunkTable = 'chunk'
  private readonly metadataTable = 'metadata'

  constructor(dbPath: string) {
    this.dbPath = dbPath
    // 注意：数据库初始化和连接在initialize()和open()方法中进行
    // 不在构造函数中直接初始化，以遵循原有的DuckDBPresenter模式
    if (!fs.existsSync(this.dbPath)) {
      fs.mkdirSync(this.dbPath, { recursive: true })
    }
  }

  async initialize(dimensions: number, opts?: IndexOptions): Promise<void> {
    try {
      console.log(`[PGLite] Initializing PGLite database at ${this.dbPath}`)

      if (fs.existsSync(this.dbPath)) {
        console.error(`[PGLite] Database ${this.dbPath} already exists`)
        throw new Error('Database already exists, cannot initialize again.')
      }

      console.log(`[PGLite] Creating database connection`)
      await this.create()

      console.log(`[PGLite] Creating metadata table`)
      await this.initMetadataTable()

      console.log(`[PGLite] Creating file table`)
      await this.initFileTable()

      console.log(`[PGLite] Creating chunk table`)
      await this.initChunkTable()

      console.log(`[PGLite] Creating vector table`)
      await this.initVectorTable(dimensions)

      console.log(`[PGLite] Creating vector index`)
      await this.initTableIndex(opts)

      console.log(`[PGLite] Setting initial database version`)
      await this.setDatabaseVersion(1)

      console.log(`[PGLite] Database initialization completed`)
    } catch (error) {
      console.error('[PGLite] initialization failed:', error)
      await this.close()
      throw error
    }
  }

  async open(): Promise<void> {
    if (!fs.existsSync(this.dbPath)) {
      console.error(`[PGLite] Database ${this.dbPath} does not exist`)
      throw new Error('Database does not exist, please initialize first.')
    }

    console.log(`[PGLite] Connecting to database`)
    await this.connect()

    console.log(`[PGLite] Running database migrations`)
    await this.runMigrations()

    console.log(`[PGLite] Clearing dirty data`)
    await this.clearDirtyData()

    console.log(`[PGLite] Pausing all running tasks`)
    await this.pauseAllRunningTasks()
  }

  async close(): Promise<void> {
    try {
      if (this.pgLite && this.isConnected) {
        await this.pgLite.close()
        this.isConnected = false
        console.log('[PGLite] Database connection closed')
      }
    } catch (err) {
      console.error('[PGLite] close error', err)
    }
  }

  async destroy(): Promise<void> {
    await this.close()
    // 删除数据库文件
    try {
      if (fs.existsSync(this.dbPath)) {
        fs.rmSync(this.dbPath, { recursive: true })
      }
      console.log(`[PGLite] Database at ${this.dbPath} destroyed.`)
    } catch (err) {
      console.error(`[PGLite] Error destroying database at ${this.dbPath}:`, err)
    }
  }

  // ==================== IVectorDatabasePresenter 接口实现 ====================

  /**
   * 获取数据库中向量的维度
   */
  private async getVectorDimensions(): Promise<number> {
    try {
      const result = await this.pgLite.query(`
        SELECT atttypmod 
        FROM pg_attribute 
        WHERE attrelid = '${this.vectorTable}'::regclass 
        AND attname = 'embedding'
      `)

      if (result.rows.length > 0) {
        // atttypmod 对 vector 类型返回维度+4
        return (result.rows[0] as any).atttypmod - 4
      }

      // 如果无法获取，返回默认维度
      return 1536
    } catch (error) {
      console.warn('[PGLite] Unable to get vector dimensions, using default 1536:', error)
      return 1536
    }
  }

  async insertFile(file: KnowledgeFileMessage): Promise<void> {
    const sql = `
      INSERT INTO ${this.fileTable} (id, name, path, mime_type, status, uploaded_at, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `

    await this.pgLite.query(sql, [
      file.id,
      file.name,
      file.path,
      file.mimeType,
      file.status,
      file.uploadedAt.toString(),
      JSON.stringify(file.metadata)
    ])
  }

  async updateFile(file: KnowledgeFileMessage): Promise<void> {
    const sql = `
      UPDATE ${this.fileTable}
      SET name = $1, path = $2, mime_type = $3, status = $4, uploaded_at = $5, metadata = $6
      WHERE id = $7
    `

    await this.pgLite.query(sql, [
      file.name,
      file.path,
      file.mimeType,
      file.status,
      file.uploadedAt.toString(),
      JSON.stringify(file.metadata),
      file.id
    ])
  }

  async queryFile(id: string): Promise<KnowledgeFileMessage | null> {
    const sql = `SELECT * FROM ${this.fileTable} WHERE id = $1`

    try {
      const result = await this.pgLite.query(sql, [id])
      if (result.rows.length === 0) return null

      const row = result.rows[0]
      return this.toKnowledgeFileMessage(row)
    } catch (err) {
      console.error('[PGLite] queryFile error', sql, id, err)
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
      const conditions = entries
        .map(([key], index) => `${camelToSnake(key)} = $${index + 1}`)
        .join(' AND ')
      sql += ` WHERE ${conditions}`
      params.push(...entries.map(([, value]) => value))
    }

    sql += ` ORDER BY uploaded_at DESC`

    try {
      const result = await this.pgLite.query(sql, params)
      return result.rows.map((row) => this.toKnowledgeFileMessage(row))
    } catch (err) {
      console.error('[PGLite] queryFiles error', sql, params, err)
      throw err
    }
  }

  async listFiles(): Promise<KnowledgeFileMessage[]> {
    const sql = `SELECT * FROM ${this.fileTable} ORDER BY uploaded_at DESC`

    try {
      const result = await this.pgLite.query(sql)
      return result.rows.map((row) => this.toKnowledgeFileMessage(row))
    } catch (err) {
      console.error('[PGLite] listFiles error', sql, err)
      throw err
    }
  }

  async deleteFile(id: string): Promise<void> {
    await this.pgLite.transaction(async () => {
      await this.pgLite.query(`DELETE FROM ${this.chunkTable} WHERE file_id = $1`, [id])
      await this.pgLite.query(`DELETE FROM ${this.vectorTable} WHERE file_id = $1`, [id])
      await this.pgLite.query(`DELETE FROM ${this.fileTable} WHERE id = $1`, [id])
    })
  }

  async insertChunks(chunks: KnowledgeChunkMessage[]): Promise<void> {
    if (!chunks.length) return

    const values = chunks
      .map((_, index) => {
        const offset = index * 6
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`
      })
      .join(', ')

    const sql = `INSERT INTO ${this.chunkTable} (id, file_id, chunk_index, content, status, error) VALUES ${values}`
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

    await this.pgLite.query(sql, params)
  }

  async updateChunkStatus(
    chunkId: string,
    status: KnowledgeTaskStatus,
    error?: string
  ): Promise<void> {
    await this.pgLite.query(`UPDATE ${this.chunkTable} SET status = $1, error = $2 WHERE id = $3`, [
      status,
      error ?? '',
      chunkId
    ])
  }

  async queryChunks(where: Partial<KnowledgeChunkMessage>): Promise<KnowledgeChunkMessage[]> {
    const camelToSnake = (key: string) =>
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

    const entries = Object.entries(where).filter(([, value]) => value !== undefined)

    let sql = `SELECT * FROM ${this.chunkTable}`
    const params: any[] = []

    if (entries.length > 0) {
      const conditions = entries
        .map(([key], index) => `${camelToSnake(key)} = $${index + 1}`)
        .join(' AND ')
      sql += ` WHERE ${conditions}`
      params.push(...entries.map(([, value]) => value))
    }

    try {
      const result = await this.pgLite.query(sql, params)
      return result.rows.map((row) => this.toKnowledgeChunkMessage(row))
    } catch (err) {
      console.error('[PGLite] queryChunks error', sql, params, err)
      throw err
    }
  }

  async deleteChunksByFile(fileId: string): Promise<void> {
    await this.pgLite.query(`DELETE FROM ${this.chunkTable} WHERE file_id = $1`, [fileId])
  }

  async insertVector(opts: VectorInsertOptions): Promise<void> {
    // 检查文件是否存在
    const file = await this.queryFile(opts.fileId)
    if (!file) {
      throw new Error(`File with ID ${opts.fileId} does not exist`)
    }

    // 验证向量维度
    const expectedDimensions = await this.getVectorDimensions()
    if (opts.vector.length !== expectedDimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${expectedDimensions}, got ${opts.vector.length}`
      )
    }

    // 转换为 PostgreSQL vector 格式
    const vectorString = `[${opts.vector.join(',')}]`

    await this.pgLite.query(
      `
      INSERT INTO ${this.vectorTable} (id, embedding, file_id, chunk_id)
      VALUES ($1, $2, $3, $4)
    `,
      [nanoid(), vectorString, opts.fileId, opts.chunkId]
    )
  }

  async insertVectors(records: VectorInsertOptions[]): Promise<void> {
    if (!records.length) return

    // 验证向量维度
    const expectedDimensions = await this.getVectorDimensions()
    for (const record of records) {
      if (record.vector.length !== expectedDimensions) {
        throw new Error(
          `Vector dimension mismatch: expected ${expectedDimensions}, got ${record.vector.length}`
        )
      }
    }

    // 批量插入优化
    const values = records
      .map((_, index) => {
        const offset = index * 4
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`
      })
      .join(', ')

    const sql = `INSERT INTO ${this.vectorTable} (id, embedding, file_id, chunk_id) VALUES ${values}`
    const params: any[] = []

    for (const record of records) {
      const vectorString = `[${record.vector.join(',')}]`
      params.push(nanoid(), vectorString, record.fileId, record.chunkId)
    }

    await this.pgLite.query(sql, params)
  }

  async similarityQuery(vector: number[], options: QueryOptions): Promise<QueryResult[]> {
    const k = options.topK
    const vectorString = `[${vector.join(',')}]`

    // 设置查询参数
    if (options.efSearch) {
      await this.pgLite.exec(`SET hnsw.ef_search = ${options.efSearch}`)
    }

    // 选择距离操作符
    let distanceOp = '<=>' // 默认余弦距离
    switch (options.metric) {
      case 'l2':
        distanceOp = '<->'
        break
      case 'ip':
        distanceOp = '<#>'
        break
      case 'cosine':
      default:
        distanceOp = '<=>'
        break
    }

    const sql = `
      SELECT 
        t.id as id,
        t.embedding ${distanceOp} $1 as distance,
        t1.content as content,
        t2.name as name,
        t2.path as path
      FROM ${this.vectorTable} t
      LEFT JOIN ${this.chunkTable} t1 ON t1.id = t.chunk_id
      LEFT JOIN ${this.fileTable} t2 ON t2.id = t.file_id
      ORDER BY t.embedding ${distanceOp} $1
      LIMIT $2
    `

    try {
      const result = await this.pgLite.query(sql, [vectorString, k])

      return result.rows.map((row: any) => ({
        id: row.id,
        distance: row.distance,
        metadata: {
          from: row.name,
          filePath: row.path,
          content: row.content
        }
      }))
    } catch (err) {
      console.error('[PGLite] similarityQuery error', sql, err)
      throw err
    }
  }

  async deleteVectorsByFile(fileId: string): Promise<void> {
    await this.pgLite.query(`DELETE FROM ${this.vectorTable} WHERE file_id = $1`, [fileId])
  }

  // ==================== 转换工具 ====================

  private toKnowledgeFileMessage(row: any): KnowledgeFileMessage {
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      mimeType: row.mime_type,
      status: row.status,
      uploadedAt: Number(row.uploaded_at),
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
    }
  }

  private toKnowledgeChunkMessage(row: any): KnowledgeChunkMessage {
    return {
      id: row.id,
      fileId: row.file_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      status: row.status,
      error: row.error
    }
  }

  // ==================== 暂停和恢复任务 ====================

  async pauseAllRunningTasks(): Promise<void> {
    // 暂停chunk处理任务
    await this.pgLite.query(
      `UPDATE ${this.chunkTable} SET status = 'paused' WHERE status = 'processing'`
    )

    // 暂停文件处理任务
    await this.pgLite.query(
      `UPDATE ${this.fileTable} SET status = 'paused' WHERE status = 'processing'`
    )
  }

  async resumeAllPausedTasks(): Promise<void> {
    // 恢复chunk处理任务
    await this.pgLite.query(
      `UPDATE ${this.chunkTable} SET status = 'processing' WHERE status = 'paused'`
    )

    // 恢复文件处理任务
    await this.pgLite.query(
      `UPDATE ${this.fileTable} SET status = 'processing' WHERE status = 'paused'`
    )
  }

  // ==================== 初始化相关 ====================

  private async create(): Promise<void> {
    this.pgLite = new PGlite(this.dbPath, {
      extensions: { vector }
    })
    this.isConnected = true

    // 启用 vector 扩展，如果失败则抛出错误
    await this.pgLite.exec('CREATE EXTENSION IF NOT EXISTS vector')
    console.log(`[PGLite] Vector extension enabled`)
    console.log(`[PGLite] Connected to PGLite at ${this.dbPath}`)
  }

  private async connect(): Promise<void> {
    this.pgLite = new PGlite(this.dbPath, {
      extensions: { vector }
    })
    this.isConnected = true
    await this.pgLite.exec('CREATE EXTENSION IF NOT EXISTS vector')
    console.log(`[PGLite] Connected to PGLite at ${this.dbPath}`)
  }

  /** 创建元数据表 */
  private async initMetadataTable(): Promise<void> {
    await this.pgLite.exec(`
      CREATE TABLE IF NOT EXISTS ${this.metadataTable} (
        key VARCHAR PRIMARY KEY,
        value VARCHAR
      )
    `)
  }

  /** 创建文件元数据表 */
  private async initFileTable(): Promise<void> {
    await this.pgLite.exec(`
      CREATE TABLE IF NOT EXISTS ${this.fileTable} (
        id VARCHAR PRIMARY KEY,
        name VARCHAR,
        path VARCHAR,
        mime_type VARCHAR,
        status VARCHAR,
        uploaded_at BIGINT,
        metadata JSONB
      )
    `)
  }

  /** 创建chunks表 */
  private async initChunkTable(): Promise<void> {
    await this.pgLite.exec(`
      CREATE TABLE IF NOT EXISTS ${this.chunkTable} (
        id VARCHAR PRIMARY KEY,
        file_id VARCHAR,
        content TEXT,
        status VARCHAR,
        chunk_index INTEGER,
        error VARCHAR
      )
    `)
  }

  /** 创建定长向量表 */
  private async initVectorTable(dimensions: number): Promise<void> {
    // 使用原生 vector 类型存储向量数据
    await this.pgLite.exec(`
      CREATE TABLE IF NOT EXISTS ${this.vectorTable} (
        id VARCHAR PRIMARY KEY,
        embedding vector(${dimensions}),
        file_id VARCHAR,
        chunk_id VARCHAR
      )
    `)
    console.log(`[PGLite] Created vector table with native vector(${dimensions}) type`)
  }

  /** 创建索引 */
  private async initTableIndex(opts?: IndexOptions): Promise<void> {
    // file表索引
    await this.pgLite.exec(`
      CREATE INDEX IF NOT EXISTS idx_${this.fileTable}_id ON ${this.fileTable} (id)
    `)
    await this.pgLite.exec(`
      CREATE INDEX IF NOT EXISTS idx_${this.fileTable}_status ON ${this.fileTable} (status)
    `)
    await this.pgLite.exec(`
      CREATE INDEX IF NOT EXISTS idx_${this.fileTable}_path ON ${this.fileTable} (path)
    `)

    // chunk表索引
    await this.pgLite.exec(`
      CREATE INDEX IF NOT EXISTS idx_${this.chunkTable}_id ON ${this.chunkTable} (id)
    `)
    await this.pgLite.exec(`
      CREATE INDEX IF NOT EXISTS idx_${this.chunkTable}_file_id ON ${this.chunkTable} (file_id)
    `)
    await this.pgLite.exec(`
      CREATE INDEX IF NOT EXISTS idx_${this.chunkTable}_status ON ${this.chunkTable} (status)
    `)

    // vector表基础索引
    await this.pgLite.exec(`
      CREATE INDEX IF NOT EXISTS idx_${this.vectorTable}_file_id ON ${this.vectorTable} (file_id)
    `)
    await this.pgLite.exec(`
      CREATE INDEX IF NOT EXISTS idx_${this.vectorTable}_chunk_id ON ${this.vectorTable} (chunk_id)
    `)

    // 向量相似度索引 - 使用 HNSW 索引
    const metric = opts?.metric || 'cosine'

    let opsClass = 'vector_cosine_ops'
    switch (metric) {
      case 'l2':
        opsClass = 'vector_l2_ops'
        break
      case 'ip':
        opsClass = 'vector_ip_ops'
        break
      case 'cosine':
      default:
        opsClass = 'vector_cosine_ops'
        break
    }

    const m = opts?.M || 16
    const efConstruction = opts?.efConstruction || 64

    await this.pgLite.exec(`
      CREATE INDEX IF NOT EXISTS idx_${this.vectorTable}_embedding_hnsw
      ON ${this.vectorTable} 
      USING hnsw (embedding ${opsClass})
      WITH (m = ${m}, ef_construction = ${efConstruction})
    `)
    console.log('[PGLite] HNSW vector similarity index created successfully')
  }

  /**
   * 清理异常任务引入的脏数据
   */
  private async clearDirtyData(): Promise<void> {
    // 清理向量表中没有对应文件的向量
    await this.pgLite.exec(`
      DELETE FROM ${this.vectorTable}
      WHERE file_id NOT IN (SELECT id FROM ${this.fileTable})
    `)

    // 清理chunks表中没有对应文件的分块
    await this.pgLite.exec(`
      DELETE FROM ${this.chunkTable}
      WHERE file_id NOT IN (SELECT id FROM ${this.fileTable})
    `)
  }

  // ==================== 数据库版本控制和迁移 ====================

  /**
   * 运行数据库迁移
   */
  private async runMigrations(): Promise<void> {
    // 确保元数据表存在
    await this.initMetadataTable()

    const currentVersion = await this.getDatabaseVersion()
    console.log(`[PGLite] Current database version: ${currentVersion}`)
    console.log(`[PGLite] Target database version: 1`)

    if (currentVersion === 1) {
      console.log('[PGLite] Database is up to date, no migrations needed')
      return
    }

    if (currentVersion > 1) {
      console.warn(
        `[PGLite] Database version (${currentVersion}) is newer than supported version (1)`
      )
      return
    }

    // 执行基础迁移（如果需要）
    console.log('[PGLite] No additional migrations needed for version 1')
  }

  /**
   * 获取数据库元数据信息
   */
  async getDatabaseMetadata(): Promise<Record<string, any>> {
    try {
      const sql = `SELECT key, value FROM ${this.metadataTable}`
      const result = await this.pgLite.query(sql)

      const metadata: Record<string, any> = {}
      for (const row of result.rows) {
        const key =
          typeof (row as any).key === 'string' ? (row as any).key : String((row as any).key)
        metadata[key] = (row as any).value
      }
      return metadata
    } catch (error) {
      console.error('[PGLite] Error getting database metadata:', error)
      return {}
    }
  }

  /**
   * 设置数据库元数据
   */
  async setDatabaseMetadata(key: string, value: string): Promise<void> {
    const sql = `
      INSERT INTO ${this.metadataTable} (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `
    await this.pgLite.query(sql, [key, value])
  }

  /**
   * 获取数据库版本
   */
  private async getDatabaseVersion(): Promise<number> {
    try {
      const metadata = await this.getDatabaseMetadata()
      const version = metadata['db_version']
      return version ? parseInt(typeof version === 'string' ? version : String(version), 10) : 0
    } catch (error) {
      // 如果元数据表不存在，说明是新数据库
      console.warn('[PGLite] Cannot get database version, assuming version 0:', error)
      return 0
    }
  }

  /**
   * 设置数据库版本
   */
  private async setDatabaseVersion(version: number): Promise<void> {
    await this.setDatabaseMetadata('db_version', String(version))
  }
}
