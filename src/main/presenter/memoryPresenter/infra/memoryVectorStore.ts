import logger from '@shared/logger'
import fs from 'node:fs'
import path from 'node:path'

import { DuckDBConnection, DuckDBInstance, arrayValue } from '@duckdb/node-api'

import type { MemoryPerfObserver } from '../ports'
import { V1_PRESERVE_IDLE_TIMEOUT_MS } from '../runtimeConstants'
import type {
  IMemoryVectorStore,
  MemoryVectorMatch,
  MemoryVectorQueryOptions,
  MemoryVectorRecord
} from '../types'
import { LegacyV1Reader, MigrationAbandonFence } from './legacyV1Reader'
import { LegacyVssUnavailableError } from './legacyVssLoader'
import {
  assertMemoryVectorDimensions,
  createMemoryVectorStoreV2FormatPlan,
  MEMORY_VECTOR_STORE_FORMAT_VERSION,
  MEMORY_VECTOR_STORE_TABLES,
  readSafeMemoryVectorRowCount
} from './memoryVectorStoreFormat'
import {
  isDuckDbFatalError,
  MemoryVectorStorePostCommitError,
  MemoryVectorStoreQuarantineRequiredError,
  MemoryVectorStoreTerminalRecoveryError
} from './vectorStoreErrors'

const QUARANTINE_FILE_SUFFIX = '.v2.duckdb.quarantine'

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

interface V2FormatValidation {
  valid: boolean
  meta: EmbeddingMeta | null
}

interface PublishFreshV2Options {
  fence?: MigrationAbandonFence
  preserveOnFailure?: boolean
  populate?: (staging: MemoryVectorStore) => Promise<number>
  beforeCommit?: () => void
}

type LegacyPreserveOutcome =
  | { status: 'succeeded'; store: MemoryVectorStore }
  | { status: 'failed'; error: unknown }
  | { status: 'timed-out' }

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

function terminalRecoveryError(
  operation: string,
  cause: unknown,
  recoveryCause?: unknown
): MemoryVectorStoreTerminalRecoveryError {
  return new MemoryVectorStoreTerminalRecoveryError(
    `[MemoryVectorStore] ${operation}: ${String(cause)}`,
    {
      cause,
      fatal: isDuckDbFatalError(cause),
      recoveryCause
    }
  )
}

function removeRecoveryFiles(filePaths: readonly string[], operation: string): void {
  try {
    removeFiles(filePaths)
  } catch (error) {
    throw terminalRecoveryError(operation, error)
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

function legacyIdentityMatches(
  identity: Awaited<ReturnType<LegacyV1Reader['readEmbeddingIdentity']>>,
  dimensions: number,
  embedding: EmbeddingIdentity
): boolean {
  return (
    identity?.providerId === embedding.providerId &&
    identity.modelId === embedding.modelId &&
    identity.dimensions === dimensions
  )
}

// DuckDB-backed memory vector store, isolated per agent and linked to SQLite by memory_id.
export class MemoryVectorStore implements IMemoryVectorStore {
  private dbInstance!: DuckDBInstance
  private connection!: DuckDBConnection
  private connectionOpen = false
  private instanceOpen = false
  private readonly vectorTable = MEMORY_VECTOR_STORE_TABLES.vector
  private readonly metaTable = MEMORY_VECTOR_STORE_TABLES.meta
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
    assertMemoryVectorDimensions(dimensions)
    fs.mkdirSync(path.dirname(paths.current), { recursive: true })
    let recoveryFilesRemoved = false

    if (fs.existsSync(paths.quarantine)) {
      removeRecoveryFiles(
        [
          ...filesWithWal(paths.current),
          ...filesWithWal(paths.staging),
          ...filesWithWal(paths.legacy)
        ],
        'quarantine recovery file sweep failed'
      )
      removeRecoveryFiles([paths.quarantine], 'quarantine marker removal failed')
      recoveryFilesRemoved = true
    }

    if (fs.existsSync(paths.staging) || fs.existsSync(`${paths.staging}.wal`)) {
      removeRecoveryFiles(filesWithWal(paths.staging), 'staging recovery cleanup failed')
      recoveryFilesRemoved = true
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

    if (fs.existsSync(`${paths.legacy}.wal`)) {
      removeRecoveryFiles(filesWithWal(paths.legacy), 'legacy WAL recovery cleanup failed')
      return MemoryVectorStore.publishRecoveryV2(
        paths,
        dimensions,
        embedding,
        metric,
        perfObserver,
        'fresh publication after legacy WAL recovery failed'
      )
    }

    if (fs.existsSync(paths.legacy)) {
      return MemoryVectorStore.migrateLegacyV1(paths, dimensions, embedding, metric, perfObserver)
    }

    if (fs.existsSync(`${paths.current}.wal`)) {
      removeRecoveryFiles([`${paths.current}.wal`], 'orphan current WAL cleanup failed')
      recoveryFilesRemoved = true
    }

    if (recoveryFilesRemoved) {
      return MemoryVectorStore.publishRecoveryV2(
        paths,
        dimensions,
        embedding,
        metric,
        perfObserver,
        'fresh publication after recovery cleanup failed'
      )
    }
    return MemoryVectorStore.publishFreshV2(paths, dimensions, embedding, metric, perfObserver)
  }

  static recoverQuarantinedStores(memoryDbDir: string): void {
    if (!fs.existsSync(memoryDbDir)) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(memoryDbDir, { withFileTypes: true })
    } catch (error) {
      logger.error(`[MemoryVectorStore] startup quarantine scan failed: ${String(error)}`)
      return
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(QUARANTINE_FILE_SUFFIX)) continue
      const agentId = entry.name.slice(0, -QUARANTINE_FILE_SUFFIX.length)
      if (!agentId) continue
      const paths = createMemoryVectorStorePaths(memoryDbDir, agentId)
      if (path.basename(paths.quarantine) !== entry.name) continue
      try {
        MemoryVectorStore.destroyFiles(paths, { includeQuarantine: false })
        removeFiles([paths.quarantine])
      } catch (error) {
        logger.error(
          `[MemoryVectorStore] startup quarantine sweep deferred for ${agentId}: ${String(error)}`
        )
      }
    }
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
      if (isDuckDbFatalError(error)) {
        throw terminalRecoveryError('fatal current v2 open failed', error)
      }
      try {
        store.closeStrict()
      } catch (closeError) {
        throw terminalRecoveryError('current v2 open cleanup failed', error, closeError)
      }
      throw terminalRecoveryError('current v2 open failed', error)
    }
  }

  private static async migrateLegacyV1(
    paths: MemoryVectorStorePaths,
    dimensions: number,
    embedding: EmbeddingIdentity,
    metric: 'cosine' | 'l2sq' | 'ip',
    perfObserver?: MemoryPerfObserver
  ): Promise<MemoryVectorStore> {
    const fence = new MigrationAbandonFence()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let resolveTimeout!: (outcome: LegacyPreserveOutcome) => void
    const timeout = new Promise<LegacyPreserveOutcome>((resolve) => {
      resolveTimeout = resolve
    })
    const armIdleDeadline = (): void => {
      if (fence.isCommitted() || fence.isAbandoned()) return
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        if (fence.isCommitted()) return
        fence.abandon()
        resolveTimeout({ status: 'timed-out' })
      }, V1_PRESERVE_IDLE_TIMEOUT_MS)
      if (typeof timeoutId.unref === 'function') timeoutId.unref()
    }
    fence.onProgress(armIdleDeadline)
    armIdleDeadline()
    const preserve = MemoryVectorStore.preserveLegacyV1(
      paths,
      dimensions,
      embedding,
      metric,
      perfObserver,
      fence
    )
    const guarded: Promise<LegacyPreserveOutcome> = preserve.then(
      (store): LegacyPreserveOutcome => ({ status: 'succeeded', store }),
      (error): LegacyPreserveOutcome => ({ status: 'failed', error })
    )

    const outcome = await Promise.race([guarded, timeout])
    if (timeoutId) clearTimeout(timeoutId)
    if (outcome.status === 'succeeded') return outcome.store
    if (outcome.status === 'failed') {
      if (outcome.error instanceof MemoryVectorStorePostCommitError) throw outcome.error
      fence.abandon()
      throw new MemoryVectorStoreQuarantineRequiredError(
        `[MemoryVectorStore] legacy v1 preserve failed: ${String(outcome.error)}`,
        { cause: outcome.error }
      )
    }

    void guarded.then((lateOutcome) => {
      logger.warn(
        `[MemoryVectorStore] abandoned legacy v1 preserve settled late with status=${lateOutcome.status}; no migration side effects resumed`
      )
    })
    throw new MemoryVectorStoreQuarantineRequiredError(
      `[MemoryVectorStore] legacy v1 preserve made no progress for ${V1_PRESERVE_IDLE_TIMEOUT_MS}ms`
    )
  }

  private static async preserveLegacyV1(
    paths: MemoryVectorStorePaths,
    dimensions: number,
    embedding: EmbeddingIdentity,
    metric: 'cosine' | 'l2sq' | 'ip',
    perfObserver: MemoryPerfObserver | undefined,
    fence: MigrationAbandonFence
  ): Promise<MemoryVectorStore> {
    let reader: LegacyV1Reader
    try {
      reader = await LegacyV1Reader.open(paths.legacy, dimensions, fence)
    } catch (error) {
      if (!(error instanceof LegacyVssUnavailableError)) throw error
      fence.assertActive()
      logger.warn(
        `[MemoryVectorStore] legacy v1 preserve unavailable; rebuilding from SQLite: ${String(error)}`
      )
      removeFiles(filesWithWal(paths.legacy))
      fence.assertActive()
      return MemoryVectorStore.publishFreshV2(paths, dimensions, embedding, metric, perfObserver, {
        fence
      })
    }
    fence.assertActive()
    const legacyIdentity = await reader.readEmbeddingIdentity(fence)
    fence.assertActive()
    if (!legacyIdentityMatches(legacyIdentity, dimensions, embedding)) {
      logger.info(
        '[MemoryVectorStore] legacy v1 embedding identity is missing, invalid, or stale; rebuilding from SQLite'
      )
      reader.closeBeforeFileMutation(fence)
      fence.assertActive()
      removeFiles(filesWithWal(paths.legacy))
      fence.assertActive()
      return MemoryVectorStore.publishFreshV2(paths, dimensions, embedding, metric, perfObserver, {
        fence
      })
    }
    const sourceRowCount = await reader.countRows(fence)
    fence.assertActive()
    const store = await MemoryVectorStore.publishFreshV2(
      paths,
      dimensions,
      embedding,
      metric,
      perfObserver,
      {
        fence,
        preserveOnFailure: true,
        populate: async (staging) => {
          let copied = 0
          let afterId: string | null = null
          await staging.beginMigration(fence)
          while (copied < sourceRowCount) {
            const page = await reader.readPage(afterId, fence)
            fence.assertActive()
            if (!page.length || copied + page.length > sourceRowCount) break
            await staging.insertMigrationPage(page, fence)
            copied += page.length
            afterId = page[page.length - 1].memoryId
          }
          if (copied !== sourceRowCount) {
            throw new Error(
              `[MemoryVectorStore] legacy v1 row count changed during preserve: expected ${sourceRowCount}, copied ${copied}`
            )
          }
          await staging.commitMigration(fence)
          return sourceRowCount
        },
        beforeCommit: () => reader.closeBeforeFileMutation(fence)
      }
    )
    sweepLegacyBestEffort(paths)
    return store
  }

  private static async publishFreshV2(
    paths: MemoryVectorStorePaths,
    dimensions: number,
    embedding: EmbeddingIdentity,
    metric: 'cosine' | 'l2sq' | 'ip',
    perfObserver?: MemoryPerfObserver,
    options: PublishFreshV2Options = {}
  ): Promise<MemoryVectorStore> {
    options.fence?.assertActive()
    removeRecoveryFiles(filesWithWal(paths.staging), 'staged publish cleanup failed')
    let committed = false
    const staging = new MemoryVectorStore(paths.staging, metric, perfObserver)
    try {
      await staging.initialize(dimensions, embedding, options.fence)
      options.fence?.assertActive()
      const expectedRowCount = options.populate ? await options.populate(staging) : 0
      options.fence?.assertActive()
      if (!(await staging.matchesExpectedFormat(dimensions, embedding, options.fence))) {
        throw new Error('[MemoryVectorStore] staged v2 verification failed')
      }
      options.fence?.assertActive()
      const actualRowCount = await staging.countRows(options.fence)
      options.fence?.assertActive()
      if (actualRowCount !== expectedRowCount) {
        throw new Error(
          `[MemoryVectorStore] staged v2 row count mismatch: expected ${expectedRowCount}, found ${actualRowCount}`
        )
      }
      await staging.connection.run('CHECKPOINT;')
      options.fence?.markProgress()
      staging.closeStrict(options.fence)
      options.beforeCommit?.()
      options.fence?.assertActive()
      if (fs.existsSync(`${paths.staging}.wal`)) {
        throw new Error('[MemoryVectorStore] staged v2 WAL remains after checkpoint and close')
      }
      options.fence?.assertActive()
      if (fs.existsSync(paths.current)) {
        throw terminalRecoveryError(
          'refusing to publish over an existing current v2 store',
          new Error(`current store already exists at ${paths.current}`)
        )
      }
      removeRecoveryFiles(
        [`${paths.current}.wal`],
        'orphan current WAL cleanup before publish failed'
      )
      options.fence?.assertActive()
      fs.renameSync(paths.staging, paths.current)
      committed = true
      options.fence?.markCommitted()
      const current = await MemoryVectorStore.openCurrent(
        paths.current,
        dimensions,
        embedding,
        metric,
        perfObserver
      )
      if (!current.isUsable()) {
        current.closeStrict()
        throw new Error('[MemoryVectorStore] published v2 store failed its post-open self-check')
      }
      return current
    } catch (error) {
      if (committed) throw new MemoryVectorStorePostCommitError(error)
      if (options.preserveOnFailure) throw error
      if (isDuckDbFatalError(error)) {
        if (error instanceof MemoryVectorStoreTerminalRecoveryError) throw error
        throw terminalRecoveryError('fatal fresh v2 publication failure', error)
      }
      try {
        staging.closeStrict()
      } catch (closeError) {
        throw terminalRecoveryError(
          'fresh v2 close after publication failure failed',
          error,
          closeError
        )
      }
      try {
        removeFiles(filesWithWal(paths.staging))
      } catch (cleanupError) {
        throw terminalRecoveryError(
          'fresh v2 staging cleanup after publication failure failed',
          error,
          cleanupError
        )
      }
      throw error
    }
  }

  private static async publishRecoveryV2(
    paths: MemoryVectorStorePaths,
    dimensions: number,
    embedding: EmbeddingIdentity,
    metric: 'cosine' | 'l2sq' | 'ip',
    perfObserver: MemoryPerfObserver | undefined,
    operation: string
  ): Promise<MemoryVectorStore> {
    try {
      return await MemoryVectorStore.publishFreshV2(
        paths,
        dimensions,
        embedding,
        metric,
        perfObserver
      )
    } catch (error) {
      if (error instanceof MemoryVectorStoreQuarantineRequiredError) throw error
      throw terminalRecoveryError(operation, error)
    }
  }

  isUsable(): boolean {
    return this.usable
  }

  private async connect(fence?: MigrationAbandonFence): Promise<void> {
    fence?.assertActive()
    this.dbInstance = await DuckDBInstance.create(this.dbPath)
    this.instanceOpen = true
    fence?.markProgress()
    this.connection = await this.dbInstance.connect()
    this.connectionOpen = true
    fence?.markProgress()
  }

  private async initialize(
    dimensions: number,
    embedding: EmbeddingIdentity,
    fence?: MigrationAbandonFence
  ): Promise<void> {
    logger.info(`[MemoryVectorStore] initializing v2 at ${this.dbPath} (dim=${dimensions})`)
    await this.connect(fence)
    const plan = createMemoryVectorStoreV2FormatPlan(dimensions, embedding)
    await this.connection.run(plan.createVectorTableSql)
    fence?.markProgress()
    await this.connection.run(plan.createMetaTableSql)
    fence?.markProgress()
    await this.connection.run(plan.insertMetaSql, plan.metaParams)
    fence?.markProgress()
  }

  private async open(expectedDim: number, embedding: EmbeddingIdentity): Promise<void> {
    await this.connect()
    const validation = await this.validateExpectedFormat(expectedDim, embedding)
    if (validation.valid) return
    this.usable = false
    if (!validation.meta) {
      logger.warn(
        `[MemoryVectorStore] invalid or missing v2 metadata at ${this.dbPath}; vector recall disabled until reindex (FTS still active).`
      )
      return
    }
    logger.warn(
      `[MemoryVectorStore] v2 identity mismatch at ${this.dbPath}: stored format=${validation.meta.formatVersion} ${validation.meta.provider}/${validation.meta.model}/${validation.meta.dim}, requested format=${MEMORY_VECTOR_STORE_FORMAT_VERSION} ${embedding.providerId}/${embedding.modelId}/${expectedDim}. Vector recall disabled until reindex (FTS still active).`
    )
  }

  private async matchesExpectedFormat(
    expectedDim: number,
    embedding: EmbeddingIdentity,
    fence?: MigrationAbandonFence
  ): Promise<boolean> {
    return (await this.validateExpectedFormat(expectedDim, embedding, fence)).valid
  }

  private async validateExpectedFormat(
    expectedDim: number,
    embedding: EmbeddingIdentity,
    fence?: MigrationAbandonFence
  ): Promise<V2FormatValidation> {
    const meta = await this.readEmbeddingMeta(expectedDim, fence)
    const valid =
      meta?.formatVersion === MEMORY_VECTOR_STORE_FORMAT_VERSION &&
      meta.provider === embedding.providerId &&
      meta.model === embedding.modelId &&
      meta.dim === expectedDim
    return { valid, meta }
  }

  private async readEmbeddingMeta(
    expectedDim: number,
    fence?: MigrationAbandonFence
  ): Promise<EmbeddingMeta | null> {
    fence?.assertActive()
    const columnsReader = await this.connection.runAndReadAll(
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'main' AND table_name IN (?, ?)
       ORDER BY table_name, ordinal_position;`,
      [this.vectorTable, this.metaTable]
    )
    fence?.markProgress()
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
    fence?.markProgress()
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
    return this.upsertRecords(records)
  }

  private async beginMigration(fence: MigrationAbandonFence): Promise<void> {
    fence.assertActive()
    await this.connection.run('BEGIN TRANSACTION;')
    fence.markProgress()
  }

  private async insertMigrationPage(
    records: MemoryVectorRecord[],
    fence: MigrationAbandonFence
  ): Promise<void> {
    if (!records.length) return
    fence.assertActive()
    const insertPlaceholders = records.map(() => '(?, ?::FLOAT[])').join(', ')
    const insertParams = records.flatMap((record) => [
      record.memoryId,
      arrayValue(record.embedding)
    ])
    this.perfObserver?.increment('duckDbStatements')
    await this.connection.run(
      `INSERT INTO ${this.vectorTable} (memory_id, embedding) VALUES ${insertPlaceholders};`,
      insertParams
    )
    fence.markProgress()
  }

  private async commitMigration(fence: MigrationAbandonFence): Promise<void> {
    fence.assertActive()
    await this.connection.run('COMMIT;')
    fence.markProgress()
  }

  private async upsertRecords(
    records: MemoryVectorRecord[],
    fence?: MigrationAbandonFence
  ): Promise<void> {
    if (!records.length) return
    fence?.assertActive()
    await this.connection.run('BEGIN TRANSACTION;')
    fence?.assertActive()
    try {
      const deletePlaceholders = records.map(() => '?').join(', ')
      this.perfObserver?.increment('duckDbStatements')
      await this.connection.run(
        `DELETE FROM ${this.vectorTable} WHERE memory_id IN (${deletePlaceholders});`,
        records.map((record) => record.memoryId)
      )
      fence?.assertActive()
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
      fence?.assertActive()
      await this.connection.run('COMMIT;')
      fence?.assertActive()
    } catch (error) {
      if (fence) throw error
      if (isDuckDbFatalError(error)) {
        this.usable = false
        throw error
      }
      await this.connection.run('ROLLBACK;').catch(() => undefined)
      throw error
    }
  }

  private async countRows(fence?: MigrationAbandonFence): Promise<number> {
    fence?.assertActive()
    const reader = await this.connection.runAndReadAll(
      `SELECT count(*) AS row_count FROM ${this.vectorTable};`
    )
    fence?.markProgress()
    return readSafeMemoryVectorRowCount(reader.getRowObjectsJson(), 'v2')
  }

  async query(
    embedding: number[],
    options: MemoryVectorQueryOptions
  ): Promise<MemoryVectorMatch[]> {
    try {
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
    } catch (error) {
      if (isDuckDbFatalError(error)) this.usable = false
      throw error
    }
  }

  async queryByMemoryId(
    memoryId: string,
    options: MemoryVectorQueryOptions
  ): Promise<MemoryVectorMatch[]> {
    try {
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
    } catch (error) {
      if (isDuckDbFatalError(error)) this.usable = false
      throw error
    }
  }

  async deleteByMemoryIds(memoryIds: string[]): Promise<void> {
    if (!memoryIds.length) return
    try {
      const placeholders = memoryIds.map(() => '?').join(', ')
      this.perfObserver?.increment('duckDbStatements')
      await this.connection.run(
        `DELETE FROM ${this.vectorTable} WHERE memory_id IN (${placeholders});`,
        memoryIds
      )
    } catch (error) {
      if (isDuckDbFatalError(error)) this.usable = false
      throw error
    }
  }

  async listMemoryIds(afterId: string | null, limit: number): Promise<string[]> {
    const cappedLimit = Math.max(0, Math.floor(limit))
    if (cappedLimit === 0) return []
    try {
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
    } catch (error) {
      if (isDuckDbFatalError(error)) this.usable = false
      throw error
    }
  }

  private closeStrict(fence?: MigrationAbandonFence): void {
    if (fence) {
      if (this.connectionOpen) {
        fence.assertActive()
        this.connection.closeSync()
        this.connectionOpen = false
      }
      if (this.instanceOpen) {
        fence.assertActive()
        this.dbInstance.closeSync()
        this.instanceOpen = false
      }
      return
    }

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
