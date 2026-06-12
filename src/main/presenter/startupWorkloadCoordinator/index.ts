import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import type { z } from 'zod'
import {
  StartupWorkloadChangedPayloadSchema,
  StartupWorkloadPhaseSchema,
  StartupWorkloadStateSchema,
  StartupWorkloadTargetSchema,
  StartupWorkloadTaskIdSchema,
  StartupWorkloadTaskSchema
} from '@shared/contracts/common'

type StartupWorkloadTarget = z.output<typeof StartupWorkloadTargetSchema>
type StartupWorkloadPhase = z.output<typeof StartupWorkloadPhaseSchema>
type StartupWorkloadState = z.output<typeof StartupWorkloadStateSchema>
type StartupWorkloadTaskId = z.output<typeof StartupWorkloadTaskIdSchema>
type StartupWorkloadTask = z.output<typeof StartupWorkloadTaskSchema>
type StartupWorkloadPayload = z.output<typeof StartupWorkloadChangedPayloadSchema>
type StartupWorkloadResource = 'cpu' | 'io'

type StartupWorkloadTaskContext = {
  signal: AbortSignal
  reportProgress: (progress: number) => void
  yield: () => Promise<void>
}

type StartupWorkloadTaskOptions<T> = {
  id: string
  target: StartupWorkloadTarget
  phase: StartupWorkloadPhase
  resource: StartupWorkloadResource
  labelKey: string
  visibleId?: StartupWorkloadTaskId
  dedupeKey?: string
  runId?: string
  run: (context: StartupWorkloadTaskContext) => Promise<T>
}

type StartupWorkloadRunState = {
  runId: string
  visibleTasks: Map<StartupWorkloadTaskId, StartupTaskRecord<unknown>>
  tasks: Set<StartupTaskRecord<unknown>>
}

type StartupTaskRecord<T> = {
  internalKey: string
  dedupeKey: string
  id: string
  visibleId?: StartupWorkloadTaskId
  target: StartupWorkloadTarget
  phase: StartupWorkloadPhase
  resource: StartupWorkloadResource
  labelKey: string
  runId: string
  sequence: number
  state: StartupWorkloadState
  progress?: number
  startedAt?: number
  updatedAt?: number
  controller: AbortController
  run: (context: StartupWorkloadTaskContext) => Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
  promise: Promise<T>
}

const PHASE_PRIORITY: Record<StartupWorkloadPhase, number> = {
  interactive: 0,
  deferred: 1,
  background: 2
}

const MAX_CONCURRENCY: Record<StartupWorkloadResource, number> = {
  cpu: 1,
  io: 2
}

export class StartupWorkloadCoordinator {
  private readonly runs = new Map<StartupWorkloadTarget, StartupWorkloadRunState>()
  private readonly pendingTasks: StartupTaskRecord<unknown>[] = []
  private readonly runningCounts: Record<StartupWorkloadResource, number> = {
    cpu: 0,
    io: 0
  }
  private readonly inFlightByDedupeKey = new Map<string, StartupTaskRecord<unknown>>()
  private sequence = 0
  private runSequence = 0
  private pumping = false

  createRun(target: StartupWorkloadTarget): string {
    this.cancelTarget(target)
    const runId = `${target}:${Date.now()}:${++this.runSequence}`
    this.runs.set(target, {
      runId,
      visibleTasks: new Map(),
      tasks: new Set()
    })
    this.publishSnapshot(target)
    return runId
  }

  ensureRun(target: StartupWorkloadTarget): string {
    return this.runs.get(target)?.runId ?? this.createRun(target)
  }

  getRunId(target: StartupWorkloadTarget): string {
    return this.ensureRun(target)
  }

  cancelTarget(target: StartupWorkloadTarget): void {
    const runState = this.runs.get(target)
    if (!runState) {
      return
    }

    const tasks = [...runState.tasks]
    for (const task of tasks) {
      if (task.state === 'pending') {
        this.removePendingTask(task.internalKey)
      }

      if (task.state === 'pending' || task.state === 'running') {
        task.controller.abort()
        task.state = 'cancelled'
        task.updatedAt = Date.now()
        task.reject(this.createAbortError(task.id))
      }

      if (!task.visibleId) {
        runState.tasks.delete(task)
      }
    }

    this.publishSnapshot(target)
    this.runs.delete(target)
  }

  replayTarget(target: StartupWorkloadTarget): void {
    if (!this.runs.has(target)) {
      this.ensureRun(target)
    }
    this.publishSnapshot(target)
  }

  isIdle(): boolean {
    return (
      this.pendingTasks.length === 0 && this.runningCounts.cpu === 0 && this.runningCounts.io === 0
    )
  }

  async scheduleTask<T>(options: StartupWorkloadTaskOptions<T>): Promise<T> {
    const runId = options.runId ?? this.ensureRun(options.target)
    const runState = this.runs.get(options.target)
    if (!runState || runState.runId !== runId) {
      throw this.createAbortError(options.id)
    }

    const dedupeKey = `${runId}:${options.dedupeKey ?? options.id}`
    const existing = this.inFlightByDedupeKey.get(dedupeKey)
    if (existing) {
      return existing.promise as Promise<T>
    }

    if (options.visibleId) {
      const previous = runState.visibleTasks.get(options.visibleId)
      if (previous && (previous.state === 'pending' || previous.state === 'running')) {
        return previous.promise as Promise<T>
      }
      if (previous) {
        runState.visibleTasks.delete(options.visibleId)
        runState.tasks.delete(previous)
      }
    }

    const controller = new AbortController()
    let resolveTask!: (value: T | PromiseLike<T>) => void
    let rejectTask!: (reason?: unknown) => void
    const promise = new Promise<T>((resolve, reject) => {
      resolveTask = resolve
      rejectTask = reject
    })

    const now = Date.now()
    const task: StartupTaskRecord<T> = {
      internalKey: `${runId}:${++this.sequence}`,
      dedupeKey,
      id: options.id,
      visibleId: options.visibleId,
      target: options.target,
      phase: options.phase,
      resource: options.resource,
      labelKey: options.labelKey,
      runId,
      sequence: this.sequence,
      state: 'pending',
      updatedAt: now,
      controller,
      run: options.run,
      resolve: resolveTask,
      reject: rejectTask,
      promise
    }

    runState.tasks.add(task as StartupTaskRecord<unknown>)
    if (options.visibleId) {
      runState.visibleTasks.set(options.visibleId, task as StartupTaskRecord<unknown>)
    }
    this.inFlightByDedupeKey.set(dedupeKey, task as StartupTaskRecord<unknown>)
    this.pendingTasks.push(task as StartupTaskRecord<unknown>)
    this.publishSnapshot(options.target)
    this.pump()

    return promise
  }

  async whenIdle<T>(target: StartupWorkloadTarget, callback: () => Promise<T>): Promise<T> {
    if (this.isIdle()) {
      return await callback()
    }

    return await this.scheduleTask({
      id: `${target}:idle`,
      target,
      phase: 'background',
      resource: 'io',
      labelKey: 'startup.workload.idle',
      dedupeKey: `${target}:idle`,
      run: async () => {
        return await callback()
      }
    })
  }

  static async yieldToMain(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new Error('aborted')
    }

    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })

    if (signal?.aborted) {
      throw new Error('aborted')
    }
  }

  private pump(): void {
    if (this.pumping) {
      return
    }

    this.pumping = true

    try {
      while (true) {
        const nextTask = this.pickNextTask()
        if (!nextTask) {
          break
        }
        this.startTask(nextTask).catch((error) => {
          console.error('[StartupWorkloadCoordinator] Task execution failed:', error)
        })
      }
    } finally {
      this.pumping = false
    }
  }

  private pickNextTask(): StartupTaskRecord<unknown> | null {
    const sortedPending = [...this.pendingTasks].sort((left, right) => {
      const phaseDelta = PHASE_PRIORITY[left.phase] - PHASE_PRIORITY[right.phase]
      if (phaseDelta !== 0) {
        return phaseDelta
      }
      return left.sequence - right.sequence
    })

    for (const task of sortedPending) {
      if (this.runningCounts[task.resource] >= MAX_CONCURRENCY[task.resource]) {
        continue
      }

      this.removePendingTask(task.internalKey)
      return task
    }

    return null
  }

  private async startTask(task: StartupTaskRecord<unknown>): Promise<void> {
    const runState = this.runs.get(task.target)
    if (!runState || runState.runId !== task.runId) {
      task.reject(this.createAbortError(task.id))
      this.finishTask(task, 'cancelled')
      return
    }

    if (task.controller.signal.aborted) {
      this.finishTask(task, 'cancelled')
      return
    }

    this.runningCounts[task.resource] += 1
    task.state = 'running'
    task.startedAt = task.startedAt ?? Date.now()
    task.updatedAt = Date.now()
    this.publishSnapshot(task.target)

    const context: StartupWorkloadTaskContext = {
      signal: task.controller.signal,
      reportProgress: (progress) => {
        task.progress = Math.max(0, Math.min(1, progress))
        task.updatedAt = Date.now()
        this.publishSnapshot(task.target)
      },
      yield: async () => {
        await StartupWorkloadCoordinator.yieldToMain(task.controller.signal)
      }
    }

    try {
      const result = await task.run(context)
      if (task.controller.signal.aborted) {
        task.reject(this.createAbortError(task.id))
        this.finishTask(task, 'cancelled')
        return
      }

      task.resolve(result)
      this.finishTask(task, 'completed')
    } catch (error) {
      if (task.controller.signal.aborted || this.isAbortError(error)) {
        task.reject(this.createAbortError(task.id))
        this.finishTask(task, 'cancelled')
        return
      }

      task.reject(error)
      this.finishTask(task, 'failed')
    } finally {
      this.runningCounts[task.resource] -= 1
      this.pump()
    }
  }

  private finishTask(task: StartupTaskRecord<unknown>, finalState: StartupWorkloadState): void {
    task.state = finalState
    task.updatedAt = Date.now()
    this.inFlightByDedupeKey.delete(task.dedupeKey)

    const runState = this.runs.get(task.target)
    if (!runState || runState.runId !== task.runId) {
      return
    }

    if (!task.visibleId) {
      runState.tasks.delete(task)
    } else {
      runState.visibleTasks.set(task.visibleId, task)
    }

    this.publishSnapshot(task.target)
  }

  private removePendingTask(internalKey: string): void {
    const index = this.pendingTasks.findIndex((task) => task.internalKey === internalKey)
    if (index >= 0) {
      this.pendingTasks.splice(index, 1)
    }
  }

  private publishSnapshot(target: StartupWorkloadTarget): void {
    const runState = this.runs.get(target)
    if (!runState) {
      return
    }

    const tasks = [...runState.visibleTasks.values()]
      .sort((left, right) => {
        const phaseDelta = PHASE_PRIORITY[left.phase] - PHASE_PRIORITY[right.phase]
        if (phaseDelta !== 0) {
          return phaseDelta
        }
        return left.sequence - right.sequence
      })
      .map((task) => this.toPublicTask(task))

    const payload: StartupWorkloadPayload = {
      startupRunId: runState.runId,
      target,
      tasks
    }

    publishDeepchatEvent('startup.workload.changed', payload)
  }

  private toPublicTask(task: StartupTaskRecord<unknown>): StartupWorkloadTask {
    if (!task.visibleId) {
      throw new Error(`Task ${task.id} cannot be published without a visibleId`)
    }

    return {
      id: task.visibleId,
      phase: task.phase,
      state: task.state,
      labelKey: task.labelKey,
      progress: task.progress,
      startedAt: task.startedAt,
      updatedAt: task.updatedAt
    }
  }

  private createAbortError(taskId: string): Error {
    const error = new Error(`Startup workload task "${taskId}" was cancelled`)
    error.name = 'AbortError'
    return error
  }

  private isAbortError(error: unknown): boolean {
    return Boolean(
      error &&
      typeof error === 'object' &&
      'name' in error &&
      (error as { name?: string }).name === 'AbortError'
    )
  }
}

export type { StartupWorkloadTaskOptions, StartupWorkloadTaskContext }
