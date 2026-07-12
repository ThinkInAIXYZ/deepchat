import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { AgentSessionSendInput } from '@/agent/shared/agentSessionHandle'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
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

export interface DeepChatPendingInteractionRef {
  readonly messageId: string
  readonly toolCallId: string
}

export interface DeepChatActiveProviderPermission {
  readonly requestId: string
  readonly messageId: string
  readonly toolCallId: string
  readonly providerId: string
  readonly permissionType: 'read' | 'write' | 'all' | 'command'
  readonly resolve: (granted: boolean) => Promise<void>
}

export interface DeepChatSystemPromptCacheEntry {
  readonly prompt: string
  readonly dayKey: string
  readonly fingerprint: string
}

export type DeepChatToolProfileKind = 'code' | 'research' | 'analysis' | 'general'

export interface DeepChatToolProfileCacheEntry {
  readonly profile: DeepChatToolProfileKind
  readonly fingerprint: string
  readonly tools: MCPToolDefinition[]
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
  private pendingInteractions: DeepChatPendingInteractionRef[] = []
  private readonly interactionLocks = new Set<string>()
  private readonly resumingMessages = new Set<string>()
  private readonly deferredToolAbortControllers = new Map<string, AbortController>()
  private readonly activeProviderPermissions = new Map<string, DeepChatActiveProviderPermission>()
  private readonly runtimeActivatedSkills = new Set<string>()
  private systemPromptCache?: DeepChatSystemPromptCacheEntry
  private toolProfileCache?: DeepChatToolProfileCacheEntry

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

  replacePendingInteractions(interactions: readonly DeepChatPendingInteractionRef[]): void {
    this.pendingInteractions = interactions.map((interaction) => ({ ...interaction }))
  }

  getFirstPendingInteraction(): DeepChatPendingInteractionRef | undefined {
    const first = this.pendingInteractions[0]
    return first ? { ...first } : undefined
  }

  hasPendingInteractions(): boolean {
    return this.pendingInteractions.length > 0
  }

  tryLockInteraction(messageId: string, toolCallId: string): boolean {
    const key = this.buildInteractionKey(messageId, toolCallId)
    if (this.interactionLocks.has(key)) {
      return false
    }
    this.interactionLocks.add(key)
    return true
  }

  unlockInteraction(messageId: string, toolCallId: string): void {
    this.interactionLocks.delete(this.buildInteractionKey(messageId, toolCallId))
  }

  tryBeginResume(messageId: string): boolean {
    if (this.resumingMessages.has(messageId)) {
      return false
    }
    this.resumingMessages.add(messageId)
    return true
  }

  finishResume(messageId: string): void {
    this.resumingMessages.delete(messageId)
  }

  registerDeferredToolAbortController(toolCallId: string): AbortController {
    this.deferredToolAbortControllers.get(toolCallId)?.abort()
    const controller = new AbortController()
    this.deferredToolAbortControllers.set(toolCallId, controller)
    return controller
  }

  clearDeferredToolAbortController(toolCallId: string, controller?: AbortController): boolean {
    const current = this.deferredToolAbortControllers.get(toolCallId)
    if (!current || (controller && current !== controller)) {
      return false
    }
    this.deferredToolAbortControllers.delete(toolCallId)
    return true
  }

  hasDeferredToolAbortController(toolCallId: string): boolean {
    return this.deferredToolAbortControllers.has(toolCallId)
  }

  abortDeferredToolCalls(): void {
    for (const controller of this.deferredToolAbortControllers.values()) {
      controller.abort()
    }
    this.deferredToolAbortControllers.clear()
  }

  registerActiveProviderPermission(permission: DeepChatActiveProviderPermission): void {
    this.activeProviderPermissions.set(permission.requestId, permission)
  }

  getActiveProviderPermission(requestId: string): DeepChatActiveProviderPermission | undefined {
    return this.activeProviderPermissions.get(requestId)
  }

  clearActiveProviderPermission(
    requestId: string,
    expected?: DeepChatActiveProviderPermission
  ): boolean {
    const current = this.activeProviderPermissions.get(requestId)
    if (!current || (expected && current !== expected)) {
      return false
    }
    this.activeProviderPermissions.delete(requestId)
    return true
  }

  takeActiveProviderPermissions(): DeepChatActiveProviderPermission[] {
    const permissions = [...this.activeProviderPermissions.values()]
    this.activeProviderPermissions.clear()
    return permissions
  }

  hasActiveProviderPermission(requestId: string): boolean {
    return this.activeProviderPermissions.has(requestId)
  }

  replaceRuntimeActivatedSkills(skillNames: readonly string[]): void {
    this.runtimeActivatedSkills.clear()
    for (const skillName of skillNames) {
      const normalized = skillName.trim()
      if (normalized) this.runtimeActivatedSkills.add(normalized)
    }
  }

  getRuntimeActivatedSkills(): string[] {
    return [...this.runtimeActivatedSkills].sort((left, right) => left.localeCompare(right))
  }

  activateRuntimeSkill(skillName: string): string[] {
    const normalized = skillName.trim()
    if (!normalized) return this.getRuntimeActivatedSkills()

    this.runtimeActivatedSkills.add(normalized)
    this.invalidateResourceCaches()
    return this.getRuntimeActivatedSkills()
  }

  getSystemPromptCache(): DeepChatSystemPromptCacheEntry | undefined {
    return this.systemPromptCache
  }

  setSystemPromptCache(entry: DeepChatSystemPromptCacheEntry): void {
    this.systemPromptCache = entry
  }

  invalidateSystemPromptCache(): void {
    this.systemPromptCache = undefined
  }

  getToolProfileCache(): DeepChatToolProfileCacheEntry | undefined {
    return this.toolProfileCache
  }

  setToolProfileCache(entry: DeepChatToolProfileCacheEntry): void {
    this.toolProfileCache = entry
  }

  invalidateToolProfileCache(): void {
    this.toolProfileCache = undefined
  }

  invalidateResourceCaches(): void {
    this.invalidateSystemPromptCache()
    this.invalidateToolProfileCache()
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
    this.pendingInteractions = []
    this.interactionLocks.clear()
    this.resumingMessages.clear()
    this.abortDeferredToolCalls()
    this.activeProviderPermissions.clear()
    this.runtimeActivatedSkills.clear()
    this.invalidateResourceCaches()
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

  private buildInteractionKey(messageId: string, toolCallId: string): string {
    return `${messageId}:${toolCallId}`
  }
}
