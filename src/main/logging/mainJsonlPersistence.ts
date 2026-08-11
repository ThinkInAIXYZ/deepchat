import fs from 'node:fs'
import path from 'node:path'
import { isMainLogEventName, isProjectedMainLogEvent, type MainLogLevel } from './mainLogEvents'
import {
  MAX_MAIN_LOG_RECORD_BYTES,
  type MainLogPersistence,
  type MainLogWriteResult
} from './mainLogger'

type MainLogFs = Pick<
  typeof fs,
  | 'closeSync'
  | 'constants'
  | 'fchmodSync'
  | 'fstatSync'
  | 'ftruncateSync'
  | 'lstatSync'
  | 'mkdirSync'
  | 'openSync'
  | 'readSync'
  | 'renameSync'
  | 'writeSync'
>

export interface MainJsonlPersistenceOptions {
  getUserDataPath: () => string
  fs?: MainLogFs
}

const MAX_MAIN_LOG_FILE_BYTES = 10 * 1024 * 1024
const TAIL_SCAN_CHUNK_BYTES = 64 * 1024
const MAX_SAFE_FILE_SIZE = BigInt(Number.MAX_SAFE_INTEGER)
const MAIN_LOG_IDENTITY_RECHECK_INTERVAL = 64
const MAIN_LOG_DIRECTORY_MODE = 0o700
const MAIN_LOG_FILE_MODE = 0o600

export class MainJsonlPersistence implements MainLogPersistence {
  private readonly fs: MainLogFs
  private logPath: string | undefined
  private descriptor: number | undefined
  private activeSize = 0
  private writesSinceIdentityCheck = 0
  private enabled = false
  private failed = false

  constructor(private readonly options: MainJsonlPersistenceOptions) {
    this.fs = options.fs ?? fs
  }

  enable(): boolean {
    if (this.failed) return false
    if (this.enabled) return true

    try {
      const logDirectory = path.join(this.options.getUserDataPath(), 'logs')
      this.logPath = path.join(logDirectory, 'main.jsonl')
      this.fs.mkdirSync(logDirectory, { recursive: true, mode: MAIN_LOG_DIRECTORY_MODE })
      this.secureLogDirectory(logDirectory)
      const damagedDescriptor = this.repairIncompleteTail(this.logPath)
      if (damagedDescriptor !== undefined) {
        this.archiveDamagedActiveFile(this.logPath, damagedDescriptor)
      }
      this.enabled = true
      return true
    } catch {
      this.fail()
      return false
    }
  }

  disable(): void {
    this.enabled = false
    try {
      this.closeActiveFile()
    } catch {
      this.failed = true
    }
  }

  write(level: MainLogLevel, line: string): MainLogWriteResult {
    if (!this.enabled || this.failed) return 'failed'
    if (!isMainLogRecordLine(level, line)) return 'rejected'
    try {
      this.appendLine(line)
      return 'written'
    } catch {
      this.fail()
      return 'failed'
    }
  }

  private appendLine(line: string): void {
    if (!this.logPath) throw new Error('Main JSONL path is unavailable')
    const encoded = Buffer.from(`${line}\n`, 'utf8')
    this.openActiveFile()
    if (this.descriptor === undefined) throw new Error('Main JSONL descriptor is unavailable')
    if (this.writesSinceIdentityCheck >= MAIN_LOG_IDENTITY_RECHECK_INTERVAL) {
      this.activeSize = this.validateFileIdentity(this.logPath, this.descriptor)
      this.writesSinceIdentityCheck = 0
    }
    if (this.activeSize > 0 && this.activeSize + encoded.length > MAX_MAIN_LOG_FILE_BYTES) {
      this.rotate()
      this.openActiveFile()
    }

    if (this.descriptor === undefined) throw new Error('Main JSONL descriptor is unavailable')
    let offset = 0
    while (offset < encoded.length) {
      const remaining = encoded.length - offset
      const written = this.fs.writeSync(this.descriptor, encoded, offset, remaining)
      if (!Number.isSafeInteger(written) || written < 1 || written > remaining) {
        throw new Error('Main JSONL record write made no valid progress')
      }
      offset += written
    }
    this.activeSize += encoded.length
    this.writesSinceIdentityCheck += 1
  }

  private openActiveFile(): void {
    if (this.descriptor !== undefined) return
    if (!this.logPath) throw new Error('Main JSONL path is unavailable')

    try {
      const fileStat = this.fs.lstatSync(this.logPath)
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
        throw new Error('Main JSONL active path is not a regular file')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    const noFollow = this.fs.constants.O_NOFOLLOW ?? 0
    const descriptor = this.fs.openSync(
      this.logPath,
      this.fs.constants.O_WRONLY |
        this.fs.constants.O_APPEND |
        this.fs.constants.O_CREAT |
        noFollow,
      MAIN_LOG_FILE_MODE
    )
    try {
      const descriptorSize = this.validateFileIdentity(this.logPath, descriptor)
      this.secureActiveFile(this.logPath, descriptor)
      this.descriptor = descriptor
      this.activeSize = descriptorSize
      this.writesSinceIdentityCheck = 0
    } catch (error) {
      try {
        this.fs.closeSync(descriptor)
      } catch {
        // Preserve the validation failure that made the descriptor unsafe to retain.
      }
      throw error
    }
  }

  private rotate(): void {
    if (!this.logPath) throw new Error('Main JSONL path is unavailable')
    if (this.descriptor === undefined) throw new Error('Main JSONL descriptor is unavailable')
    this.validateFileIdentity(this.logPath, this.descriptor)
    const archivePath = path.join(path.dirname(this.logPath), 'main.old.jsonl')
    this.renameArchive(this.logPath, archivePath, this.descriptor)
    this.validateFileIdentity(archivePath, this.descriptor)
    this.closeActiveFile()
  }

  private closeActiveFile(): void {
    const descriptor = this.descriptor
    this.descriptor = undefined
    this.activeSize = 0
    this.writesSinceIdentityCheck = 0
    if (descriptor !== undefined) this.fs.closeSync(descriptor)
  }

  private repairIncompleteTail(filePath: string): number | undefined {
    try {
      const fileStat = this.fs.lstatSync(filePath)
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
        throw new Error('Main JSONL active path is not a regular file')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }

    const noFollow = this.fs.constants.O_NOFOLLOW ?? 0
    const descriptor = this.fs.openSync(filePath, this.fs.constants.O_RDWR | noFollow)
    let retainDescriptor = false
    try {
      const size = this.validateFileIdentity(filePath, descriptor)
      this.secureActiveFile(filePath, descriptor)
      if (size === 0) return undefined

      const lastByte = Buffer.allocUnsafe(1)
      if (this.fs.readSync(descriptor, lastByte, 0, 1, size - 1) !== 1) {
        throw new Error('Main JSONL tail could not be read')
      }
      if (lastByte[0] === 0x0a) return undefined

      const scanFloor = Math.max(0, size - (MAX_MAIN_LOG_RECORD_BYTES + 1))
      const chunk = Buffer.allocUnsafe(Math.min(TAIL_SCAN_CHUNK_BYTES, size - scanFloor))
      let scanEnd = size
      let truncateAt = 0
      while (scanEnd > scanFloor) {
        const scanStart = Math.max(scanFloor, scanEnd - chunk.length)
        const readLength = scanEnd - scanStart
        const bytesRead = this.fs.readSync(descriptor, chunk, 0, readLength, scanStart)
        if (bytesRead !== readLength) throw new Error('Main JSONL tail could not be read')
        const lastNewline = chunk.subarray(0, bytesRead).lastIndexOf(0x0a)
        if (lastNewline >= 0) {
          truncateAt = scanStart + lastNewline + 1
          break
        }
        scanEnd = scanStart
      }
      if (size - truncateAt >= MAX_MAIN_LOG_RECORD_BYTES) {
        retainDescriptor = true
        return descriptor
      }
      this.fs.ftruncateSync(descriptor, truncateAt)
      return undefined
    } finally {
      if (!retainDescriptor) this.fs.closeSync(descriptor)
    }
  }

  private archiveDamagedActiveFile(filePath: string, descriptor: number): void {
    try {
      this.validateFileIdentity(filePath, descriptor)
      const archivePath = path.join(path.dirname(filePath), 'main.old.jsonl')
      this.renameArchive(filePath, archivePath, descriptor)
      this.validateFileIdentity(archivePath, descriptor)
    } finally {
      this.fs.closeSync(descriptor)
    }
  }

  private renameArchive(sourcePath: string, archivePath: string, descriptor: number): void {
    try {
      this.fs.renameSync(sourcePath, archivePath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EACCES' && code !== 'EBUSY' && code !== 'EPERM') throw error
      this.validateFileIdentity(sourcePath, descriptor)
      this.fs.renameSync(sourcePath, archivePath)
    }
  }

  private validateFileIdentity(filePath: string, descriptor: number): number {
    const descriptorStat = this.fs.fstatSync(descriptor, { bigint: true })
    if (!descriptorStat.isFile()) {
      throw new Error('Main JSONL descriptor is not a regular file')
    }
    if (descriptorStat.nlink !== 1n) {
      throw new Error('Main JSONL descriptor must have exactly one filesystem link')
    }

    const directoryStat = this.fs.lstatSync(path.dirname(filePath), { bigint: true })
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      throw new Error('Main JSONL directory is no longer a regular directory')
    }

    const pathStat = this.fs.lstatSync(filePath, { bigint: true })
    if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
      throw new Error('Main JSONL active path is no longer a regular file')
    }
    if (pathStat.dev !== descriptorStat.dev || pathStat.ino !== descriptorStat.ino) {
      throw new Error('Main JSONL active path does not match the opened descriptor')
    }
    if (pathStat.nlink !== 1n) {
      throw new Error('Main JSONL path must have exactly one filesystem link')
    }
    if (descriptorStat.size > MAX_SAFE_FILE_SIZE) {
      throw new Error('Main JSONL active file exceeds the safe supported size')
    }

    return Number(descriptorStat.size)
  }

  private secureLogDirectory(logDirectory: string): void {
    if (process.platform === 'win32') {
      const directoryStat = this.fs.lstatSync(logDirectory)
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
        throw new Error('Main JSONL directory is not a regular directory')
      }
      return
    }

    const noFollow = this.fs.constants.O_NOFOLLOW ?? 0
    const directoryOnly = this.fs.constants.O_DIRECTORY ?? 0
    const descriptor = this.fs.openSync(
      logDirectory,
      this.fs.constants.O_RDONLY | directoryOnly | noFollow
    )
    try {
      this.validateDirectoryIdentity(logDirectory, descriptor)
      this.fs.fchmodSync(descriptor, MAIN_LOG_DIRECTORY_MODE)
      this.validateDirectoryIdentity(logDirectory, descriptor, MAIN_LOG_DIRECTORY_MODE)
    } finally {
      this.fs.closeSync(descriptor)
    }
  }

  private secureActiveFile(filePath: string, descriptor: number): void {
    if (process.platform === 'win32') return
    this.fs.fchmodSync(descriptor, MAIN_LOG_FILE_MODE)
    this.validateFileIdentity(filePath, descriptor)
  }

  private validateDirectoryIdentity(
    directoryPath: string,
    descriptor: number,
    expectedMode?: number
  ): void {
    const descriptorStat = this.fs.fstatSync(descriptor, { bigint: true })
    if (!descriptorStat.isDirectory()) {
      throw new Error('Main JSONL directory descriptor is not a regular directory')
    }
    const pathStat = this.fs.lstatSync(directoryPath, { bigint: true })
    if (pathStat.isSymbolicLink() || !pathStat.isDirectory()) {
      throw new Error('Main JSONL directory is not a regular directory')
    }
    if (pathStat.dev !== descriptorStat.dev || pathStat.ino !== descriptorStat.ino) {
      throw new Error('Main JSONL directory path does not match the opened descriptor')
    }
    if (expectedMode !== undefined && (descriptorStat.mode & 0o777n) !== BigInt(expectedMode)) {
      throw new Error('Main JSONL directory permissions are not private')
    }
  }

  private fail(): void {
    this.failed = true
    this.enabled = false
    try {
      this.closeActiveFile()
    } catch {
      // Persistence is already permanently disabled for this process.
    }
  }
}

function isMainLogRecordLine(level: MainLogLevel, line: string): boolean {
  if (
    line.includes('\n') ||
    line.includes('\r') ||
    Buffer.byteLength(line, 'utf8') + 1 > MAX_MAIN_LOG_RECORD_BYTES
  ) {
    return false
  }
  try {
    const value: unknown = JSON.parse(line)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    const context = record.context
    return (
      hasExactRecordFields(record) &&
      record.v === 1 &&
      typeof record.ts === 'string' &&
      isIsoTimestamp(record.ts) &&
      typeof record.seq === 'number' &&
      Number.isSafeInteger(record.seq) &&
      record.seq > 0 &&
      record.level === level &&
      isMainLogEventName(record.event) &&
      record.process === 'main' &&
      typeof record.processInstanceId === 'string' &&
      typeof record.appVersion === 'string' &&
      isProjectedMainLogEvent(record.event, level, context)
    )
  } catch {
    return false
  }
}

function hasExactRecordFields(record: Record<string, unknown>): boolean {
  const fields = [
    'v',
    'ts',
    'seq',
    'level',
    'event',
    'process',
    'processInstanceId',
    'appVersion',
    'context'
  ]
  return (
    Object.keys(record).length === fields.length &&
    fields.every((field) => Object.hasOwn(record, field))
  )
}

function isIsoTimestamp(value: string): boolean {
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}
