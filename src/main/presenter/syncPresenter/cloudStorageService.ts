import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { Operator, RetryLayer, TimeoutLayer, type Entry } from 'opendal'
import type { SyncBackupInfo } from '@shared/presenter'

/**
 * Resolved cloud config carrying the real secret. Built in the main process from
 * the (encrypted) values stored by ConfigPresenter — never sent to the renderer.
 */
export interface ResolvedCloudSyncConfig {
  endpoint: string
  bucket: string
  region: string
  prefix: string
  accessKeyId: string
  secretAccessKey: string
}

const BACKUP_FILE_NAME_REGEX = /^backup-\d+\.zip$/

/**
 * Thin wrapper around an S3-compatible object store (Cloudflare R2 / MinIO / AWS S3 / B2).
 * Only the minimal operations needed for "upload the latest backup" and
 * "pull the latest backup" are implemented — it does not manage local backups.
 */
export class CloudStorageService {
  private readonly operator: Operator
  private readonly prefix: string

  constructor(config: ResolvedCloudSyncConfig) {
    // Normalize the prefix to a trailing-slash-free key segment (empty means bucket root).
    this.prefix = config.prefix.replace(/^\/+|\/+$/g, '')
    this.operator = new Operator('s3', {
      root: this.toOpendalRoot(this.prefix),
      endpoint: config.endpoint,
      bucket: config.bucket,
      region: config.region || 'auto',
      access_key_id: config.accessKeyId,
      secret_access_key: config.secretAccessKey,
      // Cloudflare R2 requires exact multipart chunk sizes for non-trailing parts.
      enable_exact_buf_write: 'true'
    })

    const timeout = new TimeoutLayer()
    timeout.timeout = 30_000
    timeout.ioTimeout = 30_000
    this.operator.layer(timeout.build())

    const retry = new RetryLayer()
    retry.maxTimes = 3
    retry.jitter = true
    this.operator.layer(retry.build())
  }

  private toOpendalRoot(prefix: string): string {
    return prefix ? `/${prefix}` : '/'
  }

  /** Lightweight list probe used by the settings "test connection" button. */
  public async testConnection(): Promise<void> {
    // Cap the underlying request to a single key — we only need to confirm the
    // bucket is reachable and the credentials are accepted, not enumerate it.
    const lister = await this.operator.lister('/', { limit: 1 })
    await lister.next()
  }

  /** Upload a single local backup zip under the configured prefix. */
  public async uploadBackup(localZipPath: string, fileName: string): Promise<void> {
    const writer = await this.operator.writer(fileName, { contentType: 'application/zip' })
    await pipeline(fs.createReadStream(localZipPath), writer.createWriteStream())
  }

  /** List remote `backup-*.zip` objects, newest first. */
  public async listRemoteBackups(): Promise<SyncBackupInfo[]> {
    const backups: SyncBackupInfo[] = []
    const lister = await this.operator.lister('/', { recursive: true })
    let entry: Entry | null

    while ((entry = await lister.next()) !== null) {
      const info = this.toBackupInfo(entry)
      if (info) {
        backups.push(info)
      }
    }

    return backups.sort((a, b) => b.createdAt - a.createdAt)
  }

  private toBackupInfo(entry: Entry): SyncBackupInfo | null {
    const key = entry.path()
    if (!key) {
      return null
    }
    const fileName = key.split('/').pop() || ''
    if (!BACKUP_FILE_NAME_REGEX.test(fileName)) {
      return null
    }
    const match = fileName.match(/backup-(\d+)\.zip$/)
    const metadata = entry.metadata()
    const createdAt = match
      ? Number(match[1])
      : metadata.lastModified
        ? Date.parse(metadata.lastModified)
        : 0
    return { fileName, createdAt, size: Number(metadata.contentLength ?? 0n) }
  }

  /**
   * Download the newest remote backup into `targetDir` (the local sync folder).
   * Returns the landed file name, or null when the bucket has no backup yet.
   */
  public async downloadLatest(targetDir: string): Promise<string | null> {
    const remoteBackups = await this.listRemoteBackups()
    if (remoteBackups.length === 0) {
      return null
    }

    const latest = remoteBackups[0]
    fs.mkdirSync(targetDir, { recursive: true })
    const targetPath = path.join(targetDir, latest.fileName)
    const reader = await this.operator.reader(latest.fileName)
    await pipeline(reader.createReadStream(), fs.createWriteStream(targetPath))
    return latest.fileName
  }
}
