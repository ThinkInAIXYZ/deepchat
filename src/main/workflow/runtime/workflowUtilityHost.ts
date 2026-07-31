import {
  WORKFLOW_RUNTIME_PROTOCOL_VERSION,
  WorkflowRuntimeCommandSchema,
  createWorkflowRuntimeEvent,
  type WorkflowRuntimeCommand,
  type WorkflowRuntimeEvent
} from '@shared/workflow/runtimeProtocol'
import { QuickJSWorkflowRuntime } from './quickjsWorkflowRuntime'

export const WORKFLOW_UTILITY_HOST_ARG = '--deepchat-workflow-utility-host'

type ParentPort = {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): void
  start?(): void
}

type ParentPortMessageEvent = {
  data?: unknown
}

interface WorkflowUtilityHostOptions {
  postMessage: (message: WorkflowRuntimeEvent) => void
  terminate: (exitCode: number) => void
}

export class WorkflowUtilityHost {
  private runtime: QuickJSWorkflowRuntime | null = null
  private runId: string | null = null
  private commandQueue: Promise<void> = Promise.resolve()
  private stopped = false

  constructor(private readonly options: WorkflowUtilityHostOptions) {}

  handleMessage(message: unknown): void {
    if (this.stopped) {
      return
    }
    const parsed = WorkflowRuntimeCommandSchema.safeParse(unwrapParentPortMessage(message))
    if (!parsed.success) {
      this.failProtocol(readCandidateRunId(message), 'Invalid workflow utility command.')
      return
    }

    const command = parsed.data
    this.commandQueue = this.commandQueue.then(
      () => this.handleCommand(command),
      () => this.handleCommand(command)
    )
    void this.commandQueue.catch((error) => {
      this.failProtocol(command.runId, error instanceof Error ? error.message : String(error))
    })
  }

  shutdown(exitCode = 0): void {
    if (this.stopped) {
      return
    }
    this.stopped = true
    this.runtime?.dispose()
    this.runtime = null
    this.options.terminate(exitCode)
  }

  private async handleCommand(command: WorkflowRuntimeCommand): Promise<void> {
    if (this.stopped) {
      return
    }
    if (command.type === 'START') {
      await this.start(command)
      return
    }
    if (!this.runtime || !this.runId) {
      throw new Error('Workflow utility received a command before START.')
    }
    if (command.runId !== this.runId) {
      throw new Error('Workflow utility command runId does not match the active run.')
    }

    switch (command.type) {
      case 'SETTLE_INVOCATION':
        await this.runtime.settleInvocation(command.requestId, command.outcome)
        return
      case 'CANCEL':
        await this.runtime.cancel(command.reason)
        return
      case 'SHUTDOWN':
        this.shutdown(0)
        return
    }
  }

  private async start(command: Extract<WorkflowRuntimeCommand, { type: 'START' }>): Promise<void> {
    if (this.runtime || this.runId) {
      throw new Error('Workflow utility can only execute one run.')
    }
    this.runId = command.runId
    this.runtime = await QuickJSWorkflowRuntime.create({
      runId: command.runId,
      limits: command.limits,
      emit: (event) => this.options.postMessage(event)
    })
    this.options.postMessage(
      createWorkflowRuntimeEvent({
        type: 'READY',
        protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
        runId: command.runId,
        pid: process.pid
      })
    )

    void this.runtime.start(command.source, command.input).catch(() => {
      // QuickJSWorkflowRuntime emits one typed FAILED event before rejecting.
    })
  }

  private failProtocol(candidateRunId: string | null, message: string): void {
    if (this.stopped) {
      return
    }
    const runId = this.runId ?? candidateRunId
    if (runId) {
      this.options.postMessage(
        createWorkflowRuntimeEvent({
          type: 'FAILED',
          protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
          runId,
          error: {
            code: 'WORKFLOW_PROTOCOL_ERROR',
            message,
            retriable: false
          }
        })
      )
    }
    this.shutdown(1)
  }
}

export function runWorkflowUtilityHostIfRequested(): boolean {
  if (!isWorkflowUtilityHostRequest()) {
    return false
  }

  const parentPort = getParentPort()
  if (!parentPort) {
    throw new Error('Workflow utility host started without a parent port.')
  }

  const keepAliveIntervalId = setInterval(() => {}, 2 ** 31 - 1)
  const host = new WorkflowUtilityHost({
    postMessage: (message) => parentPort.postMessage(message),
    terminate: (exitCode) => {
      clearInterval(keepAliveIntervalId)
      process.exit(exitCode)
    }
  })

  parentPort.start?.()
  parentPort.on('message', (message) => host.handleMessage(message))
  process.once('beforeExit', () => {
    clearInterval(keepAliveIntervalId)
    host.shutdown(0)
  })
  return true
}

function getParentPort(): ParentPort | null {
  const maybeProcess = process as NodeJS.Process & {
    parentPort?: ParentPort
  }
  return maybeProcess.parentPort ?? null
}

function isWorkflowUtilityHostRequest(): boolean {
  return (
    process.env.DEEPCHAT_WORKFLOW_UTILITY_HOST === '1' ||
    process.argv.includes(WORKFLOW_UTILITY_HOST_ARG)
  )
}

function unwrapParentPortMessage(message: unknown): unknown {
  if (WorkflowRuntimeCommandSchema.safeParse(message).success) {
    return message
  }
  if (message && typeof message === 'object' && 'data' in message) {
    return (message as ParentPortMessageEvent).data
  }
  return message
}

function readCandidateRunId(message: unknown): string | null {
  const value = unwrapParentPortMessage(message)
  if (!value || typeof value !== 'object' || !('runId' in value)) {
    return null
  }
  const runId = (value as { runId?: unknown }).runId
  return typeof runId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(runId)
    ? runId
    : null
}
