import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Unzip, UnzipInflate } from 'fflate'
import type { SyncBackupInfo } from '@shared/types/sync'

export interface SyncHostSnapshot {
  fileName: string
  filePath: string
  size: number
  sha256: string
  /** `version` from the backup package's own manifest.json; null when it cannot be read. */
  backupFormatVersion: number | null
  /** Whether the packaged database is encrypted, which a slave cannot import without the password. */
  databaseEncrypted: boolean
}

interface CachedDigest {
  size: number
  mtimeMs: number
  sha256: string
  backupFormatVersion: number | null
  databaseEncrypted: boolean
}

interface BackupManifestShape {
  version?: unknown
  databaseEncrypted?: unknown
}

/**
 * Extracts only manifest.json from the archive.
 *
 * The archive is streamed rather than buffered: a backup package can be hundreds of megabytes and a
 * transient full-archive read in the main process is a real memory risk. fflate cannot skip an
 * entry, so the remaining entries are inflated and discarded — bounded memory at the cost of one
 * decompression pass, which only happens when the digest cache misses.
 */
function readManifestEntry(filePath: string): Promise<BackupManifestShape | null> {
  return new Promise((resolve) => {
    let settled = false
    let manifest: BackupManifestShape | null = null
    const done = (value: BackupManifestShape | null): void => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const unzip = new Unzip((file) => {
      if (!file.name.endsWith('manifest.json')) {
        file.ondata = () => undefined
        file.start()
        return
      }
      const chunks: Uint8Array[] = []
      file.ondata = (error, data, final) => {
        if (error) return
        chunks.push(data)
        if (!final) return
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
          manifest = parsed && typeof parsed === 'object' ? (parsed as BackupManifestShape) : null
        } catch {
          manifest = null
        }
      }
      file.start()
    })

    // fflate only auto-registers stored entries; deflate entries need a codec or `start()` throws.
    unzip.register(UnzipInflate)

    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })
    stream.on('data', (chunk: string | Buffer) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      // A corrupt or hostile archive must not throw out of a stream handler: that would escape to
      // the main process and leave the request hanging.
      try {
        unzip.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), false)
      } catch {
        done(null)
        stream.destroy()
      }
    })
    stream.on('error', () => done(null))
    stream.on('end', () => {
      // The trailing central directory is what finalizes the last entry, so the result is only
      // known after the final push has been processed.
      try {
        unzip.push(new Uint8Array(0), true)
      } catch {
        done(null)
        return
      }
      setImmediate(() => done(manifest))
    })
  })
}

async function digestFile(
  filePath: string
): Promise<{ sha256: string; backupFormatVersion: number | null; databaseEncrypted: boolean }> {
  const sha256 = await new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = fs.createReadStream(filePath, { highWaterMark: 512 * 1024 })
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })

  const manifest = await readManifestEntry(filePath)

  const version = manifest?.version
  return {
    sha256,
    backupFormatVersion: typeof version === 'number' && Number.isInteger(version) ? version : null,
    databaseEncrypted: manifest?.databaseEncrypted === true
  }
}

/**
 * Resolves the snapshot a slave would receive: the most recent backup package in the sync folder,
 * with its size, content hash and format metadata. Digests are cached per file identity so repeated
 * status requests do not re-hash a large archive.
 */
export class SyncHostSnapshotSource {
  private readonly digests = new Map<string, CachedDigest>()
  private readonly inFlight = new Map<string, Promise<SyncHostSnapshot | null>>()

  constructor(
    private readonly deps: {
      listBackups: () => Promise<SyncBackupInfo[]>
      getFolderPath: () => string
    }
  ) {}

  /**
   * Concurrent callers (several slaves, or a status poll during a download) share one digest pass,
   * so N simultaneous requests cannot each hash the archive and multiply memory and I/O.
   */
  async current(): Promise<SyncHostSnapshot | null> {
    const pending = this.inFlight.get('current')
    if (pending) return pending
    const run = this.resolveCurrent().finally(() => {
      this.inFlight.delete('current')
    })
    this.inFlight.set('current', run)
    return run
  }

  private async resolveCurrent(): Promise<SyncHostSnapshot | null> {
    const backups = await this.deps.listBackups()
    if (backups.length === 0) return null
    const latest = [...backups].sort((left, right) => right.createdAt - left.createdAt)[0]
    const filePath = path.join(this.deps.getFolderPath(), latest.fileName)

    let stat: fs.Stats
    try {
      stat = await fs.promises.stat(filePath)
    } catch {
      return null
    }

    const cached = this.digests.get(latest.fileName)
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      return {
        fileName: latest.fileName,
        filePath,
        size: stat.size,
        sha256: cached.sha256,
        backupFormatVersion: cached.backupFormatVersion,
        databaseEncrypted: cached.databaseEncrypted
      }
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const digest = await digestFile(filePath)
      const after = await fs.promises.stat(filePath).catch(() => null)
      if (!after || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) {
        // The package changed while it was read: never report a hash for bytes we did not measure.
        if (attempt === 1) return null
        stat = after ?? stat
        continue
      }
      this.digests.set(latest.fileName, {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ...digest
      })
      this.forgetOtherEntries(latest.fileName)
      return { fileName: latest.fileName, filePath, size: stat.size, ...digest }
    }
    return null
  }

  private forgetOtherEntries(keepFileName: string): void {
    for (const key of this.digests.keys()) {
      if (key !== keepFileName) this.digests.delete(key)
    }
  }
}
