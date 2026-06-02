import fs from 'fs'
import path from 'path'
import { spawn } from 'node-pty'
import type { IPty } from 'node-pty'
import { nanoid } from 'nanoid'
import { app } from 'electron'
import { RequestError } from '@agentclientprotocol/sdk'
import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'

interface TerminalState {
  id: string
  sessionId: string
  ptyProcess: IPty
  outputBuffer: string
  maxOutputBytes: number
  truncated: boolean
  exitStatus: { exitCode?: number | null; signal?: string | null } | null
  exitPromise: Promise<{ exitCode?: number | null; signal?: string | null }>
  exitResolve: (status: { exitCode?: number | null; signal?: string | null }) => void
  killed: boolean
  released: boolean
}

/**
 * Manages PTY-based terminals for ACP agent command execution.
 *
 * This manager implements the ACP terminal protocol, allowing agents to:
 * - Create terminals to execute commands
 * - Read terminal output
 * - Wait for command completion
 * - Kill running commands
 * - Release terminal resources
 *
 * @see https://agentclientprotocol.com/protocol/terminals
 */
export class AcpTerminalManager {
  private readonly terminals = new Map<string, TerminalState>()
  private readonly defaultMaxOutputBytes = 1024 * 1024 // 1MB default

  private resolveTerminalCwd(cwd?: string | null): string {
    const normalized = cwd?.trim()
    if (normalized) {
      return path.resolve(normalized)
    }

    const fallbackDir = path.join(app.getPath('temp'), 'deepchat-acp', 'terminals')
    try {
      fs.mkdirSync(fallbackDir, { recursive: true })
      console.warn(`[ACP Terminal] Missing cwd, using fallback directory: ${fallbackDir}`)
      return fallbackDir
    } catch (error) {
      const tempDir = app.getPath('temp')
      console.warn(
        `[ACP Terminal] Failed to create fallback directory, using temp path instead: ${tempDir}`,
        error
      )
      return tempDir
    }
  }

  /**
   * Create a new terminal to execute a command.
   */
  async createTerminal(
    params: schema.CreateTerminalRequest
  ): Promise<schema.CreateTerminalResponse> {
    const id = `term_${nanoid(12)}`
    const maxOutputBytes = params.outputByteLimit ?? this.defaultMaxOutputBytes
    const cwd = this.resolveTerminalCwd(params.cwd)

    let exitResolve!: (status: { exitCode?: number | null; signal?: string | null }) => void
    const exitPromise = new Promise<{ exitCode?: number | null; signal?: string | null }>(
      (resolve) => {
        exitResolve = resolve
      }
    )

    // Build environment from env array
    const env: Record<string, string> = { ...process.env } as Record<string, string>
    if (params.env) {
      for (const envVar of params.env) {
        env[envVar.name] = envVar.value
      }
    }

    const ptyProcess = spawn(params.command, params.args ?? [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env
    })

    const state: TerminalState = {
      id,
      sessionId: params.sessionId,
      ptyProcess,
      outputBuffer: '',
      maxOutputBytes,
      truncated: false,
      exitStatus: null,
      exitPromise,
      exitResolve,
      killed: false,
      released: false
    }

    // Collect output
    ptyProcess.onData((data) => {
      if (state.released) return
      const nextBuffer = state.outputBuffer + data
      state.outputBuffer = this.retainTailAtCharBoundary(nextBuffer, state.maxOutputBytes)
      state.truncated =
        state.truncated || Buffer.byteLength(nextBuffer, 'utf-8') > state.maxOutputBytes
    })

    // Handle exit
    ptyProcess.onExit(({ exitCode, signal }) => {
      state.exitStatus = {
        exitCode: exitCode ?? null,
        signal: signal !== undefined ? String(signal) : null
      }
      exitResolve(state.exitStatus)
    })

    this.terminals.set(id, state)
    return { terminalId: id }
  }

  /**
   * Get current terminal output without waiting.
   */
  async terminalOutput(
    params: schema.TerminalOutputRequest
  ): Promise<schema.TerminalOutputResponse> {
    const state = this.getTerminal(params.terminalId)

    return {
      output: state.outputBuffer,
      truncated: state.truncated,
      exitStatus: state.exitStatus ?? undefined
    }
  }

  /**
   * Wait for a terminal command to exit.
   */
  async waitForTerminalExit(
    params: schema.WaitForTerminalExitRequest
  ): Promise<schema.WaitForTerminalExitResponse> {
    const state = this.getTerminal(params.terminalId)
    const status = await state.exitPromise
    return status
  }

  /**
   * Kill a terminal command without releasing the terminal.
   */
  async killTerminal(params: schema.KillTerminalRequest): Promise<schema.KillTerminalResponse> {
    const state = this.getTerminal(params.terminalId)

    if (!state.killed && !state.exitStatus) {
      try {
        state.ptyProcess.kill()
        state.killed = true
      } catch (error) {
        console.warn(`[ACP Terminal] Failed to kill terminal ${params.terminalId}:`, error)
      }
    }

    return {}
  }

  /**
   * Release a terminal and free all associated resources.
   */
  async releaseTerminal(
    params: schema.ReleaseTerminalRequest
  ): Promise<schema.ReleaseTerminalResponse> {
    const state = this.terminals.get(params.terminalId)
    if (!state) return {} // Already released, idempotent

    if (!state.killed && !state.exitStatus) {
      try {
        state.ptyProcess.kill()
      } catch (error) {
        console.warn(
          `[ACP Terminal] Failed to kill terminal on release ${params.terminalId}:`,
          error
        )
      }
    }

    state.released = true
    this.terminals.delete(params.terminalId)
    return {}
  }

  /**
   * Clean up all terminals for a session.
   */
  async releaseSessionTerminals(sessionId: string): Promise<void> {
    const toRelease = Array.from(this.terminals.values())
      .filter((t) => t.sessionId === sessionId)
      .map((t) => t.id)

    await Promise.all(toRelease.map((id) => this.releaseTerminal({ terminalId: id, sessionId })))
  }

  /**
   * Shutdown all terminals.
   */
  async shutdown(): Promise<void> {
    await Promise.all(
      Array.from(this.terminals.values()).map((t) =>
        this.releaseTerminal({ terminalId: t.id, sessionId: t.sessionId })
      )
    )
  }

  private getTerminal(id: string): TerminalState {
    const state = this.terminals.get(id)
    if (!state) {
      throw RequestError.resourceNotFound(id)
    }
    return state
  }

  private retainTailAtCharBoundary(str: string, maxBytes: number): string {
    if (maxBytes <= 0) return ''

    const buf = Buffer.from(str, 'utf-8')
    if (buf.length <= maxBytes) return str

    for (let start = buf.length - maxBytes; start < buf.length; start += 1) {
      const tail = buf.subarray(start)
      const decoded = tail.toString('utf-8')
      if (!decoded.startsWith('\uFFFD')) {
        return decoded
      }
    }
    return ''
  }
}
