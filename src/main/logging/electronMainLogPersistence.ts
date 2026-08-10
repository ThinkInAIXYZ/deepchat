import electronLog from 'electron-log'
import fs from 'node:fs'
import path from 'node:path'
import { isMainLogEventName, isProjectedMainLogEvent, type MainLogLevel } from './mainLogEvents'
import { MAX_MAIN_LOG_RECORD_BYTES, type MainLogPersistence } from './mainLogger'

type MainLogFs = Pick<
  typeof fs,
  | 'closeSync'
  | 'constants'
  | 'fstatSync'
  | 'ftruncateSync'
  | 'lstatSync'
  | 'mkdirSync'
  | 'openSync'
  | 'readSync'
  | 'renameSync'
  | 'writeSync'
>

interface MainJsonlTransport {
  (message: { data: unknown[] }): void
  level: MainLogLevel | false
  transforms: []
}

export interface ElectronMainLogPersistenceOptions {
  getUserDataPath: () => string
  log?: typeof electronLog
  fs?: MainLogFs
}

const MAX_MAIN_LOG_FILE_BYTES = 10 * 1024 * 1024
const TAIL_SCAN_CHUNK_BYTES = 64 * 1024
const MAIN_JSONL_LOG_ID = 'deepchat-main-jsonl'

export class ElectronMainLogPersistence implements MainLogPersistence {
  private readonly log: typeof electronLog
  private readonly fs: MainLogFs
  private readonly transport: MainJsonlTransport
  private logPath: string | undefined
  private descriptor: number | undefined
  private activeSize = 0
  private enabled = false
  private failed = false

  constructor(private readonly options: ElectronMainLogPersistenceOptions) {
    if (!options.log) electronLog.transports.file.level = false
    this.log = options.log ?? electronLog.create({ logId: MAIN_JSONL_LOG_ID })
    this.fs = options.fs ?? fs
    this.log.transports.file.level = false
    this.log.transports.console.level = false

    this.transport = Object.assign(
      (message: { data: unknown[] }) => {
        if (!this.enabled || this.failed) return
        const line = message.data[0]
        if (typeof line !== 'string') {
          this.fail()
          return
        }
        try {
          this.appendLine(line)
        } catch {
          this.fail()
        }
      },
      { level: false as MainLogLevel | false, transforms: [] as [] }
    )
  }

  enable(): boolean {
    if (this.failed) return false
    if (this.enabled) return true

    try {
      const logDirectory = path.join(this.options.getUserDataPath(), 'logs')
      this.logPath = path.join(logDirectory, 'main.jsonl')
      this.fs.mkdirSync(logDirectory, { recursive: true })
      const directoryStat = this.fs.lstatSync(logDirectory)
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
        throw new Error('Main JSONL directory is not a regular directory')
      }
      this.repairIncompleteTail(this.logPath)
      this.transport.level = 'info'
      this.enabled = true
      return true
    } catch {
      this.fail()
      return false
    }
  }

  disable(): void {
    this.enabled = false
    this.transport.level = false
    try {
      this.closeActiveFile()
    } catch {
      this.failed = true
    }
  }

  write(level: MainLogLevel, line: string): boolean {
    if (!this.enabled || this.failed || !isMainLogRecordLine(level, line)) return this.rejectWrite()
    try {
      this.log.processMessage(
        { data: [line], date: new Date(), level },
        { transports: [this.transport as never] }
      )
    } catch {
      this.fail()
    }
    return this.enabled && !this.failed
  }

  private appendLine(line: string): void {
    if (!this.logPath) throw new Error('Main JSONL path is unavailable')
    const encoded = Buffer.from(`${line}\n`, 'utf8')
    this.openActiveFile()
    if (this.activeSize > 0 && this.activeSize + encoded.length > MAX_MAIN_LOG_FILE_BYTES) {
      this.rotate()
      this.openActiveFile()
    }

    if (this.descriptor === undefined) throw new Error('Main JSONL descriptor is unavailable')
    if (this.fs.writeSync(this.descriptor, encoded, 0, encoded.length) !== encoded.length) {
      throw new Error('Main JSONL record was not fully written')
    }
    this.activeSize += encoded.length
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
      0o600
    )
    try {
      const descriptorStat = this.fs.fstatSync(descriptor)
      if (!descriptorStat.isFile()) {
        throw new Error('Main JSONL descriptor is not a regular file')
      }
      this.descriptor = descriptor
      this.activeSize = descriptorStat.size
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
    this.closeActiveFile()
    const activeStat = this.fs.lstatSync(this.logPath)
    if (activeStat.isSymbolicLink() || !activeStat.isFile()) {
      throw new Error('Main JSONL active path is not a regular file')
    }

    const archivePath = path.join(path.dirname(this.logPath), 'main.old.jsonl')
    this.fs.renameSync(this.logPath, archivePath)
  }

  private closeActiveFile(): void {
    const descriptor = this.descriptor
    this.descriptor = undefined
    this.activeSize = 0
    if (descriptor !== undefined) this.fs.closeSync(descriptor)
  }

  private repairIncompleteTail(filePath: string): void {
    try {
      const fileStat = this.fs.lstatSync(filePath)
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
        throw new Error('Main JSONL active path is not a regular file')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    const noFollow = this.fs.constants.O_NOFOLLOW ?? 0
    const descriptor = this.fs.openSync(filePath, this.fs.constants.O_RDWR | noFollow)
    try {
      const descriptorStat = this.fs.fstatSync(descriptor)
      if (!descriptorStat.isFile()) throw new Error('Main JSONL descriptor is not a regular file')
      const size = descriptorStat.size
      if (size === 0) return

      const lastByte = Buffer.allocUnsafe(1)
      if (this.fs.readSync(descriptor, lastByte, 0, 1, size - 1) !== 1) {
        throw new Error('Main JSONL tail could not be read')
      }
      if (lastByte[0] === 0x0a) return

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
        throw new Error('Main JSONL incomplete tail exceeds the maximum record size')
      }
      this.fs.ftruncateSync(descriptor, truncateAt)
    } finally {
      this.fs.closeSync(descriptor)
    }
  }

  private rejectWrite(): false {
    if (this.enabled) this.fail()
    return false
  }

  private fail(): void {
    this.failed = true
    this.enabled = false
    this.transport.level = false
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
