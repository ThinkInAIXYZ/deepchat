import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import {
  SyncBatchSchema,
  SyncBatchManifestSchema,
  SYNC_MAX_BATCH_BYTES,
  SYNC_PART_BYTES,
  type SyncBatch,
  type SyncBatchManifest
} from '@shared/contracts/syncReplica'

const compress = promisify(gzip)
const decompress = promisify(gunzip)

/** Private immutable transfer files; neither credentials nor received data enters the backup folder. */
export class SyncBatchFiles {
  constructor(private readonly directory: string) {}

  private file(id: string, suffix = ''): string {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid sync batch identity')
    return path.join(this.directory, `${id}${suffix}`)
  }

  async prepare(batch: SyncBatch): Promise<SyncBatchManifest> {
    const raw = Buffer.from(JSON.stringify(batch))
    if (raw.length > SYNC_MAX_BATCH_BYTES) throw new Error('sync.tunnel.error.batchTooLarge')
    const data = await compress(raw)
    const id = createHash('sha256').update(data).digest('hex')
    const manifest = SyncBatchManifestSchema.parse({
      id,
      size: data.length,
      parts: Math.ceil(data.length / SYNC_PART_BYTES),
      through: batch.through,
      replicaId: batch.replicaId
    })
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await this.reserve(id, data.length)
    await writeFile(this.file(id, '.tmp'), data, { mode: 0o600 })
    await rename(this.file(id, '.tmp'), this.file(id))
    await this.prune(id)
    return manifest
  }

  async part(id: string, part: number): Promise<Buffer> {
    if (!Number.isSafeInteger(part) || part < 0) throw new Error('Invalid sync part')
    const { open } = await import('node:fs/promises')
    const file = await open(this.file(id), 'r')
    try {
      const size = (await file.stat()).size
      if (part * SYNC_PART_BYTES >= size) throw new Error('Invalid sync part')
      const buffer = Buffer.alloc(Math.min(SYNC_PART_BYTES, size - part * SYNC_PART_BYTES))
      const { bytesRead } = await file.read(buffer, 0, buffer.length, part * SYNC_PART_BYTES)
      if (bytesRead !== buffer.length) throw new Error('Incomplete sync part')
      return buffer
    } finally {
      await file.close()
    }
  }

  async missing(manifest: SyncBatchManifest): Promise<number[]> {
    await this.prune(manifest.id)
    const missing: number[] = []
    for (let part = 0; part < manifest.parts; part++) {
      const size = await stat(this.file(manifest.id, `.${part}.part`))
        .then((value) => value.size)
        .catch(() => -1)
      if (size !== Math.min(SYNC_PART_BYTES, manifest.size - part * SYNC_PART_BYTES))
        missing.push(part)
    }
    return missing
  }

  async receive(manifest: SyncBatchManifest, part: number, data: Buffer): Promise<void> {
    if (
      !Number.isSafeInteger(part) ||
      part < 0 ||
      part >= manifest.parts ||
      data.length !== Math.min(SYNC_PART_BYTES, manifest.size - part * SYNC_PART_BYTES)
    )
      throw new Error('Invalid sync part')
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await this.reserve(manifest.id, data.length)
    const target = this.file(manifest.id, `.${part}.part`)
    await writeFile(`${target}.tmp`, data, { mode: 0o600 })
    await rename(`${target}.tmp`, target)
  }

  async assemble(manifest: SyncBatchManifest): Promise<SyncBatch> {
    const parts: Buffer[] = []
    for (let part = 0; part < manifest.parts; part++)
      parts.push(await readFile(this.file(manifest.id, `.${part}.part`)))
    const data = Buffer.concat(parts)
    if (
      data.length !== manifest.size ||
      createHash('sha256').update(data).digest('hex') !== manifest.id
    ) {
      await this.discard(manifest.id)
      throw new Error('sync.tunnel.error.integrityFailed')
    }
    const raw = await decompress(data, { maxOutputLength: SYNC_MAX_BATCH_BYTES })
    const batch = SyncBatchSchema.parse(JSON.parse(raw.toString('utf8')))
    if (batch.replicaId !== manifest.replicaId || batch.through !== manifest.through)
      throw new Error('Invalid batch manifest')
    return batch
  }

  private async reserve(id: string, bytes: number): Promise<void> {
    await this.prune(id)
    const sizes = await Promise.all(
      (await readdir(this.directory)).map((name) =>
        stat(path.join(this.directory, name))
          .then((value) => value.size)
          .catch(() => 0)
      )
    )
    if (sizes.reduce((sum, size) => sum + size, bytes) > 4 * SYNC_MAX_BATCH_BYTES)
      throw new Error('sync.tunnel.error.diskFull')
  }

  async discard(id: string, partsOnly = false): Promise<void> {
    this.file(id)
    for (const name of await readdir(this.directory).catch(() => [])) {
      if (name.startsWith(id) && (!partsOnly || name !== id))
        await rm(path.join(this.directory, name), { force: true })
    }
  }

  async prune(keep?: string): Promise<void> {
    const names = await readdir(this.directory).catch(() => [])
    const files = await Promise.all(
      names.map(async (name) => ({
        name,
        at: await stat(path.join(this.directory, name))
          .then((value) => value.mtimeMs)
          .catch(() => 0)
      }))
    )
    for (const file of files) {
      if (!file.name.startsWith(keep ?? '!') && file.at < Date.now() - 24 * 60 * 60_000)
        await rm(path.join(this.directory, file.name), { force: true })
    }
  }
}
