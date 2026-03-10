import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import logger from '@shared/logger'
import { getShellEnvironment, getUserShell } from './shellEnvHelper'
import { resolveSessionDir } from '../../sessionPresenter/sessionPaths'

// Configuration with environment variable support
const getConfig = () => ({
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
}

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
  stdoutEof: boolean
  stderrEof: boolean
  killTimeoutId?: NodeJS.Timeout
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
}

interface LogResult {
  status: 'running' | 'done' | 'error' | 'killed'
  output: string
  totalLength: number
  exitCode?: number
  offloaded?: boolean
  outputFilePath?: string
}

export class BackgroundExecSessionManager {
  private sessions = new Map<string, Map<string, BackgroundSession>>()
  private cleanupIntervalId?: NodeJS.Timeout

  constructor() {
    this.startCleanupTimer()
  }

  /**
   * Start a new background exec session
   */
  async start(
    conversationId: string,
    command: string,
    cwd: string,
    options?: {
      timeout?: number
      env?: Record<string, string>
    }
  ): Promise<StartSessionResult> {
    const config = getConfig()
    const sessionId = `bg_${nanoid(12)}`
    const { shell, args } = getUserShell()
    const shellEnv = await getShellEnvironment()

    // Ensure session directory exists for offload
    const sessionDir = resolveSessionDir(conversationId)
    if (sessionDir) {
      fs.mkdirSync(sessionDir, { recursive: true })
    }

    const outputFilePath = sessionDir ? path.join(sessionDir, `bgexec_${sessionId}.log`) : null

    const child = spawn(shell, [...args, command], {
      cwd,
      env: {
        ...process.env,
        ...shellEnv,
        ...options?.env
      },
      stdio: ['pipe', 'pipe', 'pipe']
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
      stdoutEof: false,
      stderrEof: false
    }

    // Set up output handling
    this.setupOutputHandling(session, config)

    // Set up process exit handling
    this.setupExitHandling(session, config)

    // Set up timeout
    const timeout = options?.timeout ?? config.timeoutSec * 1000
    if (timeout > 0) {
      session.killTimeoutId = setTimeout(() => {
        this.killInternal(session, 'timeout')
      }, timeout)
    }

    // Store session
    if (!this.sessions.has(conversationId)) {
      this.sessions.set(conversationId, new Map())
    }
    this.sessions.get(conversationId)!.set(sessionId, session)

    logger.info(`[BackgroundExec] Started session ${sessionId} for conversation ${conversationId}`)

    return { sessionId, status: 'running' }
  }

  /**
   * List all sessions for a conversation
   */
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
      offloaded:
        session.outputFilePath !== null &&
        session.totalOutputLength > getConfig().offloadThresholdChars
    }))
  }

  /**
   * Poll for new output (returns recent output only)
   */
  poll(conversationId: string, sessionId: string): PollResult {
    const session = this.getSession(conversationId, sessionId)
    session.lastAccessedAt = Date.now()

    const config = getConfig()
    const isOffloaded =
      session.outputFilePath !== null && session.totalOutputLength > config.offloadThresholdChars

    if (isOffloaded && session.outputFilePath) {
      // Return only last N characters from file
      const output = this.readLastCharsFromFile(session.outputFilePath, config.maxOutputChars)
      return {
        status: session.status,
        output,
        exitCode: session.exitCode,
        offloaded: true,
        outputFilePath: session.outputFilePath
      }
    }

    // Return recent output from buffer
    const output = this.getRecentOutput(session.outputBuffer, config.maxOutputChars)
    return {
      status: session.status,
      output,
      exitCode: session.exitCode,
      offloaded: false
    }
  }

  /**
   * Get full output log with pagination
   */
  log(conversationId: string, sessionId: string, offset = 0, limit = 1000): LogResult {
    const session = this.getSession(conversationId, sessionId)
    session.lastAccessedAt = Date.now()

    const config = getConfig()
    const isOffloaded =
      session.outputFilePath !== null && session.totalOutputLength > config.offloadThresholdChars

    let output: string
    if (isOffloaded && session.outputFilePath) {
      output = this.readFromFile(session.outputFilePath, offset, limit)
    } else {
      output = session.outputBuffer.slice(offset, offset + limit)
    }

    return {
      status: session.status,
      output,
      totalLength: session.totalOutputLength,
      exitCode: session.exitCode,
      offloaded: isOffloaded,
      outputFilePath: session.outputFilePath || undefined
    }
  }

  /**
   * Write data to session stdin
   */
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

  /**
   * Kill a running session
   */
  async kill(conversationId: string, sessionId: string): Promise<void> {
    const session = this.getSession(conversationId, sessionId)
    await this.killInternal(session, 'user')
  }

  /**
   * Clear output buffer/file
   */
  clear(conversationId: string, sessionId: string): void {
    const session = this.getSession(conversationId, sessionId)

    session.outputBuffer = ''
    session.totalOutputLength = 0

    if (session.outputFilePath) {
      this.queueOutputWrite(session, '', 'truncate')
    }

    session.lastAccessedAt = Date.now()
  }

  /**
   * Remove a session completely
   */
  async remove(conversationId: string, sessionId: string): Promise<void> {
    const conversationSessions = this.sessions.get(conversationId)
    if (!conversationSessions) {
      throw new Error(`No sessions found for conversation ${conversationId}`)
    }

    const session = conversationSessions.get(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // Kill if still running
    if (session.status === 'running') {
      await this.killInternal(session, 'remove')
    }

    // Ensure queued writes are completed before deleting files.
    await session.outputWriteQueue.catch((error) => {
      logger.warn(`[BackgroundExec] Failed while draining output write queue:`, error)
    })

    // Clean up output file
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

    // Clear timeout
    if (session.killTimeoutId) {
      clearTimeout(session.killTimeoutId)
    }

    // Remove from map
    conversationSessions.delete(sessionId)
    if (conversationSessions.size === 0) {
      this.sessions.delete(conversationId)
    }

    logger.info(`[BackgroundExec] Removed session ${sessionId}`)
  }

  /**
   * Clean up all sessions for a conversation
   */
  async cleanupConversation(conversationId: string): Promise<void> {
    const conversationSessions = this.sessions.get(conversationId)
    if (!conversationSessions) return

    const sessionIds = Array.from(conversationSessions.keys())
    await Promise.all(sessionIds.map((id) => this.remove(conversationId, id).catch(() => {})))
  }

  /**
   * Shutdown all sessions
   */
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

  // Private methods

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
      session.outputFilePath !== null && session.totalOutputLength > config.offloadThresholdChars

    if (shouldOffload) {
      const chunk = session.outputBuffer + data
      session.outputBuffer = ''
      this.queueOutputWrite(session, chunk, 'append')
    } else {
      // Keep in buffer
      session.outputBuffer += data
    }
  }

  private setupExitHandling(
    session: BackgroundSession,
    config: ReturnType<typeof getConfig>
  ): void {
    session.child.on('exit', (code, signal) => {
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

      // Flush any remaining output
      if (session.outputFilePath && session.totalOutputLength > config.offloadThresholdChars) {
        try {
          const remainingStdout = session.child.stdout?.read?.()
          const remainingStderr = session.child.stderr?.read?.()
          if (remainingStdout) {
            this.appendOutput(session, remainingStdout.toString('utf-8'), config)
          }
          if (remainingStderr) {
            this.appendOutput(session, remainingStderr.toString('utf-8'), config)
          }
        } catch (error) {
          logger.warn(`[BackgroundExec] Failed to flush remaining output:`, error)
        }
      }

      logger.info(
        `[BackgroundExec] Session ${session.sessionId} exited with code ${code}, signal ${signal}`
      )
    })

    session.child.on('error', (error) => {
      session.status = 'error'
      session.errorMessage = error.message
      logger.error(`[BackgroundExec] Session ${session.sessionId} error:`, error)
    })
  }

  private async killInternal(session: BackgroundSession, reason: string): Promise<void> {
    if (session.status !== 'running') return

    logger.info(`[BackgroundExec] Killing session ${session.sessionId} (reason: ${reason})`)

    // Clear timeout
    if (session.killTimeoutId) {
      clearTimeout(session.killTimeoutId)
    }

    // Try graceful kill first
    const gracefulKill = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        resolve() // Timeout, will force kill
      }, 2000)

      session.child.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })

      try {
        session.child.kill('SIGTERM')
      } catch {
        resolve()
      }
    })

    await gracefulKill

    // Force kill if still running
    if (session.status === 'running') {
      try {
        session.child.kill('SIGKILL')
      } catch (error) {
        logger.warn(`[BackgroundExec] Failed to force kill session ${session.sessionId}:`, error)
      }
    }

    session.status = 'killed'
  }

  private getRecentOutput(buffer: string, maxChars: number): string {
    if (buffer.length <= maxChars) return buffer
    return buffer.slice(-maxChars)
  }

  private readLastCharsFromFile(filePath: string, maxChars: number): string {
    try {
      const stats = fs.statSync(filePath)
      const fileSize = stats.size

      // Estimate bytes needed (assuming UTF-8, worst case 4 bytes per char)
      const bytesToRead = Math.min(maxChars * 4, fileSize)
      const startPosition = Math.max(0, fileSize - bytesToRead)

      const fd = fs.openSync(filePath, 'r')
      try {
        const buffer = Buffer.alloc(bytesToRead)
        fs.readSync(fd, buffer, 0, bytesToRead, startPosition)
        const content = buffer.toString('utf-8')
        // If we read from middle of file, find first newline to start clean
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
      logger.warn(`[BackgroundExec] Failed to read from output file:`, error)
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
      logger.warn(`[BackgroundExec] Failed to read from output file:`, error)
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
          session.outputBuffer += data
        }
      })
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
        // UTF-8 character starts at non-continuation byte.
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
    // Run cleanup every 5 minutes
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
        // Clean up sessions that have been inactive for cleanupMs
        if (now - session.lastAccessedAt > config.cleanupMs) {
          expiredSessions.push({ conversationId, sessionId })
        }
        // Also clean up completed sessions after a shorter period (5 minutes)
        else if (session.status !== 'running' && now - session.lastAccessedAt > 5 * 60 * 1000) {
          expiredSessions.push({ conversationId, sessionId })
        }
      }
    }

    for (const { conversationId, sessionId } of expiredSessions) {
      logger.info(`[BackgroundExec] Auto-removing expired session ${sessionId}`)
      this.remove(conversationId, sessionId).catch((error) => {
        logger.warn(`[BackgroundExec] Failed to remove expired session:`, error)
      })
    }
  }
}

// Singleton instance
export const backgroundExecSessionManager = new BackgroundExecSessionManager()
