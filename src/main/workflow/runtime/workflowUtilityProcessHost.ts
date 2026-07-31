import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UtilityProcess } from 'electron'
import {
  WORKFLOW_RUNTIME_PROTOCOL_VERSION,
  WorkflowRuntimeCommandSchema,
  WorkflowRuntimeEventSchema,
  type WorkflowRuntimeCommand,
  type WorkflowRuntimeEvent
} from '@shared/workflow/runtimeProtocol'
import { WORKFLOW_UTILITY_HOST_ARG } from './workflowUtilityHost'

const DEFAULT_READY_TIMEOUT_MS = 10_000
const DEFAULT_SHUTDOWN_GRACE_MS = 2_000
const DEFAULT_KILL_SETTLE_MS = 2_000
const WORKFLOW_ENV_ALLOWLIST = [
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SystemRoot',
  'WINDIR'
] as const

type WorkflowUtilityProcess = Pick<UtilityProcess, 'postMessage' | 'kill' | 'pid'> & {
  on(event: 'message', listener: (message: unknown) => void): WorkflowUtilityProcess
  on(event: 'exit', listener: (code: number) => void): WorkflowUtilityProcess
  on(event: 'error', listener: (type: string, location: string) => void): WorkflowUtilityProcess
  once(event: 'spawn', listener: () => void): WorkflowUtilityProcess
  once(event: 'exit', listener: (code: number) => void): WorkflowUtilityProcess
  off(event: 'spawn', listener: () => void): WorkflowUtilityProcess
  off(event: 'exit', listener: (code: number) => void): WorkflowUtilityProcess
}

export interface WorkflowUtilityProcessHostOptions {
  runId: string
  onEvent: (event: WorkflowRuntimeEvent) => void
  onExit: (event: { runId: string; code: number; expected: boolean }) => void
  readyTimeoutMs?: number
  shutdownGraceMs?: number
  killSettleMs?: number
  spawnHost?: () => Promise<WorkflowUtilityProcess>
}

export class WorkflowUtilityProcessHost {
  private host: WorkflowUtilityProcess | null = null
  private spawningHost: WorkflowUtilityProcess | null = null
  private resolveReady: ((event: Extract<WorkflowRuntimeEvent, { type: 'READY' }>) => void) | null =
    null
  private rejectReady: ((error: Error) => void) | null = null
  private readyTimer: NodeJS.Timeout | null = null
  private shutdownTimer: NodeJS.Timeout | null = null
  private killTimer: NodeJS.Timeout | null = null
  private started = false
  private spawning = false
  private terminationRequested = false
  private killSent = false
  private expectedExit = false
  private exited = false

  constructor(private readonly options: WorkflowUtilityProcessHostOptions) {}

  async start(
    command: Extract<WorkflowRuntimeCommand, { type: 'START' }>
  ): Promise<Extract<WorkflowRuntimeEvent, { type: 'READY' }>> {
    if (this.started) {
      throw new Error('Workflow utility process host can only start once.')
    }
    if (this.exited) {
      throw new Error('Workflow utility process host has already exited.')
    }
    if (command.runId !== this.options.runId) {
      throw new Error('Workflow utility START runId does not match the process host.')
    }
    this.started = true
    const readyPromise = new Promise<Extract<WorkflowRuntimeEvent, { type: 'READY' }>>(
      (resolve, reject) => {
        this.resolveReady = resolve
        this.rejectReady = reject
      }
    )
    void readyPromise.catch(() => undefined)
    this.readyTimer = setTimeout(() => {
      this.fail(new Error('Workflow utility process did not become ready before timeout.'))
    }, this.options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS)

    this.spawning = true
    try {
      const spawnPromise = this.options.spawnHost
        ? this.options.spawnHost()
        : this.spawnDefaultHost()
      void spawnPromise
        .then((lateHost) => {
          if (!this.exited && !this.terminationRequested) {
            return
          }
          try {
            lateHost.kill()
          } catch (error) {
            console.error('[WorkflowUtilityProcessHost] Failed to kill a late utility spawn:', error)
          }
        })
        .catch(() => undefined)
      const host = await new Promise<WorkflowUtilityProcess>((resolve, reject) => {
        void spawnPromise.then(resolve, reject)
        void readyPromise.catch(reject)
      })
      this.spawning = false
      if (this.spawningHost === host) {
        this.spawningHost = null
      }
      this.host = host
      host.on('message', (message) => this.handleMessage(message))
      host.on('exit', (code) => this.handleExit(code))
      host.on('error', (type, location) => {
        this.fail(new Error(`Workflow utility process error: ${type} at ${location}`))
      })
      if (this.terminationRequested) {
        this.killProcess(this.expectedExit)
        return await readyPromise
      }
      this.post(command)
      return await readyPromise
    } catch (error) {
      this.spawning = false
      const failure = error instanceof Error ? error : new Error(String(error))
      if (this.terminationRequested && !this.exited && !this.host) {
        this.handleExit(1)
      } else {
        this.fail(failure)
      }
      await readyPromise.catch(() => undefined)
      throw failure
    }
  }

  settleInvocation(
    requestId: string,
    outcome: Extract<WorkflowRuntimeCommand, { type: 'SETTLE_INVOCATION' }>['outcome']
  ): void {
    this.post({
      type: 'SETTLE_INVOCATION',
      protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
      runId: this.options.runId,
      requestId,
      outcome
    })
  }

  cancel(reason: string): void {
    this.post({
      type: 'CANCEL',
      protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
      runId: this.options.runId,
      reason
    })
  }

  shutdown(): void {
    if (this.expectedExit || this.exited) {
      return
    }
    this.expectedExit = true
    this.clearReadyTimer()
    if (!this.host) {
      if (this.spawning) {
        this.killProcess(true)
        return
      }
      this.handleExit(0)
      return
    }
    try {
      this.post({
        type: 'SHUTDOWN',
        protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
        runId: this.options.runId
      })
    } catch {
      this.kill()
      return
    }
    this.shutdownTimer = setTimeout(
      () => this.kill(),
      this.options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS
    )
  }

  kill(): void {
    this.killProcess(true)
  }

  private killProcess(expected: boolean): void {
    if (this.exited) {
      return
    }
    if (!this.terminationRequested) {
      this.expectedExit = expected
    } else if (!expected) {
      this.expectedExit = false
    }
    this.terminationRequested = true
    this.clearReadyTimer()
    this.clearShutdownTimer()
    const host = this.host
    if (!host) {
      const spawningHost = this.spawningHost
      if (spawningHost) {
        try {
          spawningHost.kill()
        } catch {
          this.handleExit(1)
          return
        }
      }
      this.handleExit(this.expectedExit ? 0 : 1)
      return
    }
    if (this.killSent) {
      return
    }
    this.killSent = true
    try {
      host.kill()
    } catch {
      this.handleExit(1)
      return
    }
    if (!this.exited) {
      this.killTimer = setTimeout(() => {
        if (this.exited) {
          return
        }
        console.warn(
          `[WorkflowUtilityProcessHost] Utility kill did not emit exit for run=${this.options.runId}; settling the host lifecycle.`
        )
        this.handleExit(this.expectedExit ? 0 : 1)
      }, this.options.killSettleMs ?? DEFAULT_KILL_SETTLE_MS)
    }
  }

  private post(command: WorkflowRuntimeCommand): void {
    if (!this.host || this.exited) {
      throw new Error('Workflow utility process is not running.')
    }
    this.host.postMessage(WorkflowRuntimeCommandSchema.parse(command))
  }

  private handleMessage(message: unknown): void {
    const candidate = unwrapMessage(message)
    const parsed = WorkflowRuntimeEventSchema.safeParse(candidate)
    if (!parsed.success) {
      this.fail(new Error('Workflow utility emitted an invalid protocol event.'))
      return
    }
    const event = parsed.data
    if (event.runId !== this.options.runId) {
      this.fail(new Error('Workflow utility event runId does not match the process host.'))
      return
    }
    if (event.type === 'READY') {
      if (!this.resolveReady) {
        this.fail(new Error('Workflow utility emitted duplicate READY.'))
        return
      }
      const resolve = this.resolveReady
      this.resolveReady = null
      this.rejectReady = null
      this.clearReadyTimer()
      resolve(event)
    } else if (this.resolveReady) {
      this.fail(new Error(`Workflow utility emitted ${event.type} before READY.`))
      return
    }

    try {
      this.options.onEvent(event)
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private handleExit(code: number): void {
    if (this.exited) {
      return
    }
    this.exited = true
    this.clearReadyTimer()
    this.clearShutdownTimer()
    this.clearKillTimer()
    this.host = null
    if (this.rejectReady) {
      this.rejectReady(new Error(`Workflow utility exited before READY with code ${code}.`))
      this.resolveReady = null
      this.rejectReady = null
    }
    this.options.onExit({
      runId: this.options.runId,
      code,
      expected: this.expectedExit
    })
  }

  private fail(error: Error): void {
    if (this.expectedExit || this.exited) {
      return
    }
    if (this.rejectReady) {
      this.rejectReady(error)
      this.resolveReady = null
      this.rejectReady = null
    }
    this.killProcess(false)
  }

  private async spawnDefaultHost(): Promise<WorkflowUtilityProcess> {
    const { app, utilityProcess } = await import('electron')
    const modulePath = resolveWorkflowUtilityHostEntryPoint(app.getAppPath())
    const host = utilityProcess.fork(modulePath, [WORKFLOW_UTILITY_HOST_ARG], {
      serviceName: 'DeepChat Workflow',
      stdio: 'ignore',
      env: createWorkflowUtilityEnvironment(process.env)
    }) as WorkflowUtilityProcess
    this.spawningHost = host

    const spawned = new Promise<WorkflowUtilityProcess>((resolve, reject) => {
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
      const onSpawn = () => settle(() => resolve(host))
      const onExit = (code: number) =>
        settle(() => {
          if (this.spawningHost === host) {
            this.spawningHost = null
          }
          reject(new Error(`Workflow utility exited before spawn with code ${code}.`))
        })
      host.once('spawn', onSpawn)
      host.once('exit', onExit)
    })
    if (this.exited || this.terminationRequested) {
      try {
        host.kill()
      } catch (error) {
        console.error(
          '[WorkflowUtilityProcessHost] Failed to kill a utility created after termination:',
          error
        )
      }
    }
    return await spawned
  }

  private clearReadyTimer(): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer)
      this.readyTimer = null
    }
  }

  private clearShutdownTimer(): void {
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer)
      this.shutdownTimer = null
    }
  }

  private clearKillTimer(): void {
    if (this.killTimer) {
      clearTimeout(this.killTimer)
      this.killTimer = null
    }
  }
}

export function createWorkflowUtilityEnvironment(
  source: NodeJS.ProcessEnv
): Record<string, string> {
  const environment: Record<string, string> = {
    DEEPCHAT_WORKFLOW_UTILITY_HOST: '1'
  }
  for (const key of WORKFLOW_ENV_ALLOWLIST) {
    const value = source[key]
    if (value) {
      environment[key] = value
    }
  }
  return environment
}

export function resolveWorkflowUtilityHostEntryPoint(appPath?: string): string {
  const modulePath = fileURLToPath(import.meta.url)
  const candidates = [
    ...(appPath
      ? [
          path.join(appPath, 'out/main/workflowUtilityHost.js'),
          path.join(appPath, 'workflowUtilityHost.js')
        ]
      : []),
    path.resolve(path.dirname(modulePath), 'workflowUtilityHost.js'),
    path.resolve(path.dirname(modulePath), '../workflowUtilityHost.js'),
    path.resolve(process.cwd(), 'out/main/workflowUtilityHost.js')
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
}

function unwrapMessage(message: unknown): unknown {
  if (WorkflowRuntimeEventSchema.safeParse(message).success) {
    return message
  }
  if (message && typeof message === 'object' && 'data' in message) {
    return (message as { data?: unknown }).data
  }
  return message
}
