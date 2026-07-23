import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'

import type Database from 'better-sqlite3-multiple-ciphers'

import { openSQLiteDatabase } from '@/data/databaseConnection'
import type {
  LightOcrBackendPreference,
  LightOcrEngineStatus,
  LightOcrRecognitionStrategy
} from './lightOcrProtocol'
import { isLightOcrEngineStatus } from './lightOcrProtocol'
import type { OcrCacheKeyProvider } from './ocrCacheKeyProvider'

const DEFAULT_MAX_CACHE_BYTES = 256 * 1024 * 1024
const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1_000
const DEFAULT_LEASE_MS = 60_000
const OCR_ARTIFACT_COLUMNS = [
  'cache_key',
  'source_sha256',
  'light_ocr_version',
  'bundle_id',
  'preprocessing_revision',
  'strategy',
  'requested_backend',
  'detection_provider_chain_json',
  'detection_precision',
  'recognition_provider_chain_json',
  'recognition_precision',
  'qualification_metadata_json',
  'text',
  'token_count',
  'truncated',
  'mime_type',
  'image_width',
  'image_height',
  'engine_json',
  'logical_bytes',
  'created_at',
  'last_accessed_at',
  'expires_at',
  'lease_until'
] as const

export interface OcrArtifactLookup {
  sourceSha256: string
  lightOcrVersion: string
  bundleId: string
  preprocessingRevision: string
  strategy: LightOcrRecognitionStrategy
  requestedBackend: LightOcrBackendPreference
}

export interface OcrArtifactIdentity extends OcrArtifactLookup {
  detectionProviderChain: string[]
  detectionPrecision: string
  recognitionProviderChain: string[]
  recognitionPrecision: string
}

export interface OcrArtifactValue {
  text: string
  tokenCount: number
  truncated: boolean
  mimeType: string
  imageWidth: number
  imageHeight: number
  engine: LightOcrEngineStatus
}

export interface OcrArtifact extends OcrArtifactValue {
  cacheKey: string
}

export interface OcrArtifactStoreStats {
  mode: 'memory' | 'persistent'
  persistenceUnavailableReason?: 'database_error' | 'safe_storage_unavailable'
  entryCount: number
  logicalBytes: number
  maxBytes: number
}

export interface OcrArtifactStorePort {
  find(identity: OcrArtifactIdentity): Promise<OcrArtifact | null>
  put(identity: OcrArtifactIdentity, value: OcrArtifactValue): Promise<OcrArtifact>
  clear(): Promise<void>
  runMaintenance(): Promise<void>
  getStats(): Promise<OcrArtifactStoreStats>
  close(): Promise<void>
}

export interface OcrArtifactStoreOptions {
  dbPath: string
  keyProvider: OcrCacheKeyProvider
  maxBytes?: number
  ttlMs?: number
  leaseMs?: number
  now?: () => number
}

interface OcrArtifactBackend {
  readonly mode: OcrArtifactStoreStats['mode']
  readonly persistenceUnavailableReason?: OcrArtifactStoreStats['persistenceUnavailableReason']
  find(identity: OcrArtifactIdentity): OcrArtifact | null
  put(identity: OcrArtifactIdentity, value: OcrArtifactValue): OcrArtifact
  clear(): void
  runMaintenance(): void
  getStats(): OcrArtifactStoreStats
  close(): void
}

interface StoredArtifactRow {
  cache_key: string
  text: string
  token_count: number
  truncated: number
  mime_type: string
  image_width: number
  image_height: number
  engine_json: string
}

export class OcrArtifactStore implements OcrArtifactStorePort {
  private backendPromise: Promise<OcrArtifactBackend> | null = null
  private closed = false

  constructor(private readonly options: OcrArtifactStoreOptions) {
    assertPositiveFinite(options.maxBytes ?? DEFAULT_MAX_CACHE_BYTES, 'maxBytes')
    assertPositiveFinite(options.ttlMs ?? DEFAULT_TTL_MS, 'ttlMs')
    assertPositiveFinite(options.leaseMs ?? DEFAULT_LEASE_MS, 'leaseMs')
  }

  async find(identity: OcrArtifactIdentity): Promise<OcrArtifact | null> {
    return (await this.getBackend()).find(identity)
  }

  async put(identity: OcrArtifactIdentity, value: OcrArtifactValue): Promise<OcrArtifact> {
    return (await this.getBackend()).put(identity, value)
  }

  async clear(): Promise<void> {
    const backend = await this.getBackend()
    backend.clear()
  }

  async runMaintenance(): Promise<void> {
    const backend = await this.getBackend()
    backend.runMaintenance()
  }

  async getStats(): Promise<OcrArtifactStoreStats> {
    return (await this.getBackend()).getStats()
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const backend = await this.backendPromise?.catch(() => null)
    backend?.close()
  }

  private async getBackend(): Promise<OcrArtifactBackend> {
    if (this.closed) throw new Error('OCR artifact store is closed')
    this.backendPromise ??= this.createBackend()
    return this.backendPromise
  }

  private async createBackend(): Promise<OcrArtifactBackend> {
    const common = {
      maxBytes: this.options.maxBytes ?? DEFAULT_MAX_CACHE_BYTES,
      ttlMs: this.options.ttlMs ?? DEFAULT_TTL_MS,
      leaseMs: this.options.leaseMs ?? DEFAULT_LEASE_MS,
      now: this.options.now ?? Date.now
    }
    const key = await this.options.keyProvider.loadOrCreateKey().catch(() => null)
    if (!key) {
      return new MemoryOcrArtifactBackend({
        ...common,
        persistenceUnavailableReason: 'safe_storage_unavailable'
      })
    }

    try {
      return await openPersistentBackend(this.options.dbPath, key, common)
    } catch {
      return new MemoryOcrArtifactBackend({
        ...common,
        persistenceUnavailableReason: 'database_error'
      })
    } finally {
      key.fill(0)
    }
  }
}

export function computeOcrArtifactCacheKey(identity: OcrArtifactIdentity): string {
  const serialized = JSON.stringify([
    identity.sourceSha256,
    identity.lightOcrVersion,
    identity.bundleId,
    identity.preprocessingRevision,
    identity.strategy,
    identity.requestedBackend,
    identity.detectionProviderChain,
    identity.detectionPrecision,
    identity.recognitionProviderChain,
    identity.recognitionPrecision
  ])
  return createHash('sha256').update(serialized).digest('hex')
}

async function openPersistentBackend(
  dbPath: string,
  key: Buffer,
  options: BackendOptions
): Promise<SqliteOcrArtifactBackend> {
  const password = key.toString('base64')
  try {
    return createSqliteBackend(dbPath, password, options)
  } catch (error) {
    if (!shouldRebuildOcrCache(error)) throw error
    await removeDatabaseFiles(dbPath)
    return createSqliteBackend(dbPath, password, options)
  }
}

function createSqliteBackend(
  dbPath: string,
  password: string,
  options: BackendOptions
): SqliteOcrArtifactBackend {
  const db = openSQLiteDatabase(dbPath, password)
  try {
    return new SqliteOcrArtifactBackend(db, options)
  } catch (error) {
    try {
      db.close()
    } catch {
      // Preserve the initialization error used to decide whether the derived cache is rebuildable.
    }
    throw error
  }
}

function shouldRebuildOcrCache(error: unknown): boolean {
  if (error instanceof OcrArtifactDatabaseError) return error.code === 'schema_mismatch'
  const sqliteCode = (error as { code?: unknown })?.code
  if (
    sqliteCode === 'SQLITE_CORRUPT' ||
    sqliteCode === 'SQLITE_NOTADB' ||
    sqliteCode === 'SQLITE_SCHEMA'
  ) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /file is not a database|database disk image is malformed/i.test(message)
}

async function removeDatabaseFiles(dbPath: string): Promise<void> {
  await Promise.all(
    [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].map((filePath) =>
      rm(filePath, { force: true }).catch(() => undefined)
    )
  )
}

interface BackendOptions {
  maxBytes: number
  ttlMs: number
  leaseMs: number
  now: () => number
  persistenceUnavailableReason?: OcrArtifactStoreStats['persistenceUnavailableReason']
}

class SqliteOcrArtifactBackend implements OcrArtifactBackend {
  readonly mode = 'persistent' as const
  private closed = false

  constructor(
    private readonly db: Database.Database,
    private readonly options: BackendOptions
  ) {
    this.initialize()
  }

  find(identity: OcrArtifactIdentity): OcrArtifact | null {
    this.assertOpen()
    const now = this.options.now()
    const cacheKey = computeOcrArtifactCacheKey(identity)
    const row = this.db
      .prepare(
        `SELECT cache_key, text, token_count, truncated, mime_type, image_width, image_height,
                engine_json
           FROM ocr_artifacts
          WHERE cache_key = ?
            AND expires_at > ?
          LIMIT 1`
      )
      .get(cacheKey, now) as StoredArtifactRow | undefined
    if (!row) return null

    const artifact = parseStoredArtifact(row)
    if (!artifact) {
      this.db.prepare('DELETE FROM ocr_artifacts WHERE cache_key = ?').run(row.cache_key)
      return null
    }
    this.db
      .prepare(
        `UPDATE ocr_artifacts
            SET last_accessed_at = ?, expires_at = ?, lease_until = ?
          WHERE cache_key = ?`
      )
      .run(now, now + this.options.ttlMs, now + this.options.leaseMs, row.cache_key)
    return artifact
  }

  put(identity: OcrArtifactIdentity, value: OcrArtifactValue): OcrArtifact {
    this.assertOpen()
    const now = this.options.now()
    const cacheKey = computeOcrArtifactCacheKey(identity)
    const engineJson = JSON.stringify(value.engine)
    const qualificationMetadata = JSON.stringify({
      detection: value.engine.detection.qualificationId,
      recognition: value.engine.recognition.qualificationId
    })
    const logicalBytes = calculateArtifactBytes(identity, value, engineJson, qualificationMetadata)
    this.db
      .prepare(
        `INSERT INTO ocr_artifacts (
           cache_key, source_sha256, light_ocr_version, bundle_id, preprocessing_revision,
           strategy, requested_backend, detection_provider_chain_json, detection_precision,
           recognition_provider_chain_json, recognition_precision, qualification_metadata_json,
           text, token_count, truncated, mime_type, image_width, image_height, engine_json,
           logical_bytes, created_at, last_accessed_at, expires_at, lease_until
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         )
         ON CONFLICT(cache_key) DO UPDATE SET
           qualification_metadata_json = excluded.qualification_metadata_json,
           text = excluded.text,
           token_count = excluded.token_count,
           truncated = excluded.truncated,
           mime_type = excluded.mime_type,
           image_width = excluded.image_width,
           image_height = excluded.image_height,
           engine_json = excluded.engine_json,
           logical_bytes = excluded.logical_bytes,
           last_accessed_at = excluded.last_accessed_at,
           expires_at = excluded.expires_at,
           lease_until = excluded.lease_until`
      )
      .run(
        cacheKey,
        ...lookupParameters(identity),
        JSON.stringify(identity.detectionProviderChain),
        identity.detectionPrecision,
        JSON.stringify(identity.recognitionProviderChain),
        identity.recognitionPrecision,
        qualificationMetadata,
        value.text,
        value.tokenCount,
        value.truncated ? 1 : 0,
        value.mimeType,
        value.imageWidth,
        value.imageHeight,
        engineJson,
        logicalBytes,
        now,
        now,
        now + this.options.ttlMs,
        now + this.options.leaseMs
      )
    this.runMaintenance()
    return { cacheKey, ...value }
  }

  clear(): void {
    this.assertOpen()
    this.db.exec('DELETE FROM ocr_artifacts')
    this.db.pragma('wal_checkpoint(TRUNCATE)')
    this.db.exec('VACUUM')
  }

  runMaintenance(): void {
    this.assertOpen()
    const now = this.options.now()
    let removedArtifacts = this.db
      .prepare('DELETE FROM ocr_artifacts WHERE expires_at <= ? AND lease_until <= ?')
      .run(now, now).changes

    let logicalBytes = this.readLogicalBytes()
    if (logicalBytes > this.options.maxBytes) {
      const candidates = this.db
        .prepare(
          `SELECT cache_key, logical_bytes
           FROM ocr_artifacts
          WHERE lease_until <= ?
          ORDER BY last_accessed_at ASC, created_at ASC`
        )
        .all(now) as Array<{ cache_key: string; logical_bytes: number }>
      const remove = this.db.prepare('DELETE FROM ocr_artifacts WHERE cache_key = ?')
      const evict = this.db.transaction(() => {
        for (const candidate of candidates) {
          if (logicalBytes <= this.options.maxBytes) break
          removedArtifacts += remove.run(candidate.cache_key).changes
          logicalBytes -= candidate.logical_bytes
        }
      })
      evict()
    }
    if (removedArtifacts > 0) this.db.pragma('incremental_vacuum')
  }

  getStats(): OcrArtifactStoreStats {
    this.assertOpen()
    this.runMaintenance()
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS count, COALESCE(SUM(logical_bytes), 0) AS bytes FROM ocr_artifacts'
      )
      .get() as { count: number; bytes: number }
    return {
      mode: this.mode,
      entryCount: row.count,
      logicalBytes: row.bytes,
      maxBytes: this.options.maxBytes
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  private initialize(): void {
    const schemaVersion = this.db.pragma('user_version', { simple: true }) as number
    if (schemaVersion !== 0 && schemaVersion !== 1) {
      throw new OcrArtifactDatabaseError('schema_mismatch', 'Unsupported OCR cache schema')
    }
    if (schemaVersion === 0) this.db.pragma('auto_vacuum = INCREMENTAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ocr_artifacts (
        cache_key TEXT PRIMARY KEY,
        source_sha256 TEXT NOT NULL,
        light_ocr_version TEXT NOT NULL,
        bundle_id TEXT NOT NULL,
        preprocessing_revision TEXT NOT NULL,
        strategy TEXT NOT NULL,
        requested_backend TEXT NOT NULL,
        detection_provider_chain_json TEXT NOT NULL,
        detection_precision TEXT NOT NULL,
        recognition_provider_chain_json TEXT NOT NULL,
        recognition_precision TEXT NOT NULL,
        qualification_metadata_json TEXT NOT NULL,
        text TEXT NOT NULL,
        token_count INTEGER NOT NULL,
        truncated INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        image_width INTEGER NOT NULL,
        image_height INTEGER NOT NULL,
        engine_json TEXT NOT NULL,
        logical_bytes INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        lease_until INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ocr_artifacts_lookup
        ON ocr_artifacts (
          source_sha256, light_ocr_version, bundle_id, preprocessing_revision, strategy,
          requested_backend, last_accessed_at DESC
        );
      CREATE INDEX IF NOT EXISTS idx_ocr_artifacts_gc
        ON ocr_artifacts (last_accessed_at ASC, lease_until, expires_at);
    `)
    const columns = this.db.pragma('table_info(ocr_artifacts)') as Array<{ name: string }>
    const columnNames = new Set(columns.map((column) => column.name))
    if (!OCR_ARTIFACT_COLUMNS.every((column) => columnNames.has(column))) {
      throw new OcrArtifactDatabaseError('schema_mismatch', 'OCR cache schema is incomplete')
    }
    if (schemaVersion === 0) this.db.pragma('user_version = 1')
    this.db.prepare('SELECT COUNT(*) AS count FROM ocr_artifacts').get()
    this.runMaintenance()
  }

  private readLogicalBytes(): number {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(logical_bytes), 0) AS bytes FROM ocr_artifacts')
      .get() as { bytes: number }
    return row.bytes
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('OCR artifact database is closed')
  }
}

interface MemoryArtifactRecord {
  artifact: OcrArtifact
  logicalBytes: number
  createdAt: number
  lastAccessedAt: number
  expiresAt: number
  leaseUntil: number
}

class MemoryOcrArtifactBackend implements OcrArtifactBackend {
  readonly mode = 'memory' as const
  readonly persistenceUnavailableReason: OcrArtifactStoreStats['persistenceUnavailableReason']
  private readonly records = new Map<string, MemoryArtifactRecord>()

  constructor(private readonly options: BackendOptions) {
    this.persistenceUnavailableReason = options.persistenceUnavailableReason
  }

  find(identity: OcrArtifactIdentity): OcrArtifact | null {
    const now = this.options.now()
    const match = this.records.get(computeOcrArtifactCacheKey(identity)) ?? null
    if (match && match.expiresAt <= now) return null
    if (!match) return null
    match.lastAccessedAt = now
    match.expiresAt = now + this.options.ttlMs
    match.leaseUntil = now + this.options.leaseMs
    return cloneArtifact(match.artifact)
  }

  put(identity: OcrArtifactIdentity, value: OcrArtifactValue): OcrArtifact {
    const now = this.options.now()
    const cacheKey = computeOcrArtifactCacheKey(identity)
    const artifact = { cacheKey, ...cloneArtifactValue(value) }
    this.records.set(cacheKey, {
      artifact,
      logicalBytes: calculateArtifactBytes(
        identity,
        value,
        JSON.stringify(value.engine),
        JSON.stringify({
          detection: value.engine.detection.qualificationId,
          recognition: value.engine.recognition.qualificationId
        })
      ),
      createdAt: now,
      lastAccessedAt: now,
      expiresAt: now + this.options.ttlMs,
      leaseUntil: now + this.options.leaseMs
    })
    this.runMaintenance()
    return cloneArtifact(artifact)
  }

  clear(): void {
    this.records.clear()
  }

  runMaintenance(): void {
    const now = this.options.now()
    for (const [key, record] of this.records) {
      if (record.expiresAt <= now && record.leaseUntil <= now) this.records.delete(key)
    }

    let logicalBytes = this.logicalBytes()
    const candidates = [...this.records.entries()]
      .filter(([, record]) => record.leaseUntil <= now)
      .sort(
        ([, left], [, right]) =>
          left.lastAccessedAt - right.lastAccessedAt || left.createdAt - right.createdAt
      )
    for (const [key, record] of candidates) {
      if (logicalBytes <= this.options.maxBytes) break
      this.records.delete(key)
      logicalBytes -= record.logicalBytes
    }
  }

  getStats(): OcrArtifactStoreStats {
    this.runMaintenance()
    return {
      mode: this.mode,
      persistenceUnavailableReason: this.persistenceUnavailableReason,
      entryCount: this.records.size,
      logicalBytes: this.logicalBytes(),
      maxBytes: this.options.maxBytes
    }
  }

  close(): void {
    this.records.clear()
  }

  private logicalBytes(): number {
    let bytes = 0
    for (const record of this.records.values()) bytes += record.logicalBytes
    return bytes
  }
}

function lookupParameters(
  lookup: OcrArtifactLookup
): [string, string, string, string, string, string] {
  return [
    lookup.sourceSha256,
    lookup.lightOcrVersion,
    lookup.bundleId,
    lookup.preprocessingRevision,
    lookup.strategy,
    lookup.requestedBackend
  ]
}

function parseStoredArtifact(row: StoredArtifactRow): OcrArtifact | null {
  try {
    const engine = JSON.parse(row.engine_json) as unknown
    if (!isLightOcrEngineStatus(engine)) return null
    if (
      typeof row.text !== 'string' ||
      !Number.isInteger(row.token_count) ||
      row.token_count < 0 ||
      (row.truncated !== 0 && row.truncated !== 1) ||
      typeof row.mime_type !== 'string' ||
      !Number.isInteger(row.image_width) ||
      row.image_width <= 0 ||
      !Number.isInteger(row.image_height) ||
      row.image_height <= 0
    ) {
      return null
    }
    return {
      cacheKey: row.cache_key,
      text: row.text,
      tokenCount: row.token_count,
      truncated: row.truncated === 1,
      mimeType: row.mime_type,
      imageWidth: row.image_width,
      imageHeight: row.image_height,
      engine
    }
  } catch {
    return null
  }
}

function calculateArtifactBytes(
  identity: OcrArtifactIdentity,
  value: OcrArtifactValue,
  engineJson: string,
  qualificationMetadata: string
): number {
  return (
    Buffer.byteLength(JSON.stringify(identity), 'utf8') +
    Buffer.byteLength(value.text, 'utf8') +
    Buffer.byteLength(value.mimeType, 'utf8') +
    Buffer.byteLength(engineJson, 'utf8') +
    Buffer.byteLength(qualificationMetadata, 'utf8') +
    128
  )
}

class OcrArtifactDatabaseError extends Error {
  constructor(
    readonly code: 'schema_mismatch',
    message: string
  ) {
    super(message)
    this.name = 'OcrArtifactDatabaseError'
  }
}

function cloneArtifactValue(value: OcrArtifactValue): OcrArtifactValue {
  return {
    ...value,
    engine: structuredClone(value.engine)
  }
}

function cloneArtifact(value: OcrArtifact): OcrArtifact {
  return {
    ...value,
    engine: structuredClone(value.engine)
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`)
}
