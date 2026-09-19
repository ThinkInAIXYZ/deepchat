import { randomUUID } from 'node:crypto'
import { spawn, type IPty } from 'node-pty'
import type { AcpMaterializedLaunch } from '../runtime/acpProcessManager'

const AUTH_RUN_TIMEOUT_MS = 10 * 60 * 1000
const AUTH_KILL_GRACE_MS = 2 * 1000
const AUTH_EXIT_FALLBACK_MS = 4 * 1000
const AUTH_OUTPUT_LIMIT_BYTES = 1024 * 1024

export type AcpTerminalAuthExitReason = 'exited' | 'cancelled' | 'timed_out' | 'output_limit'

export interface AcpTerminalAuthExit {
  exitCode: number
  signal?: number
  reason: AcpTerminalAuthExitReason
}

interface AcpTerminalAuthRun {
  ownerWebContentsId: number
  pty: IPty
  terminationReason: Exclude<AcpTerminalAuthExitReason, 'exited'> | null
  outputBytes: number
  completion: Promise<AcpTerminalAuthExit>
  timeout: ReturnType<typeof setTimeout> | null
  forceKillTimeout: ReturnType<typeof setTimeout> | null
  exitFallbackTimeout: ReturnType<typeof setTimeout> | null
  finish(exitCode: number, signal?: number): void
}

export class AcpTerminalAuthRunner {
  private readonly runs = new Map<string, AcpTerminalAuthRun>()

  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  start(input: {
    ownerWebContentsId: number
    launch: AcpMaterializedLaunch
    onData(runId: string, data: string): void
  }): { runId: string; completion: Promise<AcpTerminalAuthExit> } {
    const runId = randomUUID()
    const pty = spawn(input.launch.command, input.launch.args, {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: input.launch.cwd,
      env: input.launch.env
    })
    let resolveExit!: (exit: AcpTerminalAuthExit) => void
    const completion = new Promise<AcpTerminalAuthExit>((resolve) => {
      resolveExit = resolve
    })
    let dataSubscription: { dispose(): void } | null = null
    let exitSubscription: { dispose(): void } | null = null
    let settled = false
    const run: AcpTerminalAuthRun = {
      ownerWebContentsId: input.ownerWebContentsId,
      pty,
      terminationReason: null,
      outputBytes: 0,
      completion,
      timeout: null,
      forceKillTimeout: null,
      exitFallbackTimeout: null,
      finish: (exitCode, signal) => {
        if (settled) return
        settled = true
        dataSubscription?.dispose()
        exitSubscription?.dispose()
        this.clearTimeouts(run)
        if (this.runs.get(runId) === run) this.runs.delete(runId)
        resolveExit({
          exitCode,
          signal,
          reason: run.terminationReason ?? 'exited'
        })
      }
    }
    this.runs.set(runId, run)
    dataSubscription = pty.onData((data) => {
      const nextOutputBytes = run.outputBytes + Buffer.byteLength(data)
      if (nextOutputBytes > AUTH_OUTPUT_LIMIT_BYTES) {
        this.terminate(runId, run, 'output_limit')
        return
      }
      run.outputBytes = nextOutputBytes
      for (let offset = 0; offset < data.length; offset += 65_536) {
        input.onData(runId, data.slice(offset, offset + 65_536))
      }
    })
    exitSubscription = pty.onExit(({ exitCode, signal }) => {
      run.finish(exitCode, signal)
    })
    if (this.runs.get(runId) === run) {
      run.timeout = setTimeout(() => this.terminate(runId, run, 'timed_out'), AUTH_RUN_TIMEOUT_MS)
      run.timeout.unref?.()
    }
    return { runId, completion }
  }

  write(runId: string, ownerWebContentsId: number, data: string): void {
    const run = this.requireOwnedRun(runId, ownerWebContentsId)
    run.pty.write(data)
  }

  cancel(runId: string, ownerWebContentsId: number): boolean {
    const run = this.runs.get(runId)
    if (!run) return false
    if (run.ownerWebContentsId !== ownerWebContentsId) {
      throw new Error('ACP authentication terminal belongs to another renderer')
    }
    this.terminate(runId, run, 'cancelled')
    return true
  }

  cancelOwnedBy(ownerWebContentsId: number): void {
    for (const [runId, run] of this.runs) {
      if (run.ownerWebContentsId === ownerWebContentsId) {
        this.cancel(runId, ownerWebContentsId)
      }
    }
  }

  shutdown(): void {
    for (const [runId, run] of this.runs) {
      this.terminate(runId, run, 'cancelled')
    }
  }

  private terminate(
    runId: string,
    run: AcpTerminalAuthRun,
    reason: Exclude<AcpTerminalAuthExitReason, 'exited'>
  ): void {
    if (this.runs.get(runId) !== run || run.terminationReason) return
    run.terminationReason = reason
    if (run.timeout) {
      clearTimeout(run.timeout)
      run.timeout = null
    }
    try {
      run.pty.kill()
    } catch {}
    if (this.platform !== 'win32') {
      run.forceKillTimeout = setTimeout(() => {
        run.forceKillTimeout = null
        if (this.runs.get(runId) !== run) return
        try {
          run.pty.kill('SIGKILL')
        } catch {}
      }, AUTH_KILL_GRACE_MS)
      run.forceKillTimeout.unref?.()
    }
    run.exitFallbackTimeout = setTimeout(() => {
      run.exitFallbackTimeout = null
      run.finish(-1)
    }, AUTH_EXIT_FALLBACK_MS)
    run.exitFallbackTimeout.unref?.()
  }

  private clearTimeouts(run: AcpTerminalAuthRun): void {
    if (run.timeout) clearTimeout(run.timeout)
    if (run.forceKillTimeout) clearTimeout(run.forceKillTimeout)
    if (run.exitFallbackTimeout) clearTimeout(run.exitFallbackTimeout)
    run.timeout = null
    run.forceKillTimeout = null
    run.exitFallbackTimeout = null
  }

  private requireOwnedRun(runId: string, ownerWebContentsId: number): AcpTerminalAuthRun {
    const run = this.runs.get(runId)
    if (!run) throw new Error('ACP authentication terminal is not running')
    if (run.ownerWebContentsId !== ownerWebContentsId) {
      throw new Error('ACP authentication terminal belongs to another renderer')
    }
    return run
  }
}
