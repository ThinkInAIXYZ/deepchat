import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { UtilityProcess } from 'electron'
import { nanoid } from 'nanoid'
import logger from './backgroundExecLogger'
import { getUserShell } from './shellEnvHelper'
import {
  createUtf8OutputDecoderPair,
  prepareShellCommandForUtf8Output
} from './shellOutputEncoding'
import { describeSpawnFailure, resolveUsableSpawnCwd } from './spawnGuard'
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
  cwd: string
  shell: string
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
  flushOutputDecoders?: () => void
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

export type BackgroundExecRpcMethod =
  | 'start'
  | 'list'
  | 'poll'
  | 'log'
  | 'waitForCompletionOrYield'
  | 'getCompletionResult'
  | 'write'
  | 'kill'
  | 'clear'
  | 'remove'
  | 'cleanupConversation'
  | 'shutdown'

export interface BackgroundExecRpcRequest {
  type: 'background-exec:request'
  id: string
  method: BackgroundExecRpcMethod
  args: unknown[]
}

export type BackgroundExecRpcResponse =
  | {
      type: 'background-exec:response'
      id: string
      ok: true
      data: unknown
    }
  | {
      type: 'background-exec:response'
      id: string
      ok: false
      error: {
        message: string
        stack?: string
      }
    }

interface TrackedSessionMeta {
  conversationId: string
  sessionId: string
  command: string
  createdAt: number
  lastAccessedAt: number
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
    const shellCommand = prepareShellCommandForUtf8Output(shell, command)
    const spawnCwd = resolveUsableSpawnCwd(cwd)

    const sessionDir = resolveSessionDir(conversationId)
    if (sessionDir) {
      fs.mkdirSync(sessionDir, { recursive: true })
    }

    const outputFilePath = sessionDir
      ? this.createOutputFilePath(sessionDir, sessionId, options?.outputPrefix)
      : null

    const child = spawn(shell, [...args, shellCommand], {
      cwd: spawnCwd,
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
      cwd: spawnCwd,
      shell,
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
    const outputDecoders = createUtf8OutputDecoderPair((data) =>
      this.appendOutput(session, data, config)
    )
    session.flushOutputDecoders = outputDecoders.flush

    const stdoutHandler = (data: Buffer | string) => {
      outputDecoders.writeStdout(data)
    }

    const stderrHandler = (data: Buffer | string) => {
      outputDecoders.writeStderr(data)
    }

    session.child.stdout?.on('data', stdoutHandler)
    session.child.stderr?.on('data', stderrHandler)

    session.child.stdout?.on('end', () => {
      outputDecoders.flushStdout()
      session.stdoutEof = true
    })

    session.child.stderr?.on('end', () => {
      outputDecoders.flushStderr()
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
      const errorMessage = describeSpawnFailure(error, {
        shell: session.shell,
        cwd: session.cwd
      })
      session.errorMessage = errorMessage
      this.appendOutput(session, `${errorMessage}\n`, getConfig())
      logger.error(`[BackgroundExec] Session ${session.sessionId} error:`, {
        error,
        cwd: session.cwd,
        shell: session.shell
      })
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
      session.flushOutputDecoders?.()
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

class BackgroundExecUtilityProxy {
  private host: UtilityProcess | null = null
  private hostReady: Promise<UtilityProcess> | null = null
  private requestId = 0
  private shuttingDown = false
  private readonly pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: unknown) => void
    }
  >()
  private readonly activeSessions = new Map<string, TrackedSessionMeta>()
  private readonly crashedSessions = new Map<string, TrackedSessionMeta>()

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
    const result = await this.request<StartSessionResult>('start', [
      conversationId,
      command,
      cwd,
      options
    ])
    this.activeSessions.set(result.sessionId, {
      conversationId,
      sessionId: result.sessionId,
      command,
      createdAt: Date.now(),
      lastAccessedAt: Date.now()
    })
    return result
  }

  async list(conversationId: string): Promise<SessionMeta[]> {
    const active = Array.from(this.activeSessions.values())
      .filter((session) => session.conversationId === conversationId)
      .map((session) => this.toActiveSessionMeta(session))
    const hostSessions = this.host
      ? await this.request<SessionMeta[]>('list', [conversationId]).catch((error) => {
          logger.warn('[BackgroundExecProxy] Failed to list utility sessions:', error)
          return active
        })
      : active
    const crashed = Array.from(this.crashedSessions.values())
      .filter((session) => session.conversationId === conversationId)
      .map((session) => this.toCrashedSessionMeta(session))

    const sessionIds = new Set<string>()
    return [...hostSessions, ...crashed].filter((session) => {
      if (sessionIds.has(session.sessionId)) {
        return false
      }
      sessionIds.add(session.sessionId)
      return true
    })
  }

  async poll(conversationId: string, sessionId: string): Promise<PollResult> {
    const crashed = this.getCrashedSession(conversationId, sessionId)
    if (crashed) {
      return this.toCrashedPollResult(crashed)
    }
    const result = await this.request<PollResult>('poll', [conversationId, sessionId])
    this.touchOrCompleteSession(conversationId, sessionId, result.status)
    return result
  }

  async log(
    conversationId: string,
    sessionId: string,
    offset = 0,
    limit = 1000
  ): Promise<LogResult> {
    const crashed = this.getCrashedSession(conversationId, sessionId)
    if (crashed) {
      return {
        ...this.toCrashedPollResult(crashed),
        totalLength: this.crashMessage(crashed).length
      }
    }
    const result = await this.request<LogResult>('log', [conversationId, sessionId, offset, limit])
    this.touchOrCompleteSession(conversationId, sessionId, result.status)
    return result
  }

  async waitForCompletionOrYield(
    conversationId: string,
    sessionId: string,
    yieldMs = getConfig().backgroundMs
  ): Promise<WaitForCompletionOrYieldResult> {
    const crashed = this.getCrashedCompletionResult(conversationId, sessionId)
    if (crashed) {
      return {
        kind: 'completed',
        result: crashed
      }
    }

    const result = await this.request<WaitForCompletionOrYieldResult>('waitForCompletionOrYield', [
      conversationId,
      sessionId,
      yieldMs
    ])
    if (result.kind === 'completed') {
      this.activeSessions.delete(sessionId)
    }
    return result
  }

  async getCompletionResult(
    conversationId: string,
    sessionId: string,
    previewChars = FOREGROUND_PREVIEW_CHARS
  ): Promise<SessionCompletionResult> {
    const crashed = this.getCrashedCompletionResult(conversationId, sessionId)
    if (crashed) {
      return crashed
    }

    const result = await this.request<SessionCompletionResult>('getCompletionResult', [
      conversationId,
      sessionId,
      previewChars
    ])
    this.activeSessions.delete(sessionId)
    return result
  }

  async write(conversationId: string, sessionId: string, data: string, eof = false): Promise<void> {
    await this.request('write', [conversationId, sessionId, data, eof])
  }

  async kill(conversationId: string, sessionId: string): Promise<void> {
    await this.request('kill', [conversationId, sessionId])
  }

  async clear(conversationId: string, sessionId: string): Promise<void> {
    await this.request('clear', [conversationId, sessionId])
  }

  async remove(conversationId: string, sessionId: string): Promise<void> {
    this.activeSessions.delete(sessionId)
    if (this.getCrashedSession(conversationId, sessionId)) {
      this.crashedSessions.delete(sessionId)
      return
    }
    await this.request('remove', [conversationId, sessionId])
  }

  async cleanupConversation(conversationId: string): Promise<void> {
    for (const [sessionId, session] of this.activeSessions) {
      if (session.conversationId === conversationId) {
        this.activeSessions.delete(sessionId)
      }
    }
    for (const [sessionId, session] of this.crashedSessions) {
      if (session.conversationId === conversationId) {
        this.crashedSessions.delete(sessionId)
      }
    }
    await this.request('cleanupConversation', [conversationId])
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    try {
      if (this.host) {
        await this.request('shutdown', [])
      }
    } finally {
      this.host?.kill()
      this.host = null
      this.hostReady = null
      this.rejectPendingRequests(new Error('Background exec utility process shut down.'))
      this.activeSessions.clear()
    }
  }

  private async request<T = void>(method: BackgroundExecRpcMethod, args: unknown[]): Promise<T> {
    const host = await this.ensureHost()
    const id = `exec_rpc_${++this.requestId}`

    return await new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as T),
        reject
      })

      const payload: BackgroundExecRpcRequest = {
        type: 'background-exec:request',
        id,
        method,
        args
      }

      try {
        host.postMessage(payload)
      } catch (error) {
        this.pendingRequests.delete(id)
        reject(error)
      }
    })
  }

  private async ensureHost(): Promise<UtilityProcess> {
    if (this.host) {
      return this.host
    }
    if (this.hostReady) {
      return await this.hostReady
    }

    this.shuttingDown = false
    this.hostReady = this.startHost()
    try {
      return await this.hostReady
    } finally {
      this.hostReady = null
    }
  }

  private async startHost(): Promise<UtilityProcess> {
    const { app, utilityProcess } = await import('electron')
    const modulePath = this.resolveUtilityHostEntryPoint(app.getAppPath())
    const host = utilityProcess.fork(modulePath, ['--deepchat-exec-utility-host'], {
      serviceName: 'DeepChat Exec Utility',
      stdio: 'ignore',
      env: {
        ...process.env,
        DEEPCHAT_EXEC_UTILITY_HOST: '1'
      }
    })

    host.on('message', (message) => this.handleHostMessage(message))
    host.on('exit', (code) => this.handleHostExit(code))
    host.on('error', (type, location) => {
      logger.error('[BackgroundExecProxy] Utility process error:', { type, location })
    })

    return await new Promise<UtilityProcess>((resolve, reject) => {
      let settled = false
      const settle = (callback: () => void) => {
        if (settled) {
          return
        }
        settled = true
        host.off('spawn', onSpawn)
        host.off('exit', onExit)
        callback()
      }
      const onSpawn = () => {
        settle(() => {
          this.host = host
          resolve(host)
        })
      }
      const onExit = (code: number) => {
        settle(() => {
          reject(new Error(`Background exec utility process exited before spawn: ${code}`))
        })
      }

      host.once('spawn', onSpawn)
      host.once('exit', onExit)
    })
  }

  private resolveUtilityHostEntryPoint(appPath?: string): string {
    const modulePath = fileURLToPath(import.meta.url)
    const candidates = [
      ...(appPath
        ? [
            path.join(appPath, 'out/main/backgroundExecUtilityHost.js'),
            path.join(appPath, 'backgroundExecUtilityHost.js')
          ]
        : []),
      path.resolve(path.dirname(modulePath), 'backgroundExecUtilityHost.js'),
      path.resolve(path.dirname(modulePath), '../backgroundExecUtilityHost.js'),
      path.resolve(process.cwd(), 'out/main/backgroundExecUtilityHost.js')
    ]
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
  }

  private handleHostMessage(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return
    }
    const response = message as BackgroundExecRpcResponse
    if (response.type !== 'background-exec:response') {
      return
    }
    const pending = this.pendingRequests.get(response.id)
    if (!pending) {
      return
    }
    this.pendingRequests.delete(response.id)
    if (response.ok) {
      pending.resolve(response.data)
      return
    }
    const error = new Error(response.error.message)
    if (response.error.stack) {
      error.stack = response.error.stack
    }
    pending.reject(error)
  }

  private handleHostExit(code: number): void {
    const error = new Error(`Background exec utility process exited with code ${code}.`)
    if (!this.shuttingDown) {
      for (const session of this.activeSessions.values()) {
        this.crashedSessions.set(session.sessionId, {
          ...session,
          lastAccessedAt: Date.now()
        })
      }
    }
    this.host = null
    this.hostReady = null
    this.activeSessions.clear()
    this.rejectPendingRequests(error)
  }

  private rejectPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error)
    }
    this.pendingRequests.clear()
  }

  private getCrashedSession(conversationId: string, sessionId: string): TrackedSessionMeta | null {
    const session = this.crashedSessions.get(sessionId)
    return session?.conversationId === conversationId ? session : null
  }

  private getCrashedCompletionResult(
    conversationId: string,
    sessionId: string
  ): SessionCompletionResult | null {
    const session = this.getCrashedSession(conversationId, sessionId)
    if (!session) {
      return null
    }
    session.lastAccessedAt = Date.now()
    this.activeSessions.delete(sessionId)
    return this.toCrashedCompletionResult(session)
  }

  private touchOrCompleteSession(
    conversationId: string,
    sessionId: string,
    status: PollResult['status']
  ): void {
    const session = this.activeSessions.get(sessionId)
    if (!session || session.conversationId !== conversationId) {
      return
    }
    if (status === 'running') {
      session.lastAccessedAt = Date.now()
      return
    }
    this.activeSessions.delete(sessionId)
  }

  private toCrashedSessionMeta(session: TrackedSessionMeta): SessionMeta {
    return {
      sessionId: session.sessionId,
      command: session.command,
      status: 'error',
      createdAt: session.createdAt,
      lastAccessedAt: session.lastAccessedAt,
      outputLength: this.crashMessage(session).length,
      offloaded: false,
      timedOut: false
    }
  }

  private toActiveSessionMeta(session: TrackedSessionMeta): SessionMeta {
    return {
      sessionId: session.sessionId,
      command: session.command,
      status: 'running',
      createdAt: session.createdAt,
      lastAccessedAt: session.lastAccessedAt,
      outputLength: 0,
      offloaded: false,
      timedOut: false
    }
  }

  private toCrashedPollResult(session: TrackedSessionMeta): PollResult {
    return {
      status: 'error',
      output: this.crashMessage(session),
      offloaded: false,
      timedOut: false
    }
  }

  private toCrashedCompletionResult(session: TrackedSessionMeta): SessionCompletionResult {
    return {
      status: 'error',
      output: this.crashMessage(session),
      exitCode: null,
      offloaded: false,
      timedOut: false
    }
  }

  private crashMessage(session: TrackedSessionMeta): string {
    return `Background exec utility process exited before session ${session.sessionId} completed. The command may have been terminated: ${session.command}`
  }
}

export const backgroundExecSessionManager = new BackgroundExecUtilityProxy()
