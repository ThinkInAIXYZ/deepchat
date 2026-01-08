import { spawn } from 'node-pty'
import type { IPty } from 'node-pty'
import { nanoid } from 'nanoid'
import { RequestError } from '@agentclientprotocol/sdk'
import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'

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
  private readonly defaultMaxOutputBytes = 2048

  /**
   * Create a new terminal to execute a command.
   */
  async createTerminal(
    params: schema.CreateTerminalRequest
  ): Promise<schema.CreateTerminalResponse> {
    const id = `term_${nanoid(12)}`
    const maxOutputBytes = params.outputByteLimit ?? this.defaultMaxOutputBytes

    let exitResolve!: (status: { exitCode?: number | null; signal?: string | null }) => void
    const exitPromise = new Promise<{ exitCode?: number | null; signal?: string | null }>(
      (resolve) => {
        exitResolve = resolve
      }
    )

    // Build command based on platform
    const platform = process.platform
    let shell: string
    let shellArgs: string[]

    if (platform === 'win32') {
      shell = 'powershell.exe'
      shellArgs = ['-NoLogo', '-Command', params.command, ...(params.args ?? [])]
    } else {
      shell = '/bin/bash'
      shellArgs = ['-c', [params.command, ...(params.args ?? [])].join(' ')]
    }

    // Build environment from env array
    const env: Record<string, string> = { ...process.env } as Record<string, string>
    if (params.env) {
      for (const envVar of params.env) {
        env[envVar.name] = envVar.value
      }
    }

    const ptyProcess = spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: params.cwd ?? process.cwd(),
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

      const currentBytes = Buffer.byteLength(state.outputBuffer, 'utf-8')
      const newBytes = Buffer.byteLength(data, 'utf-8')

      if (currentBytes + newBytes <= state.maxOutputBytes) {
        state.outputBuffer += data
      } else {
        // Truncate at UTF-8 boundary
        const remaining = state.maxOutputBytes - currentBytes
        if (remaining > 0) {
          state.outputBuffer += this.truncateAtCharBoundary(data, remaining)
        }
        state.truncated = true
      }
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
  async killTerminal(
    params: schema.KillTerminalCommandRequest
  ): Promise<schema.KillTerminalResponse> {
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

  private truncateAtCharBoundary(str: string, maxBytes: number): string {
    const buf = Buffer.from(str, 'utf-8')
    if (buf.length <= maxBytes) return str

    // Find valid UTF-8 boundary by slicing and checking
    let truncated = buf.subarray(0, maxBytes)
    while (truncated.length > 0) {
      try {
        return truncated.toString('utf-8')
      } catch {
        truncated = truncated.subarray(0, truncated.length - 1)
      }
    }
    return ''
  }
}
