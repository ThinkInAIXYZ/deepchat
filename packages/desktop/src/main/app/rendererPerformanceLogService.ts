import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { SettingsStore } from '@/config/settingsStore'
import {
  RendererPerformanceRecordSchema,
  type RendererPerformanceRecord
} from '@shared/contracts/routes'

type PersistedRendererPerformanceRecord = RendererPerformanceRecord & {
  recordedAt: number
}

type RendererPerformanceLogFs = Pick<
  typeof fs,
  'appendFile' | 'mkdir' | 'rename' | 'stat' | 'unlink'
>

const MAX_RENDERER_PERFORMANCE_LOG_BYTES = 10 * 1024 * 1024

/**
 * App-local persistence for renderer timing diagnostics. Input is parsed again at this boundary so
 * renderer code can never turn the local performance file into a general-purpose log sink.
 */
export class RendererPerformanceLogService {
  private writeQueue: Promise<boolean> = Promise.resolve(true)

  constructor(
    private readonly settings: Pick<SettingsStore, 'get'>,
    private readonly getUserDataPath: () => string = () => app.getPath('userData'),
    private readonly fsImpl: RendererPerformanceLogFs = fs,
    private readonly now: () => number = Date.now,
    private readonly onWriteError: () => void = () => {
      console.warn('[RendererPerformance] Failed to persist diagnostic record')
    }
  ) {}

  async record(rawRecord: unknown): Promise<boolean> {
    if (!this.settings.get<boolean>('loggingEnabled')) {
      return false
    }

    const parsed = RendererPerformanceRecordSchema.safeParse(rawRecord)
    if (!parsed.success) {
      return false
    }

    const record: PersistedRendererPerformanceRecord = {
      ...parsed.data,
      recordedAt: this.now()
    }
    const line = `${JSON.stringify(record)}\n`
    const logDirectory = path.join(this.getUserDataPath(), 'logs')
    const logPath = path.join(logDirectory, 'renderer-performance.ndjson')

    const write = async (): Promise<boolean> => {
      try {
        await this.fsImpl.mkdir(logDirectory, { recursive: true })
        await this.rotateIfNeeded(logPath, Buffer.byteLength(line, 'utf-8'))
        await this.fsImpl.appendFile(logPath, line, 'utf-8')
        return true
      } catch {
        this.onWriteError()
        return false
      }
    }

    this.writeQueue = this.writeQueue.then(write, write)
    return await this.writeQueue
  }

  private async rotateIfNeeded(logPath: string, incomingBytes: number): Promise<void> {
    try {
      const { size } = await this.fsImpl.stat(logPath)
      if (size + incomingBytes <= MAX_RENDERER_PERFORMANCE_LOG_BYTES) {
        return
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return
      }
      throw error
    }

    const previousLogPath = `${logPath}.old`
    try {
      await this.fsImpl.unlink(previousLogPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
    await this.fsImpl.rename(logPath, previousLogPath)
  }
}
