export interface SessionDeletionGatePort {
  runWithSessionOperation<T>(sessionId: string, operation: () => Promise<T>): Promise<T>
  runWithSessionDeletion<T>(sessionId: string, deletion: () => Promise<T>): Promise<T>
}

export const SESSION_OPERATION_DRAIN_TIMEOUT_MS = 30_000

export class SessionDeletionGate implements SessionDeletionGatePort {
  private readonly activeOperations = new Map<string, number>()
  private readonly deletingSessionIds = new Set<string>()
  private readonly drainWaiters = new Map<string, Set<() => void>>()

  constructor(
    private readonly operationDrainTimeoutMs: number = SESSION_OPERATION_DRAIN_TIMEOUT_MS
  ) {
    if (!Number.isFinite(operationDrainTimeoutMs) || operationDrainTimeoutMs <= 0) {
      throw new Error('Session operation drain timeout must be a positive finite number.')
    }
  }

  async runWithSessionOperation<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const normalizedSessionId = this.normalizeSessionId(sessionId)
    if (this.deletingSessionIds.has(normalizedSessionId)) {
      throw new Error(`Session is being deleted: ${normalizedSessionId}`)
    }

    this.activeOperations.set(
      normalizedSessionId,
      (this.activeOperations.get(normalizedSessionId) ?? 0) + 1
    )
    try {
      return await operation()
    } finally {
      this.finishSessionOperation(normalizedSessionId)
    }
  }

  async runWithSessionDeletion<T>(sessionId: string, deletion: () => Promise<T>): Promise<T> {
    const normalizedSessionId = this.normalizeSessionId(sessionId)
    if (this.deletingSessionIds.has(normalizedSessionId)) {
      throw new Error(`Session deletion is already in progress: ${normalizedSessionId}`)
    }

    this.deletingSessionIds.add(normalizedSessionId)
    try {
      await this.waitForSessionOperations(normalizedSessionId)
      return await deletion()
    } finally {
      this.deletingSessionIds.delete(normalizedSessionId)
    }
  }

  private normalizeSessionId(sessionId: string): string {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) throw new Error('Session ID is required.')
    return normalizedSessionId
  }

  private finishSessionOperation(sessionId: string): void {
    const remaining = (this.activeOperations.get(sessionId) ?? 1) - 1
    if (remaining > 0) {
      this.activeOperations.set(sessionId, remaining)
      return
    }

    this.activeOperations.delete(sessionId)
    const waiters = this.drainWaiters.get(sessionId)
    this.drainWaiters.delete(sessionId)
    for (const resolve of waiters ?? []) resolve()
  }

  private async waitForSessionOperations(sessionId: string): Promise<void> {
    if ((this.activeOperations.get(sessionId) ?? 0) === 0) return
    await new Promise<void>((resolve, reject) => {
      let waiters = this.drainWaiters.get(sessionId)
      if (!waiters) {
        waiters = new Set()
        this.drainWaiters.set(sessionId, waiters)
      }

      const waiter = (): void => {
        clearTimeout(timeout)
        resolve()
      }
      const timeout = setTimeout(() => {
        const currentWaiters = this.drainWaiters.get(sessionId)
        currentWaiters?.delete(waiter)
        if (currentWaiters?.size === 0 && this.drainWaiters.get(sessionId) === currentWaiters) {
          this.drainWaiters.delete(sessionId)
        }
        reject(
          new Error(
            `Timed out waiting for active Session operations to drain: ${sessionId} ` +
              `(${this.operationDrainTimeoutMs}ms)`
          )
        )
      }, this.operationDrainTimeoutMs)
      waiters.add(waiter)
    })
  }
}
