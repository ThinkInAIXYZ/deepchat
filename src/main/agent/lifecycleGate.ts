export interface AgentLifecycleGatePort {
  runWithAgentOperation<T>(agentId: string, operation: () => Promise<T>): Promise<T>
  runWithAgentDeletion<T>(agentId: string, deletion: () => Promise<T>): Promise<T>
}

export class AgentLifecycleGate implements AgentLifecycleGatePort {
  private readonly activeOperations = new Map<string, number>()
  private readonly deletingAgentIds = new Set<string>()
  private readonly drainWaiters = new Map<string, Set<() => void>>()

  async runWithAgentOperation<T>(agentId: string, operation: () => Promise<T>): Promise<T> {
    const normalizedAgentId = this.normalizeAgentId(agentId)
    if (this.deletingAgentIds.has(normalizedAgentId)) {
      throw new Error(`DeepChat Agent is being deleted: ${normalizedAgentId}`)
    }

    this.activeOperations.set(
      normalizedAgentId,
      (this.activeOperations.get(normalizedAgentId) ?? 0) + 1
    )
    try {
      return await operation()
    } finally {
      this.finishAgentOperation(normalizedAgentId)
    }
  }

  async runWithAgentDeletion<T>(agentId: string, deletion: () => Promise<T>): Promise<T> {
    const normalizedAgentId = this.normalizeAgentId(agentId)
    if (this.deletingAgentIds.has(normalizedAgentId)) {
      throw new Error(`DeepChat Agent deletion is already in progress: ${normalizedAgentId}`)
    }

    this.deletingAgentIds.add(normalizedAgentId)
    try {
      await this.waitForAgentOperations(normalizedAgentId)
      return await deletion()
    } finally {
      this.deletingAgentIds.delete(normalizedAgentId)
    }
  }

  private normalizeAgentId(agentId: string): string {
    const normalizedAgentId = agentId.trim()
    if (!normalizedAgentId) throw new Error('Agent id is required.')
    return normalizedAgentId
  }

  private finishAgentOperation(agentId: string): void {
    const remaining = (this.activeOperations.get(agentId) ?? 1) - 1
    if (remaining > 0) {
      this.activeOperations.set(agentId, remaining)
      return
    }

    this.activeOperations.delete(agentId)
    const waiters = this.drainWaiters.get(agentId)
    this.drainWaiters.delete(agentId)
    for (const resolve of waiters ?? []) resolve()
  }

  private async waitForAgentOperations(agentId: string): Promise<void> {
    if ((this.activeOperations.get(agentId) ?? 0) === 0) return
    await new Promise<void>((resolve) => {
      let waiters = this.drainWaiters.get(agentId)
      if (!waiters) {
        waiters = new Set()
        this.drainWaiters.set(agentId, waiters)
      }
      waiters.add(resolve)
    })
  }
}
