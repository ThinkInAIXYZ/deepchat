import type { AcpClientRuntime } from './index'

export interface AcpDirectRuntimeLifecycle {
  closeAll(): Promise<void>
  closeByAgent(agentId: string): Promise<void>
}

export class AcpRuntimeOwner {
  private runtime?: AcpClientRuntime
  private directLifecycle?: AcpDirectRuntimeLifecycle
  private shutdownPromise?: Promise<void>
  private state: 'open' | 'shutting-down' | 'closed' = 'open'

  constructor(private readonly createRuntime: () => AcpClientRuntime) {}

  getOrCreate(): AcpClientRuntime {
    if (this.state !== 'open') {
      throw new Error(`[ACP] Runtime owner is ${this.state}`)
    }
    return (this.runtime ??= this.createRuntime())
  }

  peek(): AcpClientRuntime | undefined {
    return this.runtime
  }

  registerDirectRuntime(lifecycle: AcpDirectRuntimeLifecycle): () => void {
    if (this.state !== 'open') {
      throw new Error(`[ACP] Cannot register direct runtime while owner is ${this.state}`)
    }
    if (this.directLifecycle && this.directLifecycle !== lifecycle) {
      throw new Error('[ACP] A direct runtime lifecycle is already registered')
    }
    this.directLifecycle = lifecycle
    return () => {
      if (this.directLifecycle === lifecycle) this.directLifecycle = undefined
    }
  }

  async refreshAgents(agentIds: readonly string[]): Promise<void> {
    if (this.state !== 'open') {
      throw new Error(`[ACP] Cannot refresh agents while runtime owner is ${this.state}`)
    }
    const runtime = this.runtime
    if (!runtime) return
    for (const agentId of new Set(agentIds)) {
      await this.directLifecycle?.closeByAgent(agentId)
      await runtime.sessionManager.clearSessionsByAgent(agentId)
      await runtime.processManager.release(agentId)
    }
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return await this.shutdownPromise
    if (this.state === 'closed') return
    this.state = 'shutting-down'
    const runtime = this.runtime

    this.shutdownPromise = (async () => {
      try {
        await this.directLifecycle?.closeAll()
      } finally {
        if (runtime) {
          try {
            await runtime.sessionManager.clearAllSessions()
          } finally {
            try {
              await runtime.processManager.shutdown()
            } finally {
              if (this.runtime === runtime) this.runtime = undefined
            }
          }
        }
      }
    })().finally(() => {
      this.state = 'closed'
    })

    await this.shutdownPromise
  }
}
