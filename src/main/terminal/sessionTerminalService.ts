import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { spawn, type IPty } from 'node-pty'
import { TERMINAL_OUTPUT_CHUNK_MAX } from '@shared/contracts/routes'

export const TERMINAL_REPLAY_LIMIT = 256 * 1024
export const TERMINAL_MAX_LIVE = 8
const OUTPUT_FLUSH_MS = 8
const KILL_GRACE_MS = 2_000
const EXIT_FALLBACK_MS = 4_000

const STRIPPED_ENV_KEYS = [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_RENDERER_URL',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ELECTRON_ENABLE_LOGGING',
  'ELECTRON_ENABLE_STACK_DUMPING',
  'NODE_OPTIONS'
]

export type SessionTerminalErrorCode =
  | 'no_workdir'
  | 'workdir_missing'
  | 'capacity'
  | 'not_found'
  | 'forbidden'

export class SessionTerminalError extends Error {
  constructor(
    readonly code: SessionTerminalErrorCode,
    message: string
  ) {
    // Electron IPC keeps only the message, so the code is encoded for renderer mapping.
    super(`[terminal:${code}] ${message}`)
    this.name = 'SessionTerminalError'
  }
}

export interface SessionTerminalSnapshot {
  terminalId: string
  cwd: string
  shell: string
  replay: string
  outputEnd: number
  status: 'running' | 'exited'
  exitCode?: number
}

export interface SessionTerminalOpenInput {
  cols: number
  rows: number
  draftWorkdir?: string
}

export interface SessionTerminalDependencies {
  /**
   * Returns the trusted working directory. `draftWorkdir` may only be honored for an unsent draft
   * owned by `ownerWebContentsId`, whose record is not updated until the first message is sent.
   */
  resolveWorkdir(
    sessionId: string,
    ownerWebContentsId: number,
    draftWorkdir: string | undefined
  ): string | null
  resolveShell(): { shell: string; args: string[] }
  resolveEnvironment(): Promise<Record<string, string>>
  sendOutput(webContentsId: number, terminalId: string, offset: number, data: string): void
  sendExit(webContentsId: number, terminalId: string, exitCode: number, signal?: number): void
  onRendererDestroyed(webContentsId: number, callback: () => void): () => void
  platform?: NodeJS.Platform
}

interface TerminalRecord {
  terminalId: string
  sessionId: string
  ownerWebContentsId: number
  cwd: string
  shell: string
  pty: IPty | null
  replay: string
  outputEnd: number
  pendingOutput: string
  pendingOffset: number
  flushTimer: ReturnType<typeof setTimeout> | null
  forceKillTimer: ReturnType<typeof setTimeout> | null
  exitFallbackTimer: ReturnType<typeof setTimeout> | null
  exitCode?: number
  disposables: Array<{ dispose(): void }>
}

export class SessionTerminalService {
  private readonly bySession = new Map<string, TerminalRecord>()
  private readonly byId = new Map<string, TerminalRecord>()
  private readonly rendererListeners = new Map<number, () => void>()
  private readonly platform: NodeJS.Platform

  constructor(private readonly dependencies: SessionTerminalDependencies) {
    this.platform = dependencies.platform ?? process.platform
  }

  async attach(
    sessionId: string,
    ownerWebContentsId: number,
    input: SessionTerminalOpenInput
  ): Promise<SessionTerminalSnapshot> {
    const existing = this.bySession.get(sessionId)
    if (existing) {
      if (existing.ownerWebContentsId !== ownerWebContentsId) {
        throw new SessionTerminalError('forbidden', 'Terminal belongs to another window')
      }
      if (existing.pty) this.resizePty(existing, input)
      return this.snapshot(existing)
    }
    return await this.create(sessionId, ownerWebContentsId, input)
  }

  async restart(
    sessionId: string,
    ownerWebContentsId: number,
    input: SessionTerminalOpenInput
  ): Promise<SessionTerminalSnapshot> {
    const existing = this.bySession.get(sessionId)
    if (existing) {
      if (existing.ownerWebContentsId !== ownerWebContentsId) {
        throw new SessionTerminalError('forbidden', 'Terminal belongs to another window')
      }
      this.dispose(existing)
    }
    return await this.create(sessionId, ownerWebContentsId, input)
  }

  write(terminalId: string, ownerWebContentsId: number, data: string): void {
    const record = this.requireOwned(terminalId, ownerWebContentsId)
    if (!record.pty) throw new SessionTerminalError('not_found', 'Terminal is not running')
    record.pty.write(data)
  }

  resize(terminalId: string, ownerWebContentsId: number, size: { cols: number; rows: number }) {
    const record = this.requireOwned(terminalId, ownerWebContentsId)
    if (!record.pty) return false
    this.resizePty(record, size)
    return true
  }

  kill(terminalId: string, ownerWebContentsId: number): boolean {
    const record = this.requireOwned(terminalId, ownerWebContentsId)
    if (!record.pty) return false
    this.terminate(record)
    return true
  }

  disposeSession(sessionId: string): void {
    const record = this.bySession.get(sessionId)
    if (record) this.dispose(record)
  }

  disposeOwnedBy(webContentsId: number): void {
    for (const record of this.bySession.values()) {
      if (record.ownerWebContentsId === webContentsId) this.dispose(record)
    }
  }

  shutdown(): void {
    for (const record of this.bySession.values()) this.dispose(record)
    for (const unsubscribe of this.rendererListeners.values()) unsubscribe()
    this.rendererListeners.clear()
  }

  private async create(
    sessionId: string,
    ownerWebContentsId: number,
    input: SessionTerminalOpenInput
  ): Promise<SessionTerminalSnapshot> {
    const cwd = this.dependencies
      .resolveWorkdir(sessionId, ownerWebContentsId, input.draftWorkdir)
      ?.trim()
    if (!cwd) {
      throw new SessionTerminalError('no_workdir', 'Session has no working directory')
    }
    if (!isDirectory(cwd)) {
      throw new SessionTerminalError('workdir_missing', 'Working directory does not exist')
    }
    if (this.liveCount() >= TERMINAL_MAX_LIVE) {
      throw new SessionTerminalError('capacity', 'Too many terminals are running')
    }

    const env = sanitizeEnvironment(await this.dependencies.resolveEnvironment())
    // The session may have been attached concurrently while the environment resolved.
    const raced = this.bySession.get(sessionId)
    if (raced) {
      if (raced.ownerWebContentsId !== ownerWebContentsId) {
        throw new SessionTerminalError('forbidden', 'Terminal belongs to another window')
      }
      return this.snapshot(raced)
    }

    const { shell, args } = this.dependencies.resolveShell()
    const pty = spawn(shell, args, {
      name: 'xterm-256color',
      cols: input.cols,
      rows: input.rows,
      cwd,
      env
    })
    const record: TerminalRecord = {
      terminalId: randomUUID(),
      sessionId,
      ownerWebContentsId,
      cwd,
      shell,
      pty,
      replay: '',
      outputEnd: 0,
      pendingOutput: '',
      pendingOffset: 0,
      flushTimer: null,
      forceKillTimer: null,
      exitFallbackTimer: null,
      disposables: []
    }
    this.bySession.set(sessionId, record)
    this.byId.set(record.terminalId, record)
    this.watchRenderer(ownerWebContentsId)

    record.disposables.push(
      pty.onData((data) => this.handleData(record, data)),
      pty.onExit(({ exitCode, signal }) => this.handleExit(record, exitCode, signal))
    )
    return this.snapshot(record)
  }

  private handleData(record: TerminalRecord, data: string): void {
    if (this.byId.get(record.terminalId) !== record) return
    record.replay = appendBounded(record.replay, data, TERMINAL_REPLAY_LIMIT)
    if (!record.pendingOutput) record.pendingOffset = record.outputEnd
    record.outputEnd += data.length
    record.pendingOutput += data
    if (record.flushTimer) return
    record.flushTimer = setTimeout(() => this.flush(record), OUTPUT_FLUSH_MS)
  }

  private flush(record: TerminalRecord): void {
    record.flushTimer = null
    const pending = record.pendingOutput
    record.pendingOutput = ''
    if (!pending || this.byId.get(record.terminalId) !== record) return
    for (let offset = 0; offset < pending.length; offset += TERMINAL_OUTPUT_CHUNK_MAX) {
      this.dependencies.sendOutput(
        record.ownerWebContentsId,
        record.terminalId,
        record.pendingOffset + offset,
        pending.slice(offset, offset + TERMINAL_OUTPUT_CHUNK_MAX)
      )
    }
  }

  private handleExit(record: TerminalRecord, exitCode: number, signal?: number): void {
    if (!record.pty) return
    if (record.flushTimer) {
      clearTimeout(record.flushTimer)
      this.flush(record)
    }
    this.releasePty(record)
    record.exitCode = exitCode
    if (this.byId.get(record.terminalId) === record) {
      this.dependencies.sendExit(record.ownerWebContentsId, record.terminalId, exitCode, signal)
    }
  }

  private terminate(record: TerminalRecord): void {
    const pty = record.pty
    if (!pty || record.exitFallbackTimer) return
    try {
      pty.kill()
    } catch {}
    if (this.platform !== 'win32') {
      record.forceKillTimer = setTimeout(() => {
        record.forceKillTimer = null
        if (record.pty !== pty) return
        try {
          pty.kill('SIGKILL')
        } catch {}
      }, KILL_GRACE_MS)
      record.forceKillTimer.unref?.()
    }
    record.exitFallbackTimer = setTimeout(() => {
      record.exitFallbackTimer = null
      if (record.pty === pty) this.handleExit(record, -1)
    }, EXIT_FALLBACK_MS)
    record.exitFallbackTimer.unref?.()
  }

  private dispose(record: TerminalRecord): void {
    if (this.bySession.get(record.sessionId) === record) this.bySession.delete(record.sessionId)
    this.byId.delete(record.terminalId)
    if (record.flushTimer) clearTimeout(record.flushTimer)
    record.flushTimer = null
    record.pendingOutput = ''
    // Detached records no longer publish; terminate still escalates if the shell ignores SIGHUP.
    this.terminate(record)
    this.releaseRendererListener(record.ownerWebContentsId)
  }

  private releasePty(record: TerminalRecord): void {
    for (const disposable of record.disposables.splice(0)) {
      try {
        disposable.dispose()
      } catch {}
    }
    if (record.forceKillTimer) clearTimeout(record.forceKillTimer)
    if (record.exitFallbackTimer) clearTimeout(record.exitFallbackTimer)
    record.forceKillTimer = null
    record.exitFallbackTimer = null
    record.pty = null
  }

  private resizePty(record: TerminalRecord, size: { cols: number; rows: number }): void {
    try {
      record.pty?.resize(size.cols, size.rows)
    } catch {}
  }

  private snapshot(record: TerminalRecord): SessionTerminalSnapshot {
    return {
      terminalId: record.terminalId,
      cwd: record.cwd,
      shell: record.shell,
      replay: record.replay,
      outputEnd: record.outputEnd,
      status: record.pty ? 'running' : 'exited',
      ...(record.pty || record.exitCode === undefined ? {} : { exitCode: record.exitCode })
    }
  }

  private requireOwned(terminalId: string, ownerWebContentsId: number): TerminalRecord {
    const record = this.byId.get(terminalId)
    if (!record) throw new SessionTerminalError('not_found', 'Terminal does not exist')
    if (record.ownerWebContentsId !== ownerWebContentsId) {
      throw new SessionTerminalError('forbidden', 'Terminal belongs to another window')
    }
    return record
  }

  private liveCount(): number {
    let count = 0
    for (const record of this.bySession.values()) if (record.pty) count += 1
    return count
  }

  private watchRenderer(webContentsId: number): void {
    if (this.rendererListeners.has(webContentsId)) return
    const unsubscribe = this.dependencies.onRendererDestroyed(webContentsId, () => {
      this.rendererListeners.delete(webContentsId)
      this.disposeOwnedBy(webContentsId)
    })
    this.rendererListeners.set(webContentsId, unsubscribe)
  }

  private releaseRendererListener(webContentsId: number): void {
    for (const record of this.bySession.values()) {
      if (record.ownerWebContentsId === webContentsId) return
    }
    this.rendererListeners.get(webContentsId)?.()
    this.rendererListeners.delete(webContentsId)
  }
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

function appendBounded(buffer: string, data: string, limit: number): string {
  const next = buffer + data
  if (next.length <= limit) return next
  let start = next.length - limit
  // Avoid starting replay in the middle of a UTF-16 surrogate pair.
  const code = next.charCodeAt(start)
  if (code >= 0xdc00 && code <= 0xdfff) start += 1
  return next.slice(start)
}

export function sanitizeEnvironment(input: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') env[key] = value
  }
  for (const key of STRIPPED_ENV_KEYS) delete env[key]
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'DeepChat'
  return env
}
