import type {
  MainLogEventInputMap,
  MainLogEventName,
  MainLogLevel,
  MainLogContext
} from './mainLogEvents'
import { projectMainLogEvent } from './mainLogEvents'

export interface MainLogRecordV1 {
  v: 1
  ts: string
  seq: number
  level: MainLogLevel
  event: MainLogEventName
  process: 'main'
  processInstanceId: string
  appVersion: string
  context: MainLogContext
}

export interface MainLogPersistence {
  enable(): boolean
  disable(): void
  write(level: MainLogLevel, line: string): MainLogWriteResult
}

export type MainLogWriteResult = 'written' | 'rejected' | 'failed'

export type MainLogInternalWarning =
  | 'event_rejected'
  | 'record_oversized'
  | 'record_rejected'
  | 'persistence_failed'

interface BufferedMainLogRecord {
  seq: number
  level: MainLogLevel
  line: string
  bytes: number
}

export interface MainLoggerOptions {
  persistence: MainLogPersistence
  appVersion: string
  processInstanceId: string
  now?: () => Date
  writeConsole?: (level: MainLogLevel, text: string) => void
  warn?: (warning: MainLogInternalWarning) => void
}

const MAIN_LOG_RECORD_VERSION = 1 as const
export const MAX_MAIN_LOG_RECORD_BYTES = 16 * 1024
const MAX_STARTUP_BUFFER_RECORDS = 64
const MAX_STARTUP_BUFFER_BYTES = 64 * 1024

type PersistenceState = 'unknown' | 'enabled' | 'disabled'

export class MainLogger {
  private persistenceState: PersistenceState = 'unknown'
  private sequence = 0
  private readonly startupBuffer: BufferedMainLogRecord[] = []
  private startupBufferBytes = 0
  private startupDropped = 0
  private reportingRecordDrop = false
  private readonly emittedWarnings = new Set<MainLogInternalWarning>()
  private readonly now: () => Date
  private readonly writeConsole: ((level: MainLogLevel, text: string) => void) | undefined
  private readonly warn: (warning: MainLogInternalWarning) => void

  constructor(private readonly options: MainLoggerOptions) {
    this.now = options.now ?? (() => new Date())
    this.writeConsole = options.writeConsole
    this.warn = options.warn ?? (() => undefined)
  }

  isOutputEnabled(): boolean {
    return this.persistenceState !== 'disabled' || this.writeConsole !== undefined
  }

  emit<TEvent extends MainLogEventName>(event: TEvent, input: MainLogEventInputMap[TEvent]): void {
    if (!this.isOutputEnabled()) return

    try {
      const projected = projectMainLogEvent(event, input)
      this.writeConsoleSafely(projected.level, event, projected.context)
      if (this.persistenceState === 'disabled') return

      const seq = this.nextSequence()
      const record: MainLogRecordV1 = {
        v: MAIN_LOG_RECORD_VERSION,
        ts: this.now().toISOString(),
        seq,
        level: projected.level,
        event,
        process: 'main',
        processInstanceId: this.options.processInstanceId,
        appVersion: this.options.appVersion,
        context: projected.context
      }
      const line = JSON.stringify(record)
      const bytes = Buffer.byteLength(line, 'utf8') + 1

      if (bytes > MAX_MAIN_LOG_RECORD_BYTES) {
        this.warnOnce('record_oversized')
        this.reportRecordDrop(seq, 'record_oversized')
        return
      }

      if (this.persistenceState === 'unknown') {
        this.buffer({ seq, level: projected.level, line, bytes })
        return
      }
      if (this.persistenceState === 'enabled') {
        const result = this.persist({ seq, level: projected.level, line, bytes })
        if (result === 'rejected') this.reportRecordDrop(seq, 'record_rejected')
      }
    } catch {
      this.warnOnce('event_rejected')
    }
  }

  setPersistenceEnabled(enabled: boolean): void {
    if (!enabled) {
      this.disablePersistence()
      return
    }
    if (this.persistenceState === 'enabled') return

    let persistenceReady = false
    try {
      persistenceReady = this.options.persistence.enable()
    } catch {
      persistenceReady = false
    }
    if (!persistenceReady) {
      this.failPersistence()
      return
    }

    this.persistenceState = 'enabled'
    const buffered = this.startupBuffer.splice(0)
    const dropped = this.startupDropped
    this.startupBufferBytes = 0
    this.startupDropped = 0

    const rejectedSequences: number[] = []
    for (const record of buffered) {
      const result = this.persist(record)
      if (result === 'failed') return
      if (result === 'rejected') rejectedSequences.push(record.seq)
    }
    for (const seq of rejectedSequences) {
      if (this.persistenceState !== 'enabled') return
      this.reportRecordDrop(seq, 'record_rejected')
    }
    if (dropped > 0 && this.persistenceState === 'enabled') {
      this.emit('logging.startup_buffer.dropped', { droppedCount: dropped })
    }
  }

  private nextSequence(): number {
    if (this.sequence >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Main log sequence is exhausted')
    }
    this.sequence += 1
    return this.sequence
  }

  private buffer(record: BufferedMainLogRecord): void {
    this.startupBuffer.push(record)
    this.startupBufferBytes += record.bytes
    while (
      this.startupBuffer.length > MAX_STARTUP_BUFFER_RECORDS ||
      this.startupBufferBytes > MAX_STARTUP_BUFFER_BYTES
    ) {
      const removed = this.startupBuffer.shift()
      if (!removed) break
      this.startupBufferBytes -= removed.bytes
      this.startupDropped += 1
    }
  }

  private persist(record: BufferedMainLogRecord): MainLogWriteResult {
    try {
      const result = this.options.persistence.write(record.level, record.line)
      if (result === 'written') return result
      if (result === 'rejected') {
        this.warnOnce('record_rejected')
        return result
      }
    } catch {
      // Persistence is best-effort and must not affect application behavior.
    }
    this.failPersistence()
    return 'failed'
  }

  private reportRecordDrop(
    recordSeq: number,
    reason: 'record_oversized' | 'record_rejected'
  ): void {
    if (this.reportingRecordDrop) return
    this.reportingRecordDrop = true
    try {
      this.emit('logging.record.dropped', { recordSeq, reason })
    } finally {
      this.reportingRecordDrop = false
    }
  }

  private disablePersistence(): void {
    this.persistenceState = 'disabled'
    this.startupBuffer.splice(0)
    this.startupBufferBytes = 0
    this.startupDropped = 0
    try {
      this.options.persistence.disable()
    } catch {
      // Disabling diagnostics is fail-closed even if the transport rejects the request.
    }
  }

  private failPersistence(): void {
    this.disablePersistence()
    this.warnOnce('persistence_failed')
  }

  private writeConsoleSafely(
    level: MainLogLevel,
    event: MainLogEventName,
    context: MainLogContext
  ): void {
    if (!this.writeConsole) return
    try {
      this.writeConsole(level, `[main] ${event} ${JSON.stringify(context)}`)
    } catch {
      // Console diagnostics must never affect event persistence or application behavior.
    }
  }

  private warnOnce(warning: MainLogInternalWarning): void {
    if (this.emittedWarnings.has(warning)) return
    this.emittedWarnings.add(warning)
    try {
      this.warn(warning)
    } catch {
      // Logger-internal warnings are intentionally fail-open and payload-free.
    }
  }
}
