import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import logger from '@shared/logger'
import { getUserShell } from './shellEnvHelper'
import { terminateProcessTree } from './processTree'
import { resolveSessionDir } from './sessionPaths'

// Configuration with environment variable support
const FOREGROUND_PREVIEW_CHARS = 12000

export const getBackgroundExecConfig = () => ({
  backgroundMs: parseInt(process.env.PI_BASH_YIELD_MS || '10000', 10),
  timeoutSec: parseInt(process.env.PI_BASH_TIMEOUT_SEC || '1800', 10),
  cleanupMs: parseInt(process.env.PI_BASH_JOB_TTL_MS || '1800000', 10),
  maxOutputChars:
    parseInt(
      process.env.OPENCLAW_BASH_PENDING_MAX_OUTPUT_CHARS ||
        process.env.PI_BASH_MAX_OUTPUT_CHARS ||
        '500',
      10
    ) || 500,
  offloadThresholdChars: 10000 // Offload to file when output exceeds this
})

const getConfig = getBackgroundExecConfig

export interface SessionMeta {
  sessionId: string
  command: string
  status: 'running' | 'done' | 'error' | 'killed'
  createdAt: number
  lastAccessedAt: number
  pid?: number
  exitCode?: number
  outputLength: number
  offloaded: boolean
  timedOut?: boolean
}

export interface SessionCompletionResult {
  status: 'done' | 'error' | 'killed'
  output: string
  exitCode: number | null
  offloaded: boolean
  outputFilePath?: string
  timedOut: boolean
}

export type WaitForCompletionOrYieldResult =
  | { kind: 'running'; sessionId: string }
  | { kind: 'completed'; result: SessionCompletionResult }

interface BackgroundSession {
  sessionId: string
  conversationId: string
  command: string
  child: ChildProcess
  status: 'running' | 'done' | 'error' | 'killed'
  exitCode?: number
  errorMessage?: string
  createdAt: number
  lastAccessedAt: number
  outputBuffer: string
  outputFilePath: string | null
  outputWriteQueue: Promise<void>
  totalOutputLength: number
  offloadDisabled: boolean
  stdoutEof: boolean
  stderrEof: boolean
  closePromise: Promise<void>
  resolveClose: () => void
  closeSettled: boolean
  killTimeoutId?: NodeJS.Timeout
  timedOut: boolean
}

interface StartSessionResult {
  sessionId: string
  status: 'running'
}

interface PollResult {
  status: 'running' | 'done' | 'error' | 'killed'
  output: string
  exitCode?: number
  offloaded?: boolean
  outputFilePath?: string
  timedOut?: boolean
}

interface LogResult {
  status: 'running' | 'done' | 'error' | 'killed'
  output: string
  totalLength: number
  exitCode?: number
  offloaded?: boolean
  outputFilePath?: string
  timedOut?: boolean
}

export class BackgroundExecSessionManager {
  private sessions = new Map<string, Map<string, BackgroundSession>>()
  private cleanupIntervalId?: NodeJS.Timeout

  constructor() {
    this.startCleanupTimer()
  }

  async start(
    conversationId: string,
    command: string,
    cwd: string,
    options?: {
      timeout?: number
      env?: Record<string, string>
      outputPrefix?: string
    }
  ): Promise<StartSessionResult> {
    const config = getConfig()
    const sessionId = `bg_${nanoid(12)}`
    const { shell, args } = getUserShell()

    const sessionDir = resolveSessionDir(conversationId)
    if (sessionDir) {
      fs.mkdirSync(sessionDir, { recursive: true })
    }

    const outputFilePath = sessionDir
      ? this.createOutputFilePath(sessionDir, sessionId, options?.outputPrefix)
      : null

    const child = spawn(shell, [...args, command], {
      cwd,
      env: { ...process.env, ...options?.env },
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let resolveClose = () => {}
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve
    })

    const now = Date.now()
    const session: BackgroundSession = {
      sessionId,
      conversationId,
      command,
      child,
      status: 'running',
      createdAt: now,
      lastAccessedAt: now,
      outputBuffer: '',
      outputFilePath,
      outputWriteQueue: Promise.resolve(),
      totalOutputLength: 0,
      offloadDisabled: false,
      stdoutEof: false,
      stderrEof: false,
      closePromise,
      resolveClose,
      closeSettled: false,
      timedOut: false
    }

    this.setupOutputHandling(session, config)
    this.setupProcessLifecycle(session)

    const timeout = options?.timeout ?? config.timeoutSec * 1000
    if (timeout > 0) {
      session.killTimeoutId = setTimeout(() => {
        void this.killInternal(session, 'timeout')
      }, timeout)
    }

    if (!this.sessions.has(conversationId)) {
      this.sessions.set(conversationId, new Map())
    }
    this.sessions.get(conversationId)!.set(sessionId, session)

    logger.info(`[BackgroundExec] Started session ${sessionId} for conversation ${conversationId}`)

    return { sessionId, status: 'running' }
  }

  list(conversationId: string): SessionMeta[] {
    const conversationSessions = this.sessions.get(conversationId)
    if (!conversationSessions) return []

    return Array.from(conversationSessions.values()).map((session) => ({
      sessionId: session.sessionId,
      command: session.command,
      status: session.status,
      createdAt: session.createdAt,
      lastAccessedAt: session.lastAccessedAt,
      pid: session.child.pid,
      exitCode: session.exitCode,
      outputLength: session.totalOutputLength,
      offloaded: this.hasPersistedOutput(session, getConfig()),
      timedOut: session.timedOut
    }))
  }

  async poll(conversationId: string, sessionId: string): Promise<PollResult> {
    const session = this.getSession(conversationId, sessionId)
    session.lastAccessedAt = Date.now()
    await this.waitForSessionDrain(session)

    const config = getConfig()
    const isOffloaded = this.hasPersistedOutput(session, config)

    if (isOffloaded && session.outputFilePath) {
      const output = this.getRecentOutputFromSession(session, config.maxOutputChars)
      return {
        status: session.status,
        output,
        exitCode: session.exitCode,
        offloaded: true,
        outputFilePath: session.outputFilePath,
        timedOut: session.timedOut
      }
    }

    const output = this.getRecentOutput(session.outputBuffer, config.maxOutputChars)
    return {
      status: session.status,
      output,
      exitCode: session.exitCode,
      offloaded: false,
      timedOut: session.timedOut
    }
  }

  async log(
    conversationId: string,
    sessionId: string,
    offset = 0,
    limit = 1000
  ): Promise<LogResult> {
    const session = this.getSession(conversationId, sessionId)
    session.lastAccessedAt = Date.now()
    await this.waitForSessionDrain(session)

    const config = getConfig()
    const isOffloaded = this.hasPersistedOutput(session, config)

    let output: string
    if (isOffloaded && session.outputFilePath) {
      output = this.readOutputFromSession(session, offset, limit, config)
    } else {
      output = session.outputBuffer.slice(offset, offset + limit)
    }

    return {
      status: session.status,
      output,
      totalLength: session.totalOutputLength,
      exitCode: session.exitCode,
      offloaded: isOffloaded,
      outputFilePath: session.outputFilePath || undefined,
      timedOut: session.timedOut
    }
  }

  async waitForCompletionOrYield(
    conversationId: string,
    sessionId: string,
    yieldMs = getConfig().backgroundMs
  ): Promise<WaitForCompletionOrYieldResult> {
    const session = this.getSession(conversationId, sessionId)
    session.lastAccessedAt = Date.now()

    if (session.status !== 'running') {
      return {
        kind: 'completed',
        result: await this.getCompletionResult(conversationId, sessionId)
      }
    }

    let yieldTimer: NodeJS.Timeout | null = null

    try {
      await Promise.race([
        session.closePromise,
        new Promise((resolve) => {
          yieldTimer = setTimeout(resolve, Math.max(0, yieldMs))
        })
      ])
    } finally {
      if (yieldTimer) {
        clearTimeout(yieldTimer)
      }
    }

    if (session.status !== 'running') {
      return {
        kind: 'completed',
        result: await this.getCompletionResult(conversationId, sessionId)
      }
    }

    return {
      kind: 'running',
      sessionId
    }
  }

  async getCompletionResult(
    conversationId: string,
    sessionId: string,
    previewChars = FOREGROUND_PREVIEW_CHARS
  ): Promise<SessionCompletionResult> {
    const session = this.getSession(conversationId, sessionId)
    session.lastAccessedAt = Date.now()
    await this.waitForSessionDrain(session)
    return this.buildCompletionResult(session, previewChars)
  }

  write(conversationId: string, sessionId: string, data: string, eof = false): void {
    const session = this.getSession(conversationId, sessionId)

    if (session.status !== 'running') {
      throw new Error(`Session ${sessionId} is not running`)
    }

    if (!session.child.stdin || session.child.stdin.destroyed) {
      throw new Error(`Session ${sessionId} stdin is not available`)
    }

    session.child.stdin.write(data)
    if (eof) {
      session.child.stdin.end()
    }

    session.lastAccessedAt = Date.now()
  }

  async kill(conversationId: string, sessionId: string): Promise<void> {
    const session = this.getSession(conversationId, sessionId)
    await this.killInternal(session, 'user')
  }

  clear(conversationId: string, sessionId: string): void {
    const session = this.getSession(conversationId, sessionId)

    session.outputBuffer = ''
    session.totalOutputLength = 0

    if (session.outputFilePath) {
      this.queueOutputWrite(session, '', 'truncate')
    }

    session.lastAccessedAt = Date.now()
  }

  async remove(conversationId: string, sessionId: string): Promise<void> {
    const conversationSessions = this.sessions.get(conversationId)
    if (!conversationSessions) {
      throw new Error(`No sessions found for conversation ${conversationId}`)
    }

    const session = conversationSessions.get(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    if (session.status === 'running') {
      await this.killInternal(session, 'remove')
    } else {
      await session.closePromise
    }

    await session.outputWriteQueue.catch((error) => {
      logger.warn('[BackgroundExec] Failed while draining output write queue:', error)
    })

    if (session.outputFilePath && fs.existsSync(session.outputFilePath)) {
      try {
        fs.unlinkSync(session.outputFilePath)
      } catch (error) {
        logger.warn(
          `[BackgroundExec] Failed to remove output file ${session.outputFilePath}:`,
          error
        )
      }
    }

    if (session.killTimeoutId) {
      clearTimeout(session.killTimeoutId)
    }

    conversationSessions.delete(sessionId)
    if (conversationSessions.size === 0) {
      this.sessions.delete(conversationId)
    }

    logger.info(`[BackgroundExec] Removed session ${sessionId}`)
  }

  async cleanupConversation(conversationId: string): Promise<void> {
    const conversationSessions = this.sessions.get(conversationId)
    if (!conversationSessions) return

    const sessionIds = Array.from(conversationSessions.keys())
    await Promise.all(sessionIds.map((id) => this.remove(conversationId, id).catch(() => {})))
  }

  async shutdown(): Promise<void> {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId)
    }

    const allSessions: Array<{ conversationId: string; sessionId: string }> = []
    for (const [conversationId, sessions] of this.sessions) {
      for (const sessionId of sessions.keys()) {
        allSessions.push({ conversationId, sessionId })
      }
    }

    await Promise.all(
      allSessions.map(({ conversationId, sessionId }) =>
        this.remove(conversationId, sessionId).catch(() => {})
      )
    )
  }

  private getSession(conversationId: string, sessionId: string): BackgroundSession {
    const conversationSessions = this.sessions.get(conversationId)
    if (!conversationSessions) {
      throw new Error(`No sessions found for conversation ${conversationId}`)
    }

    const session = conversationSessions.get(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    return session
  }

  private setupOutputHandling(
    session: BackgroundSession,
    config: ReturnType<typeof getConfig>
  ): void {
    const stdoutHandler = (data: Buffer) => {
      this.appendOutput(session, data.toString('utf-8'), config)
    }

    const stderrHandler = (data: Buffer) => {
      this.appendOutput(session, data.toString('utf-8'), config)
    }

    session.child.stdout?.on('data', stdoutHandler)
    session.child.stderr?.on('data', stderrHandler)

    session.child.stdout?.on('end', () => {
      session.stdoutEof = true
    })

    session.child.stderr?.on('end', () => {
      session.stderrEof = true
    })
  }

  private appendOutput(
    session: BackgroundSession,
    data: string,
    config: ReturnType<typeof getConfig>
  ): void {
    session.totalOutputLength += data.length

    const shouldOffload =
      !session.offloadDisabled &&
      session.outputFilePath !== null &&
      session.totalOutputLength > config.offloadThresholdChars

    if (shouldOffload) {
      const chunk = session.outputBuffer + data
      session.outputBuffer = ''
      this.queueOutputWrite(session, chunk, 'append')
    } else {
      session.outputBuffer += data
    }
  }

  private setupProcessLifecycle(session: BackgroundSession): void {
    session.child.on('error', (error) => {
      if (session.status === 'running') {
        session.status = 'error'
      }
      session.errorMessage = error.message
      logger.error(`[BackgroundExec] Session ${session.sessionId} error:`, error)
      queueMicrotask(() => {
        if (!session.closeSettled && session.exitCode === undefined) {
          void this.finalizeSession(session, null, null)
        }
      })
    })

    session.child.on('close', (code, signal) => {
      if (session.killTimeoutId) {
        clearTimeout(session.killTimeoutId)
      }

      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        session.status = 'killed'
      } else if (code !== 0 && code !== null) {
        session.status = 'error'
      } else {
        session.status = 'done'
      }

      session.exitCode = code ?? undefined
      void this.finalizeSession(session, code, signal)
    })
  }

  private async killInternal(session: BackgroundSession, reason: string): Promise<void> {
    if (session.status !== 'running') return

    logger.info(`[BackgroundExec] Killing session ${session.sessionId} (reason: ${reason})`)

    if (session.killTimeoutId) {
      clearTimeout(session.killTimeoutId)
    }

    if (reason === 'timeout') {
      session.timedOut = true
    }
    session.status = 'killed'

    const closed = await terminateProcessTree(session.child, { graceMs: 2000 })
    if (!closed && !session.closeSettled) {
      session.exitCode = undefined
      await this.finalizeSession(session, null, 'SIGKILL')
    }

    await session.closePromise
  }

  private getRecentOutput(buffer: string, maxChars: number): string {
    if (buffer.length <= maxChars) return buffer
    return buffer.slice(-maxChars)
  }

  private hasPersistedOutput(
    session: BackgroundSession,
    config: ReturnType<typeof getConfig>
  ): boolean {
    return (
      session.outputFilePath !== null && session.totalOutputLength > config.offloadThresholdChars
    )
  }

  private getPersistedOutputLength(
    session: BackgroundSession,
    config: ReturnType<typeof getConfig>
  ): number {
    if (!this.hasPersistedOutput(session, config)) {
      return 0
    }

    return Math.max(0, session.totalOutputLength - session.outputBuffer.length)
  }

  private getRecentOutputFromSession(session: BackgroundSession, maxChars: number): string {
    if (!session.outputFilePath) {
      return this.getRecentOutput(session.outputBuffer, maxChars)
    }

    const filePreview = this.readLastCharsFromFile(session.outputFilePath, maxChars)
    if (!session.outputBuffer) {
      return filePreview
    }

    return this.getRecentOutput(filePreview + session.outputBuffer, maxChars)
  }

  private readOutputFromSession(
    session: BackgroundSession,
    offset: number,
    limit: number,
    config: ReturnType<typeof getConfig>
  ): string {
    if (!session.outputFilePath) {
      return session.outputBuffer.slice(offset, offset + limit)
    }

    const persistedLength = this.getPersistedOutputLength(session, config)
    if (persistedLength <= 0) {
      return session.outputBuffer.slice(offset, offset + limit)
    }

    if (offset >= persistedLength) {
      const bufferOffset = offset - persistedLength
      return session.outputBuffer.slice(bufferOffset, bufferOffset + limit)
    }

    const fileLimit = Math.min(limit, persistedLength - offset)
    const persistedOutput = this.readFromFile(session.outputFilePath, offset, fileLimit)
    if (persistedOutput.length >= limit) {
      return persistedOutput
    }

    const remaining = limit - persistedOutput.length
    return persistedOutput + session.outputBuffer.slice(0, remaining)
  }

  private readLastCharsFromFile(filePath: string, maxChars: number): string {
    try {
      const stats = fs.statSync(filePath)
      const fileSize = stats.size
      const bytesToRead = Math.min(maxChars * 4, fileSize)
      const startPosition = Math.max(0, fileSize - bytesToRead)

      const fd = fs.openSync(filePath, 'r')
      try {
        const buffer = Buffer.alloc(bytesToRead)
        fs.readSync(fd, buffer, 0, bytesToRead, startPosition)
        const content = buffer.toString('utf-8')
        if (startPosition > 0 && content.length > 0) {
          const firstNewline = content.indexOf('\n')
          if (firstNewline > 0) {
            return content.slice(firstNewline + 1)
          }
        }
        return content
      } finally {
        fs.closeSync(fd)
      }
    } catch (error) {
      logger.warn('[BackgroundExec] Failed to read from output file:', error)
      return ''
    }
  }

  private readFromFile(filePath: string, offset: number, limit: number): string {
    try {
      const safeOffset = Math.max(0, Math.floor(offset))
      const safeLimit = Math.max(0, Math.floor(limit))
      if (safeLimit === 0) {
        return ''
      }

      const fd = fs.openSync(filePath, 'r')
      try {
        const fileSize = fs.fstatSync(fd).size
        if (fileSize === 0) {
          return ''
        }

        const { startByte, endByte } = this.resolveUtf8ByteRange(
          fd,
          fileSize,
          safeOffset,
          safeLimit
        )
        if (endByte <= startByte) {
          return ''
        }

        const bytesToRead = endByte - startByte
        const buffer = Buffer.alloc(bytesToRead)
        const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, startByte)
        if (bytesRead <= 0) {
          return ''
        }
        return buffer.subarray(0, bytesRead).toString('utf-8')
      } finally {
        fs.closeSync(fd)
      }
    } catch (error) {
      logger.warn('[BackgroundExec] Failed to read from output file:', error)
      return ''
    }
  }

  private queueOutputWrite(
    session: BackgroundSession,
    data: string,
    mode: 'append' | 'truncate'
  ): void {
    if (!session.outputFilePath) {
      if (mode === 'append' && data) {
        session.outputBuffer += data
      }
      return
    }

    if (mode === 'append' && session.offloadDisabled) {
      if (data) {
        session.outputBuffer += data
      }
      return
    }

    const outputFilePath = session.outputFilePath
    session.outputWriteQueue = session.outputWriteQueue
      .then(async () => {
        if (mode === 'truncate') {
          await fs.promises.writeFile(outputFilePath, data, 'utf-8')
          return
        }
        if (data.length === 0) {
          return
        }
        await fs.promises.appendFile(outputFilePath, data, 'utf-8')
      })
      .catch((error) => {
        logger.warn(`[BackgroundExec] Failed to write output file (${mode}):`, error)
        if (mode === 'append' && data.length > 0) {
          session.offloadDisabled = true
          session.outputBuffer += data
        }
      })
  }

  private async waitForSessionDrain(session: BackgroundSession): Promise<void> {
    if (session.status === 'running') {
      return
    }

    await session.closePromise
  }

  private async finalizeSession(
    session: BackgroundSession,
    code: number | null,
    signal: NodeJS.Signals | null
  ): Promise<void> {
    try {
      await session.outputWriteQueue.catch((error) => {
        logger.warn('[BackgroundExec] Failed while draining output queue:', error)
      })
    } finally {
      if (!session.closeSettled) {
        session.closeSettled = true
        session.resolveClose()
      }
    }

    logger.info(
      `[BackgroundExec] Session ${session.sessionId} closed with code ${code}, signal ${signal}`
    )
  }

  private buildCompletionResult(
    session: BackgroundSession,
    previewChars: number
  ): SessionCompletionResult {
    const config = getConfig()
    const offloaded = this.hasPersistedOutput(session, config)
    const output =
      offloaded && session.outputFilePath
        ? this.getRecentOutputFromSession(session, previewChars)
        : this.getRecentOutput(session.outputBuffer, previewChars)

    return {
      status: session.status === 'running' ? 'killed' : session.status,
      output,
      exitCode: session.exitCode ?? null,
      offloaded,
      outputFilePath: session.outputFilePath || undefined,
      timedOut: session.timedOut
    }
  }

  private createOutputFilePath(
    sessionDir: string,
    sessionId: string,
    outputPrefix?: string
  ): string {
    const rawPrefix = outputPrefix?.trim() || 'bgexec'
    const safePrefix = rawPrefix.replace(/[^a-zA-Z0-9_-]/g, '_')
    return path.join(sessionDir, `${safePrefix}_${sessionId}.log`)
  }

  private resolveUtf8ByteRange(
    fd: number,
    fileSize: number,
    offset: number,
    limit: number
  ): { startByte: number; endByte: number } {
    const targetStart = offset
    const targetEnd = offset + limit
    let startByte = targetStart === 0 ? 0 : -1
    let endByte = -1
    let charCount = 0
    let currentBytePos = 0

    const chunkSize = 64 * 1024
    const chunkBuffer = Buffer.alloc(chunkSize)

    while (currentBytePos < fileSize && endByte === -1) {
      const bytesToRead = Math.min(chunkSize, fileSize - currentBytePos)
      const bytesRead = fs.readSync(fd, chunkBuffer, 0, bytesToRead, currentBytePos)
      if (bytesRead <= 0) {
        break
      }

      for (let i = 0; i < bytesRead; i++) {
        const byte = chunkBuffer[i]
        if ((byte & 0xc0) !== 0x80) {
          const absoluteBytePos = currentBytePos + i
          if (startByte === -1 && charCount === targetStart) {
            startByte = absoluteBytePos
          }
          if (charCount === targetEnd) {
            endByte = absoluteBytePos
            break
          }
          charCount++
        }
      }

      currentBytePos += bytesRead
    }

    if (startByte === -1) {
      startByte = fileSize
    }
    if (endByte === -1) {
      endByte = fileSize
    }
    if (endByte < startByte) {
      endByte = startByte
    }

    return { startByte, endByte }
  }

  private startCleanupTimer(): void {
    this.cleanupIntervalId = setInterval(
      () => {
        this.runCleanup()
      },
      5 * 60 * 1000
    )
  }

  private runCleanup(): void {
    const config = getConfig()
    const now = Date.now()
    const expiredSessions: Array<{ conversationId: string; sessionId: string }> = []

    for (const [conversationId, sessions] of this.sessions) {
      for (const [sessionId, session] of sessions) {
        if (now - session.lastAccessedAt > config.cleanupMs) {
          expiredSessions.push({ conversationId, sessionId })
        } else if (session.status !== 'running' && now - session.lastAccessedAt > 5 * 60 * 1000) {
          expiredSessions.push({ conversationId, sessionId })
        }
      }
    }

    for (const { conversationId, sessionId } of expiredSessions) {
      logger.info(`[BackgroundExec] Auto-removing expired session ${sessionId}`)
      void this.remove(conversationId, sessionId).catch((error) => {
        logger.warn('[BackgroundExec] Failed to remove expired session:', error)
      })
    }
  }
}

export const backgroundExecSessionManager = new BackgroundExecSessionManager()
