import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import path from 'node:path'
import { SYNC_PART_BYTES } from '@shared/contracts/syncReplica'
import {
  SyncNativeProfileSchema,
  SyncNativeTransferSchema,
  type SyncNativeTransfer
} from '@shared/contracts/syncNative'
import type { DimProfileSnapshot } from '@/agent/dim/profileSnapshot'

/** Bounded, resumable transfer of an opaque cold profile; this never opens native SQLite. */
export class SyncNativeFiles {
  private readonly validated = new WeakMap<SyncNativeTransfer, SyncNativeTransfer>()
  constructor(private readonly directory: string) {}

  private checked(value: SyncNativeTransfer): SyncNativeTransfer {
    const cached = this.validated.get(value)
    if (cached) return cached
    const transfer = SyncNativeTransferSchema.parse(value)
    if (
      createHash('sha256').update(JSON.stringify(transfer.manifest)).digest('hex') !== transfer.id
    )
      throw new Error('sync.tunnel.error.integrityFailed')
    // A transfer descriptor is immutable across its many bounded file parts.
    // Validate once per received object without trusting another object with the same id.
    for (const file of transfer.manifest.files) Object.freeze(file)
    Object.freeze(transfer.manifest.files)
    Object.freeze(transfer.manifest)
    Object.freeze(transfer)
    this.validated.set(value, transfer)
    this.validated.set(transfer, transfer)
    return transfer
  }

  private root(value: SyncNativeTransfer): string {
    return path.join(this.directory, this.checked(value).id)
  }

  private file(value: SyncNativeTransfer, index: number) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= value.manifest.files.length)
      throw new Error('Invalid native file index')
    return value.manifest.files[index]
  }

  private size(value: SyncNativeTransfer, index: number, part: number): number {
    const file = this.file(value, index)
    if (!Number.isSafeInteger(part) || part < 0 || part * SYNC_PART_BYTES >= file.size)
      throw new Error('Invalid native file part')
    return Math.min(SYNC_PART_BYTES, file.size - part * SYNC_PART_BYTES)
  }

  private async directories(root: string): Promise<void> {
    await mkdir(root, { recursive: true, mode: 0o700 })
    const info = await lstat(root)
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('Invalid native transfer root')
  }

  async prepare(snapshot: DimProfileSnapshot): Promise<SyncNativeTransfer> {
    const manifest = SyncNativeProfileSchema.parse(await snapshot.manifest())
    const value = this.checked({
      id: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
      manifest
    })
    const root = this.root(value)
    await this.directories(path.join(root, 'profile'))
    for (const file of value.manifest.files) {
      const destination = path.join(root, 'profile', file.path)
      await this.directories(path.dirname(destination))
      // A descriptor is immutable. Preserve a transfer still leased by another peer.
      const exists = await stat(destination).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      })
      if (exists?.size === file.size && (await this.digest(destination)) === file.sha256) continue
      const temporary = path.join(root, `${randomUUID()}.tmp`)
      try {
        await copyFile(
          path.join(snapshot.directory, file.path),
          temporary,
          constants.COPYFILE_FICLONE
        )
        if (
          (await stat(temporary)).size !== file.size ||
          (await this.digest(temporary)) !== file.sha256
        )
          throw new Error('sync.tunnel.error.integrityFailed')
        await chmod(temporary, file.mode)
        if (exists) await chmod(destination, 0o600)
        await rename(temporary, destination)
      } finally {
        await rm(temporary, { force: true })
      }
    }
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify(value), { mode: 0o600 })
    return value
  }

  async part(value: SyncNativeTransfer, index: number, part: number): Promise<Buffer> {
    value = this.checked(value)
    const root = this.root(value)
    const size = this.size(value, index, part)
    const file = await open(path.join(root, 'profile', this.file(value, index).path), 'r')
    try {
      if ((await file.stat()).size !== this.file(value, index).size)
        throw new Error('sync.tunnel.error.integrityFailed')
      const buffer = Buffer.alloc(size)
      let offset = 0
      while (offset < size) {
        const { bytesRead } = await file.read(
          buffer,
          offset,
          size - offset,
          part * SYNC_PART_BYTES + offset
        )
        if (!bytesRead) throw new Error('Incomplete native file part')
        offset += bytesRead
      }
      return buffer
    } finally {
      await file.close()
    }
  }

  async missing(value: SyncNativeTransfer): Promise<Array<{ file: number; part: number }>> {
    value = this.checked(value)
    const root = this.root(value)
    const missing: Array<{ file: number; part: number }> = []
    for (let index = 0; index < value.manifest.files.length; index++) {
      const file = value.manifest.files[index]
      for (let part = 0; part < Math.ceil(file.size / SYNC_PART_BYTES); part++) {
        const size = await stat(path.join(root, 'parts', `${index}.${part}`))
          .then((info) => info.size)
          .catch(() => -1)
        if (size !== this.size(value, index, part)) missing.push({ file: index, part })
      }
    }
    return missing
  }

  async receive(
    value: SyncNativeTransfer,
    index: number,
    part: number,
    bytes: Buffer
  ): Promise<void> {
    value = this.checked(value)
    const root = this.root(value)
    if (bytes.length !== this.size(value, index, part))
      throw new Error('Invalid native file part size')
    await this.directories(path.join(root, 'parts'))
    const temporary = path.join(root, 'parts', `${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' })
      await rename(temporary, path.join(root, 'parts', `${index}.${part}`))
    } finally {
      await rm(temporary, { force: true })
    }
  }

  async assemble(value: SyncNativeTransfer): Promise<string> {
    value = this.checked(value)
    const root = this.root(value)
    const profile = path.join(root, 'profile')
    await this.directories(profile)
    for (let index = 0; index < value.manifest.files.length; index++) {
      const file = value.manifest.files[index]
      const destination = path.join(profile, file.path)
      await this.directories(path.dirname(destination))
      const exists = await stat(destination).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      })
      if (exists?.size === file.size && (await this.digest(destination)) === file.sha256) continue
      const temporary = path.join(root, `${randomUUID()}.tmp`)
      try {
        const output = await open(temporary, 'wx', 0o600)
        try {
          for (let part = 0; part < Math.ceil(file.size / SYNC_PART_BYTES); part++) {
            const input = await open(path.join(root, 'parts', `${index}.${part}`), 'r')
            try {
              const buffer = Buffer.alloc(this.size(value, index, part))
              let position = 0
              while (position < buffer.length) {
                const { bytesRead } = await input.read(
                  buffer,
                  position,
                  buffer.length - position,
                  position
                )
                if (!bytesRead) throw new Error('Incomplete native file part')
                position += bytesRead
              }
              let written = 0
              while (written < buffer.length) {
                const result = await output.write(buffer, written, buffer.length - written)
                if (!result.bytesWritten) throw new Error('Incomplete native file write')
                written += result.bytesWritten
              }
            } finally {
              await input.close()
            }
          }
          await output.sync()
        } finally {
          await output.close()
        }
        if (
          (await stat(temporary)).size !== file.size ||
          (await this.digest(temporary)) !== file.sha256
        ) {
          for (let part = 0; part < Math.ceil(file.size / SYNC_PART_BYTES); part++)
            await rm(path.join(root, 'parts', `${index}.${part}`), { force: true })
          throw new Error('sync.tunnel.error.integrityFailed')
        }
        await chmod(temporary, file.mode)
        if (exists) await chmod(destination, 0o600)
        await rename(temporary, destination)
      } finally {
        await rm(temporary, { force: true })
      }
    }
    return profile
  }

  private async digest(file: string): Promise<string> {
    const hash = createHash('sha256')
    for await (const bytes of createReadStream(file)) hash.update(bytes)
    return hash.digest('hex')
  }

  async discard(value: SyncNativeTransfer): Promise<void> {
    await rm(this.root(value), { recursive: true, force: true })
  }

  async prune(keep: ReadonlySet<string>): Promise<void> {
    for (const name of await readdir(this.directory).catch(() => [])) {
      if (!/^[a-f0-9]{64}$/.test(name) || keep.has(name)) continue
      const root = path.join(this.directory, name)
      if ((await lstat(root)).mtimeMs < Date.now() - 24 * 60 * 60_000)
        await rm(root, { recursive: true, force: true })
    }
  }
}
