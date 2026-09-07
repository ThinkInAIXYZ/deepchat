import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, rename, unlink, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import type { CliPolicyAuditRecord } from './policy'

const DEFAULT_MAX_AUDIT_BYTES = 10 * 1024 * 1024

export type CliAuditLogOptions = Readonly<{
  directory: string
  maxBytes?: number
}>

async function removeIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be positive`)
  return value
}

export class CliAuditLog {
  private readonly filePath: string
  private readonly rotatedPath: string
  private readonly maxBytes: number
  private handle: FileHandle | undefined
  private size = 0
  private accepting = true
  private tail = Promise.resolve()
  private closePromise: Promise<void> | undefined

  constructor(private readonly options: CliAuditLogOptions) {
    this.maxBytes = positiveSafeInteger(options.maxBytes ?? DEFAULT_MAX_AUDIT_BYTES, 'maxBytes')
    this.filePath = path.join(options.directory, 'audit.jsonl')
    this.rotatedPath = path.join(options.directory, 'audit.1.jsonl')
  }

  record(record: CliPolicyAuditRecord): Promise<void> {
    if (!this.accepting) return Promise.reject(new Error('CLI audit log is closed'))
    const serialized = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8')
    if (serialized.length > this.maxBytes) {
      return Promise.reject(new Error('CLI audit record exceeds the audit file limit'))
    }

    const write = this.tail.catch(() => undefined).then(() => this.append(serialized))
    this.tail = write.catch(() => undefined)
    return write
  }

  async close(): Promise<void> {
    if (this.closePromise) return await this.closePromise
    this.accepting = false
    this.closePromise = (async () => {
      await this.tail
      await this.closeHandle()
    })()
    return await this.closePromise
  }

  private async append(serialized: Buffer): Promise<void> {
    await this.ensureOpen()
    if (this.size + serialized.length > this.maxBytes) {
      await this.rotate()
    }
    if (!this.handle) throw new Error('CLI audit log is unavailable')
    let offset = 0
    while (offset < serialized.length) {
      const { bytesWritten } = await this.handle.write(
        serialized,
        offset,
        serialized.length - offset
      )
      if (bytesWritten === 0) throw new Error('CLI audit write made no progress')
      offset += bytesWritten
    }
    this.size += serialized.length
  }

  private async ensureOpen(): Promise<void> {
    if (this.handle) return
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 })
    const directoryStats = await lstat(this.options.directory)
    if (!directoryStats.isDirectory()) throw new Error('CLI audit directory is not a directory')
    if (process.platform !== 'win32') {
      if (typeof process.getuid === 'function' && directoryStats.uid !== process.getuid()) {
        throw new Error('CLI audit directory is not owned by the current user')
      }
      await chmod(this.options.directory, 0o700)
    }
    const handle = await this.openAuditFile()
    try {
      if (process.platform !== 'win32') await handle.chmod(0o600)
      const stats = await handle.stat()
      if (!stats.isFile()) throw new Error('CLI audit path is not a regular file')
      if (process.platform !== 'win32') {
        if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
          throw new Error('CLI audit file is not owned by the current user')
        }
        if (stats.nlink !== 1) throw new Error('CLI audit file must not have multiple links')
      }
      this.handle = handle
      this.size = stats.size
    } catch (error) {
      await handle.close().catch(() => undefined)
      throw error
    }
  }

  private async openAuditFile(): Promise<FileHandle> {
    const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW
    const existingFlags = constants.O_APPEND | constants.O_WRONLY | noFollow
    const createFlags =
      constants.O_APPEND | constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY

    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (process.platform === 'win32') {
        try {
          const stats = await lstat(this.filePath)
          if (!stats.isFile()) throw new Error('CLI audit path is not a regular file')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      try {
        return await open(this.filePath, existingFlags)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }

      try {
        return await open(this.filePath, createFlags, 0o600)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }

    throw new Error('CLI audit file changed repeatedly while opening')
  }

  private async rotate(): Promise<void> {
    await this.closeHandle()
    await removeIfPresent(this.rotatedPath)
    try {
      await rename(this.filePath, this.rotatedPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await this.ensureOpen()
  }

  private async closeHandle(): Promise<void> {
    const handle = this.handle
    this.handle = undefined
    this.size = 0
    if (handle) await handle.close()
  }
}
