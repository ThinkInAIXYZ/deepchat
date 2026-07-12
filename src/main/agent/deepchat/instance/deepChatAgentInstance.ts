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

export interface DeepChatActiveGeneration {
  readonly runId: string
  readonly messageId: string
  readonly abortController: AbortController
}

export class DeepChatAgentInstance {
  readonly kind = 'deepchat' as const
  private runtimeState?: DeepChatSessionState
  private generationSettings?: SessionGenerationSettings
  private agentId?: string
  private projectDir?: string | null
  private firstTurnReady = false
  private readonly firstTurnReadyWaiters = new Set<(ready: boolean) => void>()
  private abortController?: AbortController
  private activeGeneration?: DeepChatActiveGeneration
  private activeSteerPendingInputId?: string
  private pendingQueueDraining = false

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

  getAbortController(): AbortController | undefined {
    return this.abortController
  }

  getAbortSignal(): AbortSignal | undefined {
    return this.activeGeneration?.abortController.signal ?? this.abortController?.signal
  }

  setAbortController(controller: AbortController): void {
    this.abortController = controller
  }

  clearAbortController(controller?: AbortController): boolean {
    if (!this.abortController || (controller && this.abortController !== controller)) {
      return false
    }
    this.abortController = undefined
    return true
  }

  getActiveGeneration(): DeepChatActiveGeneration | undefined {
    return this.activeGeneration
  }

  registerActiveGeneration(
    runId: string,
    messageId: string,
    abortController: AbortController
  ): DeepChatActiveGeneration {
    const generation = { runId, messageId, abortController }
    this.activeGeneration = generation
    this.abortController = abortController
    return generation
  }

  clearActiveGeneration(runId: string): boolean {
    if (!this.activeGeneration || this.activeGeneration.runId !== runId) {
      return false
    }
    const { abortController } = this.activeGeneration
    this.activeGeneration = undefined
    this.clearAbortController(abortController)
    return true
  }

  isActiveRun(runId: string): boolean {
    return this.activeGeneration?.runId === runId
  }

  requestGenerationAbort(): void {
    if (this.activeGeneration) {
      this.activeGeneration.abortController.abort()
      return
    }
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = undefined
    }
  }

  abortAndClearGeneration(): void {
    const controller = this.activeGeneration?.abortController ?? this.abortController
    controller?.abort()
    this.abortController = undefined
    this.activeGeneration = undefined
  }

  getActiveSteerPendingInputId(): string | undefined {
    return this.activeSteerPendingInputId
  }

  setActiveSteerPendingInputId(itemId: string): void {
    this.activeSteerPendingInputId = itemId
  }

  clearActiveSteerPendingInputId(expectedItemId?: string): boolean {
    if (
      !this.activeSteerPendingInputId ||
      (expectedItemId && this.activeSteerPendingInputId !== expectedItemId)
    ) {
      return false
    }
    this.activeSteerPendingInputId = undefined
    return true
  }

  isPendingQueueDraining(): boolean {
    return this.pendingQueueDraining
  }

  markPendingQueueDrainStarted(): void {
    this.pendingQueueDraining = true
  }

  markPendingQueueDrainFinished(): void {
    this.pendingQueueDraining = false
  }

  clearOwnedState(): void {
    this.abortAndClearGeneration()
    this.runtimeState = undefined
    this.generationSettings = undefined
    this.agentId = undefined
    this.projectDir = undefined
    this.clearFirstTurnReady()
    this.activeSteerPendingInputId = undefined
    this.pendingQueueDraining = false
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
