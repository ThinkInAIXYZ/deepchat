import { fork, type ChildProcess } from 'node:child_process'
import type { HostedProcess, HostedProcessOptions, ProcessHost } from '../processHost'

/**
 * `utilityProcess` replacement for the sidecar: a forked Node process with the
 * same message contract. Electron's version hides stdout and reports errors with
 * a type and location; a plain fork reports an `Error`, so the location is empty.
 */
class ForkedProcess implements HostedProcess {
  constructor(private readonly child: ChildProcess) {}

  get pid(): number | undefined {
    return this.child.pid ?? undefined
  }

  postMessage(message: unknown): void {
    this.child.send(message as never)
  }

  kill(): boolean {
    return this.child.kill()
  }

  on(event: 'message' | 'exit' | 'error', listener: (...args: never[]) => void): this {
    this.child.on(event as 'message', listener as never)
    return this
  }

  off(event: 'message' | 'exit' | 'error' | 'spawn', listener: (...args: never[]) => void): this {
    this.child.off(event as 'message', listener as never)
    return this
  }

  once(event: 'spawn' | 'exit', listener: (...args: never[]) => void): this {
    this.child.once(event as 'exit', listener as never)
    return this
  }
}

export const nodeProcessHost: ProcessHost = {
  fork(modulePath: string, args: string[], options: HostedProcessOptions): HostedProcess {
    const child = fork(modulePath, args, {
      env: options.env,
      stdio: options.stdio === 'ignore' ? 'ignore' : options.stdio,
      execArgv: options.execArgv
    })
    return new ForkedProcess(child)
  },

  async getMemoryRssBytes(pid: number): Promise<number | null> {
    // Electron reads this from its process metrics. A plain Node parent has no such
    // API, so callers fall back to their non-metric path until the shell reports it.
    if (process.platform === 'linux') {
      try {
        const { readFileSync } = await import('node:fs')
        const status = readFileSync(`/proc/${pid}/status`, 'utf-8')
        const match = /VmRSS:\s+(\d+) kB/.exec(status)
        return match ? Number(match[1]) * 1024 : null
      } catch {
        return null
      }
    }
    return null
  }
}

/** Canonical name so the build can swap this module in for the electron one. */
export const processHost = nodeProcessHost
