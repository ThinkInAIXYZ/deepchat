export type OcrExtractionPriority = 'background' | 'interactive'

interface ScheduledTask<T> {
  priority: OcrExtractionPriority
  run: () => Promise<T>
  signal?: AbortSignal
  resolve: (value: T) => void
  reject: (error: unknown) => void
  abortListener?: () => void
}

const MAX_CONSECUTIVE_INTERACTIVE_TASKS = 4
const DEFAULT_MAX_PENDING_TASKS = 8

export class OcrExtractionScheduler {
  private readonly interactiveQueue: Array<ScheduledTask<unknown>> = []
  private readonly backgroundQueue: Array<ScheduledTask<unknown>> = []
  private active = false
  private closed = false
  private consecutiveInteractiveTasks = 0

  constructor(private readonly maxPendingTasks = DEFAULT_MAX_PENDING_TASKS) {
    if (!Number.isInteger(maxPendingTasks) || maxPendingTasks <= 0) {
      throw new Error('maxPendingTasks must be a positive integer')
    }
  }

  schedule<T>(
    run: () => Promise<T>,
    priority: OcrExtractionPriority,
    signal?: AbortSignal
  ): Promise<T> {
    if (this.closed) return Promise.reject(new OcrSchedulerError('closed'))
    if (signal?.aborted) return Promise.reject(new OcrSchedulerError('cancelled'))
    if (
      this.interactiveQueue.length + this.backgroundQueue.length + (this.active ? 1 : 0) >=
      this.maxPendingTasks
    ) {
      return Promise.reject(new OcrSchedulerError('queue_full'))
    }

    return new Promise<T>((resolve, reject) => {
      const task: ScheduledTask<T> = { priority, run, signal, resolve, reject }
      if (signal) {
        task.abortListener = () => {
          if (this.removeQueuedTask(task as ScheduledTask<unknown>)) {
            reject(new OcrSchedulerError('cancelled'))
          }
        }
        signal.addEventListener('abort', task.abortListener, { once: true })
      }
      this.queueFor(priority).push(task as ScheduledTask<unknown>)
      this.pump()
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const task of [...this.interactiveQueue, ...this.backgroundQueue]) {
      this.disposeAbortListener(task)
      task.reject(new OcrSchedulerError('closed'))
    }
    this.interactiveQueue.length = 0
    this.backgroundQueue.length = 0
  }

  getStatus(): { active: boolean; interactiveQueued: number; backgroundQueued: number } {
    return {
      active: this.active,
      interactiveQueued: this.interactiveQueue.length,
      backgroundQueued: this.backgroundQueue.length
    }
  }

  private pump(): void {
    if (this.active || this.closed) return
    const task = this.takeNextTask()
    if (!task) return
    this.active = true
    this.disposeAbortListener(task)

    if (task.signal?.aborted) {
      this.active = false
      task.reject(new OcrSchedulerError('cancelled'))
      queueMicrotask(() => this.pump())
      return
    }

    Promise.resolve()
      .then(task.run)
      .then(task.resolve, task.reject)
      .finally(() => {
        this.active = false
        this.pump()
      })
  }

  private takeNextTask(): ScheduledTask<unknown> | undefined {
    const shouldRunBackground =
      this.backgroundQueue.length > 0 &&
      (this.interactiveQueue.length === 0 ||
        this.consecutiveInteractiveTasks >= MAX_CONSECUTIVE_INTERACTIVE_TASKS)
    if (shouldRunBackground) {
      this.consecutiveInteractiveTasks = 0
      return this.backgroundQueue.shift()
    }
    const interactive = this.interactiveQueue.shift()
    if (interactive) {
      this.consecutiveInteractiveTasks += 1
      return interactive
    }
    this.consecutiveInteractiveTasks = 0
    return this.backgroundQueue.shift()
  }

  private queueFor(priority: OcrExtractionPriority): Array<ScheduledTask<unknown>> {
    return priority === 'interactive' ? this.interactiveQueue : this.backgroundQueue
  }

  private removeQueuedTask(task: ScheduledTask<unknown>): boolean {
    const queue = this.queueFor(task.priority)
    const index = queue.indexOf(task)
    if (index < 0) return false
    queue.splice(index, 1)
    this.disposeAbortListener(task)
    return true
  }

  private disposeAbortListener(task: ScheduledTask<unknown>): void {
    if (task.signal && task.abortListener) {
      task.signal.removeEventListener('abort', task.abortListener)
      task.abortListener = undefined
    }
  }
}

export class OcrSchedulerError extends Error {
  constructor(readonly code: 'cancelled' | 'closed' | 'queue_full') {
    super(
      code === 'cancelled'
        ? 'OCR extraction was cancelled'
        : code === 'queue_full'
          ? 'OCR extraction queue is full'
          : 'OCR scheduler is closed'
    )
    this.name = 'OcrSchedulerError'
  }
}
