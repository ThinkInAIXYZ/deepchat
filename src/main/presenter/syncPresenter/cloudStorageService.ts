import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  type _Object
} from '@aws-sdk/client-s3'
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
  private readonly client: S3Client
  private readonly bucket: string
  private readonly prefix: string

  constructor(config: ResolvedCloudSyncConfig) {
    this.bucket = config.bucket
    // Normalize the prefix to a trailing-slash-free key segment (empty means bucket root).
    this.prefix = config.prefix.replace(/^\/+|\/+$/g, '')
    this.client = new S3Client({
      endpoint: config.endpoint,
      // R2 expects 'auto'; AWS expects a real region. Default upstream is 'auto'.
      region: config.region || 'auto',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      },
      // R2 / MinIO require path-style addressing.
      forcePathStyle: true
    })
  }

  private buildKey(fileName: string): string {
    return this.prefix ? `${this.prefix}/${fileName}` : fileName
  }

  /** ListObjects probe used by the settings "test connection" button. */
  public async testConnection(): Promise<void> {
    await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: this.prefix ? `${this.prefix}/` : undefined,
        MaxKeys: 1
      })
    )
  }

  /** Upload a single local backup zip under the configured prefix. */
  public async uploadBackup(localZipPath: string, fileName: string): Promise<void> {
    const body = fs.createReadStream(localZipPath)
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.buildKey(fileName),
        Body: body,
        ContentType: 'application/zip'
      })
    )
  }

  private toReadableStream(body: unknown): NodeJS.ReadableStream {
    if (body instanceof Readable) {
      return body
    }

    if (body && typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function') {
      return Readable.from(body as AsyncIterable<Uint8Array>)
    }

    const withWebStream = body as { transformToWebStream?: () => unknown }
    if (typeof withWebStream?.transformToWebStream === 'function') {
      return Readable.fromWeb(
        withWebStream.transformToWebStream() as Parameters<typeof Readable.fromWeb>[0]
      )
    }

    throw new Error('sync.error.cloudDownloadFailed')
  }

  /** List remote `backup-*.zip` objects, newest first. */
  public async listRemoteBackups(): Promise<SyncBackupInfo[]> {
    const backups: SyncBackupInfo[] = []
    let continuationToken: string | undefined

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: this.prefix ? `${this.prefix}/` : undefined,
          ContinuationToken: continuationToken
        })
      )

      for (const item of response.Contents ?? []) {
        const info = this.toBackupInfo(item)
        if (info) {
          backups.push(info)
        }
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
    } while (continuationToken)

    return backups.sort((a, b) => b.createdAt - a.createdAt)
  }

  private toBackupInfo(item: _Object): SyncBackupInfo | null {
    if (!item.Key) {
      return null
    }
    const fileName = item.Key.split('/').pop() || ''
    if (!BACKUP_FILE_NAME_REGEX.test(fileName)) {
      return null
    }
    const match = fileName.match(/backup-(\d+)\.zip$/)
    const createdAt = match ? Number(match[1]) : (item.LastModified?.getTime() ?? 0)
    return { fileName, createdAt, size: item.Size ?? 0 }
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
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.buildKey(latest.fileName)
      })
    )

    if (!response.Body) {
      throw new Error('sync.error.cloudDownloadFailed')
    }

    fs.mkdirSync(targetDir, { recursive: true })
    const targetPath = path.join(targetDir, latest.fileName)
    await pipeline(this.toReadableStream(response.Body), fs.createWriteStream(targetPath))
    return latest.fileName
  }
}
