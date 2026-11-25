import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { spawn, type IPty } from 'node-pty'
import { TERMINAL_OUTPUT_CHUNK_MAX } from '@shared/contracts/routes'

export const TERMINAL_REPLAY_LIMIT = 256 * 1024
export const TERMINAL_MAX_LIVE = 8
/** Exited terminals keep their replay for the panel; older ones are evicted beyond this count. */
export const TERMINAL_MAX_EXITED = 8
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

interface PendingCreate {
  ownerWebContentsId: number
  cancelled: boolean
  replacing?: TerminalRecord
  promise: Promise<SessionTerminalSnapshot>
}

interface TerminalRecord {
  terminalId: string
  sessionId: string
  ownerWebContentsId: number
  cwd: string
  shell: string
  pty: IPty | null
  replay: ReplayBuffer
  outputEnd: number
  pendingOutput: string
  pendingOffset: number
  flushTimer: ReturnType<typeof setTimeout> | null
  forceKillTimer: ReturnType<typeof setTimeout> | null
  exitFallbackTimer: ReturnType<typeof setTimeout> | null
  onPtyReleased?: () => void
  exitCode?: number
  disposables: Array<{ dispose(): void }>
}

export class SessionTerminalService {
  private readonly bySession = new Map<string, TerminalRecord>()
  private readonly byId = new Map<string, TerminalRecord>()
  private readonly rendererListeners = new Map<number, () => void>()
  /** Records whose PTY is still alive, including detached ones that are still terminating. */
  private readonly livePtys = new Set<TerminalRecord>()
  /** In-flight creates; deletion and shutdown cancel them before they can spawn. */
  private readonly pendingCreates = new Map<string, PendingCreate>()
  private shuttingDown = false
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
    if (existing && existing.ownerWebContentsId !== ownerWebContentsId) {
      throw new SessionTerminalError('forbidden', 'Terminal belongs to another window')
    }
    return await this.create(sessionId, ownerWebContentsId, input, existing)
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
    this.cancelPending(sessionId)
    const record = this.bySession.get(sessionId)
    if (record) this.dispose(record)
  }

  disposeOwnedBy(webContentsId: number): void {
    for (const [sessionId, pending] of this.pendingCreates) {
      if (pending.ownerWebContentsId === webContentsId) this.cancelPending(sessionId)
    }
    for (const record of this.bySession.values()) {
      if (record.ownerWebContentsId === webContentsId) this.dispose(record)
    }
  }

  shutdown(): void {
    this.shuttingDown = true
    for (const sessionId of this.pendingCreates.keys()) this.cancelPending(sessionId)
    for (const record of this.bySession.values()) this.dispose(record)
    for (const unsubscribe of this.rendererListeners.values()) unsubscribe()
    this.rendererListeners.clear()
  }

  private async create(
    sessionId: string,
    ownerWebContentsId: number,
    input: SessionTerminalOpenInput,
    replacing?: TerminalRecord
  ): Promise<SessionTerminalSnapshot> {
    if (this.shuttingDown) throw new SessionTerminalError('not_found', 'Terminals are shut down')
    const inFlight = this.pendingCreates.get(sessionId)
    if (inFlight) {
      if (inFlight.ownerWebContentsId !== ownerWebContentsId) {
        throw new SessionTerminalError('forbidden', 'Terminal belongs to another window')
      }
      return await inFlight.promise
    }
    this.resolveCwd(sessionId, ownerWebContentsId, input)
    this.assertCapacity(replacing)
    const pending: PendingCreate = {
      ownerWebContentsId,
      cancelled: false,
      replacing,
      promise: undefined as unknown as Promise<SessionTerminalSnapshot>
    }
    pending.promise = this.spawnAfterEnvironment(sessionId, ownerWebContentsId, input, pending)
    this.pendingCreates.set(sessionId, pending)
    this.watchRenderer(ownerWebContentsId)
    if (replacing) this.dispose(replacing)
    try {
      return await pending.promise
    } finally {
      if (this.pendingCreates.get(sessionId) === pending) this.pendingCreates.delete(sessionId)
      this.releaseRendererListener(ownerWebContentsId)
    }
  }

  private cancelPending(sessionId: string): void {
    const pending = this.pendingCreates.get(sessionId)
    if (!pending) return
    pending.cancelled = true
    this.pendingCreates.delete(sessionId)
    this.releaseRendererListener(pending.ownerWebContentsId)
  }

  private async spawnAfterEnvironment(
    sessionId: string,
    ownerWebContentsId: number,
    input: SessionTerminalOpenInput,
    pending: PendingCreate
  ): Promise<SessionTerminalSnapshot> {
    const replacing = pending.replacing
    const released = replacing?.pty
      ? new Promise<void>((resolve) => (replacing.onPtyReleased = resolve))
      : undefined
    const [environment] = await Promise.all([this.dependencies.resolveEnvironment(), released])
    if (pending.cancelled || this.shuttingDown) {
      throw new SessionTerminalError('not_found', 'Terminal request was cancelled')
    }
    // Revalidate after the await: the session or its directory may be gone.
    const cwd = this.resolveCwd(sessionId, ownerWebContentsId, input)
    // This create reserved its slot before awaiting, so the reservation already covers it.

    const { shell, args } = this.dependencies.resolveShell()
    const pty = spawn(shell, args, {
      name: 'xterm-256color',
      cols: input.cols,
      rows: input.rows,
      cwd,
      env: sanitizeEnvironment(environment)
    })
    const record: TerminalRecord = {
      terminalId: randomUUID(),
      sessionId,
      ownerWebContentsId,
      cwd,
      shell,
      pty,
      replay: new ReplayBuffer(TERMINAL_REPLAY_LIMIT),
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
    this.livePtys.add(record)

    record.disposables.push(
      pty.onData((data) => this.handleData(record, data)),
      pty.onExit(({ exitCode, signal }) => this.handleExit(record, exitCode, signal))
    )
    return this.snapshot(record)
  }

  private resolveCwd(
    sessionId: string,
    ownerWebContentsId: number,
    input: SessionTerminalOpenInput
  ): string {
    const cwd = this.dependencies
      .resolveWorkdir(sessionId, ownerWebContentsId, input.draftWorkdir)
      ?.trim()
    if (!cwd) {
      throw new SessionTerminalError('no_workdir', 'Session has no working directory')
    }
    if (!isDirectory(cwd)) {
      throw new SessionTerminalError('workdir_missing', 'Working directory does not exist')
    }
    return cwd
  }

  private assertCapacity(replacing?: TerminalRecord): void {
    // A restart reserves the old PTY's slot and waits for it to be released before spawning.
    let occupied = this.livePtys.size - Number(Boolean(replacing?.pty))
    for (const pending of this.pendingCreates.values()) {
      if (!pending.replacing?.pty) occupied += 1
    }
    if (occupied >= TERMINAL_MAX_LIVE) {
      throw new SessionTerminalError('capacity', 'Too many terminals are running')
    }
  }

  private handleData(record: TerminalRecord, data: string): void {
    if (this.byId.get(record.terminalId) !== record) return
    record.replay.append(data)
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
    let offset = 0
    while (offset < pending.length) {
      let end = Math.min(offset + TERMINAL_OUTPUT_CHUNK_MAX, pending.length)
      // Keep UTF-16 surrogate pairs in one event.
      if (end < pending.length && isHighSurrogate(pending.charCodeAt(end - 1))) end -= 1
      this.dependencies.sendOutput(
        record.ownerWebContentsId,
        record.terminalId,
        record.pendingOffset + offset,
        pending.slice(offset, end)
      )
      offset = end
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
      this.evictExited()
    }
  }

  private evictExited(): void {
    const exited = [...this.bySession.values()].filter((record) => !record.pty)
    for (const record of exited.slice(0, Math.max(0, exited.length - TERMINAL_MAX_EXITED))) {
      this.dispose(record)
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
    this.livePtys.delete(record)
    record.onPtyReleased?.()
    record.onPtyReleased = undefined
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
      replay: record.replay.read(),
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

  private watchRenderer(webContentsId: number): void {
    if (this.rendererListeners.has(webContentsId)) return
    const unsubscribe = this.dependencies.onRendererDestroyed(webContentsId, () => {
      this.rendererListeners.delete(webContentsId)
      this.disposeOwnedBy(webContentsId)
    })
    this.rendererListeners.set(webContentsId, unsubscribe)
  }

  private releaseRendererListener(webContentsId: number): void {
    for (const pending of this.pendingCreates.values()) {
      if (pending.ownerWebContentsId === webContentsId) return
    }
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

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

const REPLAY_RESET = '\x1b[0m'
const REPLAY_BOUNDARY_SEARCH = 4_096

/** Bounded output tail kept as chunks so appends do not copy the whole buffer. */
class ReplayBuffer {
  private chunks: string[] = []
  private length = 0
  private trimmed = false

  constructor(private readonly limit: number) {}

  append(data: string): void {
    this.chunks.push(data)
    this.length += data.length
    // Drop whole chunks that fall entirely outside the window; read() trims the remainder.
    while (this.chunks.length > 1 && this.length - this.chunks[0].length >= this.limit) {
      this.length -= this.chunks.shift()!.length
      this.trimmed = true
    }
  }

  read(): string {
    let text = this.chunks.join('')
    this.chunks = text ? [text] : []
    if (text.length > this.limit) {
      text = text.slice(text.length - this.limit)
      this.chunks = [text]
      this.length = text.length
      this.trimmed = true
    }
    if (!this.trimmed) return text
    // Start replay at a line boundary so it does not begin inside an escape sequence or a
    // surrogate pair, and reset attributes left over from the dropped prefix.
    const newline = text.indexOf('\n')
    let start = newline >= 0 && newline < REPLAY_BOUNDARY_SEARCH ? newline + 1 : 0
    const code = text.charCodeAt(start)
    if (code >= 0xdc00 && code <= 0xdfff) start += 1
    return REPLAY_RESET + text.slice(start)
  }
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
