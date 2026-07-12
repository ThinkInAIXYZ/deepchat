import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { AgentSessionSendInput } from '@/agent/shared/agentSessionHandle'
import type {
  DeepChatSessionState,
  IAgentImplementation,
  MessageStartResult,
  SessionGenerationSettings
} from '@shared/types/agent-interface'

export interface DeepChatAgentInstanceDelegate {
  readonly compatibilityImplementation: IAgentImplementation
  send(input: AgentSessionSendInput): Promise<MessageStartResult>
  cancel(): Promise<void>
  snapshot(options?: { lightweight?: boolean }): Promise<DeepChatSessionState | null>
  close(): Promise<void>
}

export class DeepChatAgentInstance {
  readonly kind = 'deepchat' as const
  private runtimeState?: DeepChatSessionState
  private generationSettings?: SessionGenerationSettings
  private agentId?: string
  private projectDir?: string | null
  private firstTurnReady = false
  private readonly firstTurnReadyWaiters = new Set<(ready: boolean) => void>()

  constructor(
    readonly sessionId: AppSessionId,
    private readonly delegate: DeepChatAgentInstanceDelegate,
    private readonly onClosed: (instance: DeepChatAgentInstance) => void
  ) {}

  get compatibilityImplementation(): IAgentImplementation {
    return this.delegate.compatibilityImplementation
  }

  getRuntimeState(): DeepChatSessionState | undefined {
    return this.runtimeState
  }

  setRuntimeState(state: DeepChatSessionState): void {
    this.runtimeState = state
  }

  getGenerationSettings(): SessionGenerationSettings | undefined {
    return this.generationSettings
  }

  setGenerationSettings(settings: SessionGenerationSettings): void {
    this.generationSettings = settings
  }

  getAgentId(): string | undefined {
    return this.agentId
  }

  setAgentId(agentId: string): void {
    this.agentId = agentId
  }

  hasProjectDir(): boolean {
    return this.projectDir !== undefined
  }

  getProjectDir(): string | null {
    return this.projectDir ?? null
  }

  setProjectDir(projectDir: string | null): void {
    this.projectDir = projectDir
  }

  async waitForFirstTurnReady(options?: { timeoutMs?: number }): Promise<boolean> {
    if (this.firstTurnReady) return true

    const timeoutMs = Math.max(0, options?.timeoutMs ?? 30000)
    if (timeoutMs === 0) return false

    return await new Promise<boolean>((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout>
      const settle = (ready: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.firstTurnReadyWaiters.delete(settle)
        resolve(ready)
      }

      this.firstTurnReadyWaiters.add(settle)
      timer = setTimeout(() => settle(false), timeoutMs)
    })
  }

  markFirstTurnReady(): void {
    if (this.firstTurnReady) return
    this.firstTurnReady = true
    this.settleFirstTurnReadyWaiters(true)
  }

  clearFirstTurnReady(): void {
    this.firstTurnReady = false
    this.settleFirstTurnReadyWaiters(false)
  }

  clearOwnedState(): void {
    this.runtimeState = undefined
    this.generationSettings = undefined
    this.agentId = undefined
    this.projectDir = undefined
    this.clearFirstTurnReady()
  }

  async send(input: AgentSessionSendInput): Promise<MessageStartResult> {
    return await this.delegate.send(input)
  }

  async cancel(): Promise<void> {
    await this.delegate.cancel()
  }

  async snapshot(options?: { lightweight?: boolean }): Promise<DeepChatSessionState | null> {
    return await this.delegate.snapshot(options)
  }

  async close(): Promise<void> {
    try {
      await this.delegate.close()
    } finally {
      this.onClosed(this)
    }
  }

  private settleFirstTurnReadyWaiters(ready: boolean): void {
    const waiters = [...this.firstTurnReadyWaiters]
    this.firstTurnReadyWaiters.clear()
    for (const waiter of waiters) waiter(ready)
  }
}
