import fs from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { finished, pipeline } from 'node:stream/promises'
import { crc32 } from 'node:zlib'
import { ZipFile } from 'yazl'
import { openPromise, type Entry } from 'yauzl'

export type BackupArchiveEntry = {
  name: string
  source: { data: Uint8Array } | { file: string; size: number }
}

function entryPath(name: string): string {
  const normalized = name.replaceAll('\\', '/')
  const parts = normalized.split('/').filter((part) => part && part !== '.')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.includes('\0') ||
    normalized.includes(':') ||
    parts.some((part) => part === '..') ||
    !parts.length
  )
    throw new Error('sync.error.noValidBackup')
  return parts.join('/')
}

function checksum(entry: Entry): Transform {
  let value = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      value = crc32(chunk, value)
      callback(null, chunk)
    },
    flush(callback) {
      callback(value === entry.crc32 ? null : new Error('Backup entry checksum mismatch'))
    }
  })
}

/** ZIP64 is selected automatically for large offsets, files and entry counts. */
export async function writeBackupArchive(
  target: string,
  entries: Iterable<BackupArchiveEntry>,
  options: { forceZip64?: boolean } = {}
): Promise<void> {
  const zip = new ZipFile()
  const output = fs.createWriteStream(target, { mode: 0o600 })
  const writing = pipeline(zip.outputStream, output)
  void writing.catch(() => {})
  const active = new Set<Readable>()
  zip.on('error', (error: Error) => output.destroy(error))
  try {
    const names = new Set<string>()
    for (const entry of entries) {
      const name = entryPath(entry.name)
      if (names.has(name)) throw new Error('Duplicate backup entry')
      names.add(name)
      const source = entry.source
      const size = 'data' in source ? source.data.byteLength : source.size
      if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid backup entry size')
      zip.addReadStreamLazy(
        name,
        {
          size,
          mode: 0o100600,
          compressionLevel: 6,
          forceZip64Format: options.forceZip64 === true
        },
        (accept) => {
          const input =
            'file' in source
              ? fs.createReadStream(source.file)
              : Readable.from(
                  (function* () {
                    for (let offset = 0; offset < source.data.byteLength; offset += 64 * 1024)
                      yield Buffer.from(
                        source.data.buffer,
                        source.data.byteOffset + offset,
                        Math.min(64 * 1024, source.data.byteLength - offset)
                      )
                  })(),
                  { objectMode: false, highWaterMark: 64 * 1024 }
                )
          active.add(input)
          input.on('error', (error) => output.destroy(error))
          input.once('close', () => active.delete(input))
          accept(null, input)
        }
      )
    }
    zip.end({ forceZip64Format: options.forceZip64 === true, comment: '' })
    await writing
  } catch (error) {
    output.destroy(error as Error)
    const closing = [...active].map((input) => finished(input))
    for (const input of active) input.destroy()
    await Promise.allSettled([writing, ...closing])
    throw error
  }
}

/** Read one entry at a time; output and decompression both respect filesystem backpressure. */
export async function extractBackupArchive(file: string, directory: string): Promise<void> {
  const zip = await openPromise(file, {
    lazyEntries: true,
    autoClose: false,
    validateEntrySizes: true
  })
  try {
    const names = new Set<string>()
    for await (const entry of zip.eachEntry()) {
      const name = entryPath(entry.fileName)
      if (names.has(name)) throw new Error('sync.error.noValidBackup')
      names.add(name)
      const kind = (entry.externalFileAttributes >>> 16) & 0o170000
      if (kind && kind !== 0o100000 && kind !== 0o040000)
        throw new Error('sync.error.noValidBackup')
      const destination = path.join(directory, name)
      if (entry.fileName.endsWith('/')) {
        if (entry.uncompressedSize) throw new Error('sync.error.noValidBackup')
        await mkdir(destination, { recursive: true, mode: 0o700 })
      } else {
        await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
        const input = await zip.openReadStreamPromise(entry)
        await pipeline(
          input,
          checksum(entry),
          fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 })
        )
      }
    }
  } finally {
    zip.close()
  }
}

/** Central-directory lookup skips file contents and bounds the only buffered entry. */
export async function readBackupManifest(file: string): Promise<Record<string, unknown> | null> {
  const limit = 1024 * 1024
  let zip: Awaited<ReturnType<typeof openPromise>> | undefined
  try {
    zip = await openPromise(file, { lazyEntries: true, autoClose: false, validateEntrySizes: true })
    let manifest: Record<string, unknown> | null = null
    let seen = false
    for await (const entry of zip.eachEntry()) {
      if (entry.fileName !== 'manifest.json') continue
      if (seen) return null
      seen = true
      if (entry.uncompressedSize > limit) return null
      const input = await zip.openReadStreamPromise(entry)
      const chunks: Buffer[] = []
      let length = 0
      let crc = 0
      for await (const chunk of input) {
        length += chunk.length
        if (length > limit) throw new Error('Backup manifest exceeds its size limit')
        crc = crc32(chunk, crc)
        chunks.push(chunk)
      }
      if (crc !== entry.crc32) return null
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      manifest = value && typeof value === 'object' && !Array.isArray(value) ? value : null
    }
    return manifest
  } catch {
    return null
  } finally {
    zip?.close()
  }
}
