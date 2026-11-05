/**
 * Hosted child process boundary.
 *
 * Four main-process services run in a separate Node process: the file watcher,
 * the cron scheduler, background exec sessions and code-mode cells. Electron
 * starts them with `utilityProcess.fork`, which gives a Chromium-managed Node
 * process with `postMessage`; a Node sidecar uses `child_process.fork` with
 * `send`.
 *
 * This boundary keeps the shape the services already rely on — postMessage,
 * message/exit/error/spawn events, pid, kill — so the services do not care
 * which runtime hosts them.
 */
export interface HostedProcess {
  readonly pid?: number
  postMessage(message: unknown): void
  kill(): boolean
  on(event: 'message', listener: (message: unknown) => void): this
  on(event: 'exit', listener: (code: number) => void): this
  on(event: 'error', listener: (type: string, location: string) => void): this
  off(event: 'message', listener: (message: unknown) => void): this
  off(event: 'exit', listener: (code: number) => void): this
  off(event: 'error', listener: (type: string, location: string) => void): this
  off(event: 'spawn', listener: () => void): this
  once(event: 'spawn', listener: () => void): this
  once(event: 'exit', listener: (code: number) => void): this
}

export interface HostedProcessOptions {
  /** Human-readable name shown in process listings. */
  serviceName: string
  env: NodeJS.ProcessEnv
  /** `ignore` keeps the host's stdout/stderr out of the app's. */
  stdio?: 'ignore' | 'inherit' | 'pipe'
  /** Node flags for the host process, e.g. a smaller old-space limit. */
  execArgv?: string[]
}

export interface ProcessHost {
  /** Starts a module in a separate Node process. */
  fork(modulePath: string, args: string[], options: HostedProcessOptions): HostedProcess
  /**
   * Resident set size of a hosted process, in bytes, or `null` when the runtime
   * cannot report it. Code-mode cells use this to enforce their memory ceiling.
   */
  getMemoryRssBytes(pid: number): Promise<number | null>
}

export { electronProcessHost as processHost } from './electron/processHost'
