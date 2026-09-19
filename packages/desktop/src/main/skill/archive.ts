import fs from 'node:fs'
import path from 'node:path'
import { Unzip, UnzipInflate } from 'fflate'

export type SkillArchiveLimits = Readonly<{
  maxArchiveBytes: number
  maxEntries: number
  maxEntryBytes: number
  maxExtractedBytes: number
  maxCompressionRatio: number
  compressionRatioExemptBytes: number
  maxPathDepth: number
  maxPathCharacters: number
}>

export const DEFAULT_SKILL_ARCHIVE_LIMITS: SkillArchiveLimits = {
  maxArchiveBytes: 200 * 1024 * 1024,
  maxEntries: 4096,
  maxEntryBytes: 64 * 1024 * 1024,
  maxExtractedBytes: 256 * 1024 * 1024,
  maxCompressionRatio: 200,
  compressionRatioExemptBytes: 1024 * 1024,
  maxPathDepth: 32,
  maxPathCharacters: 1024
}

type ResolvedArchiveEntry = Readonly<{
  destination: string
  key: string
  isDirectory: boolean
}>

const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

/** Plugin snapshots cannot contain links or special files, including ZIP Unix attributes. */
export async function assertRegularZipEntries(archivePath: string): Promise<string[]> {
  const executables: string[] = []
  const file = await fs.promises.open(archivePath, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > DEFAULT_SKILL_ARCHIVE_LIMITS.maxArchiveBytes) {
      throw new Error('Invalid or oversized plugin ZIP')
    }
    const tail = Buffer.alloc(Math.min(stat.size, 65557))
    await file.read(tail, 0, tail.length, stat.size - tail.length)
    let end = tail.length - 22
    while (
      end >= 0 &&
      (tail.readUInt32LE(end) !== 0x06054b50 ||
        end + 22 + tail.readUInt16LE(end + 20) !== tail.length)
    )
      end--
    if (end < 0) throw new Error('ZIP directory is missing')
    const count = tail.readUInt16LE(end + 10)
    const size = tail.readUInt32LE(end + 12)
    const offset = tail.readUInt32LE(end + 16)
    if (
      tail.readUInt16LE(end + 4) ||
      tail.readUInt16LE(end + 6) ||
      count !== tail.readUInt16LE(end + 8) ||
      count > DEFAULT_SKILL_ARCHIVE_LIMITS.maxEntries ||
      size > 16 * 1024 * 1024 ||
      offset + size !== stat.size - tail.length + end
    ) {
      throw new Error('Unsupported ZIP directory layout or limits')
    }
    const directory = Buffer.alloc(size)
    await file.read(directory, 0, size, offset)
    let cursor = 0
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > size || directory.readUInt32LE(cursor) !== 0x02014b50)
        throw new Error('Invalid ZIP directory')
      const mode = directory.readUInt32LE(cursor + 38) >>> 16
      const kind = mode & 0o170000
      if (kind !== 0 && kind !== 0o100000 && kind !== 0o040000)
        throw new Error('ZIP links and special files are not supported')
      if (directory.readUInt16LE(cursor + 8) & 1)
        throw new Error('Encrypted ZIP entries are not supported')
      const nameLength = directory.readUInt16LE(cursor + 28)
      if (cursor + 46 + nameLength > size) throw new Error('Invalid ZIP entry name')
      if (mode & 0o111 && kind !== 0o040000)
        executables.push(directory.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'))
      cursor +=
        46 +
        directory.readUInt16LE(cursor + 28) +
        directory.readUInt16LE(cursor + 30) +
        directory.readUInt16LE(cursor + 32)
    }
    if (cursor !== size) throw new Error('Invalid ZIP directory size')
    return executables
  } finally {
    await file.close()
  }
}

function requireBoundedSize(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} has an invalid size`)
  }
  return value
}

function resolveArchiveEntry(
  entryName: string,
  targetDir: string,
  limits: SkillArchiveLimits
): ResolvedArchiveEntry {
  if (entryName.includes('\0') || entryName.length > limits.maxPathCharacters) {
    throw new Error('ZIP entry has an invalid path')
  }

  const normalizedEntry = entryName.replace(/\\/g, '/')
  if (!normalizedEntry) throw new Error('ZIP entry has an invalid path')
  if (/^[A-Za-z]:/.test(normalizedEntry) || normalizedEntry.startsWith('/')) {
    throw new Error('ZIP entry has an invalid path')
  }

  const segments: string[] = []
  for (const segment of normalizedEntry.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') throw new Error('ZIP entry has an invalid path')
    if (
      segment.includes(':') ||
      segment.endsWith('.') ||
      segment.endsWith(' ') ||
      WINDOWS_RESERVED_SEGMENT.test(segment)
    ) {
      throw new Error('ZIP entry has a non-portable path')
    }
    segments.push(segment)
  }
  if (segments.length === 0) throw new Error('ZIP entry has an invalid path')
  if (segments.length > limits.maxPathDepth) {
    throw new Error('ZIP entry exceeds the path depth limit')
  }

  const destination = path.resolve(targetDir, ...segments)
  const relativeToTarget = path.relative(targetDir, destination)
  if (
    relativeToTarget === '..' ||
    relativeToTarget.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToTarget)
  ) {
    throw new Error('ZIP entry has an invalid path')
  }

  return {
    destination,
    key: segments.join('/').normalize('NFC').toLocaleLowerCase('en-US'),
    isDirectory: normalizedEntry.endsWith('/')
  }
}

function writeAll(fd: number, chunk: Uint8Array): void {
  let offset = 0
  while (offset < chunk.byteLength) {
    const written = fs.writeSync(fd, chunk, offset, chunk.byteLength - offset)
    if (written <= 0) throw new Error('Failed to write extracted ZIP entry')
    offset += written
  }
}

export async function extractSkillArchive(
  archivePath: string,
  targetDir: string,
  limitOverrides: Partial<SkillArchiveLimits> = {},
  signal?: AbortSignal
): Promise<void> {
  const limits = { ...DEFAULT_SKILL_ARCHIVE_LIMITS, ...limitOverrides }
  const archiveStats = await fs.promises.stat(archivePath)
  if (!archiveStats.isFile()) throw new Error('Skill ZIP input is not a file')
  if (archiveStats.size > limits.maxArchiveBytes) {
    throw new Error(
      `ZIP file too large: ${archiveStats.size} bytes (max: ${limits.maxArchiveBytes})`
    )
  }

  const resolvedTargetDir = path.resolve(targetDir)
  fs.mkdirSync(resolvedTargetDir, { recursive: true })

  const seenEntries = new Set<string>()
  const openFiles = new Set<number>()
  let entryCount = 0
  let declaredBytes = 0
  let extractedBytes = 0
  let archiveBytes = 0
  let failure: Error | null = null

  const closeFile = (fd: number): void => {
    if (!openFiles.has(fd)) return
    fs.closeSync(fd)
    openFiles.delete(fd)
  }
  const fail = (error: unknown, fd?: number): void => {
    if (!failure) failure = error instanceof Error ? error : new Error(String(error))
    if (fd !== undefined) {
      try {
        closeFile(fd)
      } catch {
        // Preserve the extraction or write failure that caused cleanup.
      }
    }
  }
  const unzip = new Unzip((file) => {
    if (failure) {
      file.ondata = () => undefined
      return
    }

    try {
      signal?.throwIfAborted()
      entryCount += 1
      if (entryCount > limits.maxEntries) throw new Error('ZIP archive has too many entries')

      const entry = resolveArchiveEntry(file.name, resolvedTargetDir, limits)
      const declaredSize = requireBoundedSize(file.originalSize, 'ZIP entry')
      const compressedSize = requireBoundedSize(file.size, 'Compressed ZIP entry')
      if (declaredSize !== undefined) {
        if (declaredSize > limits.maxEntryBytes) {
          throw new Error('ZIP entry exceeds the extracted size limit')
        }
        declaredBytes += declaredSize
        if (declaredBytes > limits.maxExtractedBytes) {
          throw new Error('ZIP archive exceeds the total extracted size limit')
        }
        if (
          compressedSize !== undefined &&
          declaredSize > limits.compressionRatioExemptBytes &&
          (compressedSize === 0 || declaredSize / compressedSize > limits.maxCompressionRatio)
        ) {
          throw new Error('ZIP entry exceeds the compression ratio limit')
        }
      }

      if (seenEntries.has(entry.key)) throw new Error('ZIP archive contains duplicate paths')
      seenEntries.add(entry.key)

      if (entry.isDirectory) {
        fs.mkdirSync(entry.destination, { recursive: true })
        file.ondata = (error, chunk) => {
          if (error) fail(error)
          if (chunk?.byteLength) fail(new Error('ZIP directory entry contains file data'))
        }
        file.start()
        return
      }

      fs.mkdirSync(path.dirname(entry.destination), { recursive: true })
      const fd = fs.openSync(entry.destination, 'wx')
      openFiles.add(fd)
      let entryBytes = 0
      file.ondata = (error, chunk, final) => {
        if (error) {
          fail(error, fd)
          return
        }
        if (failure) {
          if (final) {
            try {
              closeFile(fd)
            } catch {
              // Preserve the first extraction failure.
            }
          }
          return
        }

        try {
          if (chunk?.byteLength) {
            entryBytes += chunk.byteLength
            extractedBytes += chunk.byteLength
            if (entryBytes > limits.maxEntryBytes) {
              throw new Error('ZIP entry exceeds the extracted size limit')
            }
            if (extractedBytes > limits.maxExtractedBytes) {
              throw new Error('ZIP archive exceeds the total extracted size limit')
            }
            writeAll(fd, chunk)
          }
          if (final) closeFile(fd)
        } catch (writeError) {
          fail(writeError, fd)
        }
      }
      file.start()
    } catch (error) {
      fail(error)
    }
  })
  unzip.register(UnzipInflate)

  const archiveStream = fs.createReadStream(archivePath, { highWaterMark: 64 * 1024 })
  try {
    for await (const chunk of archiveStream) {
      signal?.throwIfAborted()
      archiveBytes += chunk.byteLength
      if (archiveBytes > limits.maxArchiveBytes) {
        throw new Error(`ZIP file exceeds its ${limits.maxArchiveBytes} byte limit`)
      }
      unzip.push(chunk, false)
      if (failure) throw failure
    }
    unzip.push(new Uint8Array(0), true)
    if (failure) throw failure
    if (openFiles.size > 0) throw new Error('ZIP archive ended before an entry was complete')
  } finally {
    archiveStream.destroy()
    for (const fd of openFiles) {
      try {
        closeFile(fd)
      } catch {
        // The original extraction error remains the actionable failure.
      }
    }
  }
}
