import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { LoopRun } from '@/agent/deepchat/loop/loopRun'
import type {
  DeepChatSessionState,
  SessionCompactionState,
  SessionGenerationSettings
} from '@shared/types/agent-interface'
import type {
  PendingToolInteractionOrigin,
  PersistedToolBatchState
} from '@/agent/deepchat/loop/ports'
import type { MemorySessionHandle } from '@/agent/deepchat/memory/memoryPromptContributor'

export type DeepChatActiveGeneration = LoopRun<unknown>
export type PendingQueueDrainLease = symbol

export interface DeepChatPendingInteractionRef {
  readonly messageId: string
  readonly toolCallId: string
  readonly origin: PendingToolInteractionOrigin | 'acp-permission'
  readonly order: number
}

export interface DeepChatActiveProviderPermission {
  readonly requestId: string
  readonly messageId: string
  readonly toolCallId: string
  readonly providerId: string
  readonly permissionType: 'read' | 'write' | 'all' | 'command'
  readonly resolve: (granted: boolean) => Promise<void>
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
  private activeRun?: DeepChatActiveGeneration
  private preStreamTranscriptAnchorId?: string
  private activeSteerPendingInputId?: string
  private pendingQueueDrainLease?: PendingQueueDrainLease
  private pendingInteractions: DeepChatPendingInteractionRef[] = []
  private pendingToolBatchState?: PersistedToolBatchState
  private readonly interactionLocks = new Set<string>()
  private readonly resumingMessages = new Set<string>()
  private readonly deferredToolAbortControllers = new Map<string, AbortController>()
  private readonly activeProviderPermissions = new Map<string, DeepChatActiveProviderPermission>()
  private readonly runtimeActivatedSkills = new Set<string>()
  private toolProfileCache?: DeepChatToolProfileCacheEntry
  private compactionState?: SessionCompactionState
  private readonly memorySessionHandle: MemorySessionHandle

  constructor(readonly sessionId: AppSessionId) {
    this.memorySessionHandle = Object.freeze({ sessionId })
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
    return this.activeRun?.abortController.signal ?? this.abortController?.signal
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

  getPreStreamTranscriptAnchorId(): string | undefined {
    return this.preStreamTranscriptAnchorId
  }

  setPreStreamTranscriptAnchorId(messageId: string): void {
    this.preStreamTranscriptAnchorId = messageId
  }

  clearPreStreamTranscriptAnchor(): void {
    this.preStreamTranscriptAnchorId = undefined
  }

  getActiveGeneration(): DeepChatActiveGeneration | undefined {
    return this.activeRun
  }

  registerActiveGeneration<TStreamState>(run: LoopRun<TStreamState>): LoopRun<TStreamState> {
    const previousController = this.activeRun?.abortController ?? this.abortController
    if (previousController && previousController !== run.abortController) {
      previousController.abort()
    }
    this.activeRun = run
    this.abortController = run.abortController
    return run
  }

  clearActiveGeneration(runId: string): boolean {
    if (!this.activeRun || this.activeRun.runId !== runId) {
      return false
    }
    const { abortController } = this.activeRun
    this.activeRun = undefined
    this.clearAbortController(abortController)
    return true
  }

  isActiveRun(runId: string): boolean {
    return this.activeRun?.runId === runId
  }

  requestGenerationAbort(): void {
    if (this.activeRun) {
      this.activeRun.abortController.abort()
      return
    }
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = undefined
    }
  }

  abortAndClearGeneration(): void {
    const controller = this.activeRun?.abortController ?? this.abortController
    controller?.abort()
    this.abortController = undefined
    this.activeRun = undefined
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
    return this.pendingQueueDrainLease !== undefined
  }

  tryAcquirePendingQueueDrain(): PendingQueueDrainLease | null {
    if (this.pendingQueueDrainLease) {
      return null
    }
    const lease = Symbol('pending-queue-drain')
    this.pendingQueueDrainLease = lease
    return lease
  }

  releasePendingQueueDrain(lease: PendingQueueDrainLease): boolean {
    if (this.pendingQueueDrainLease !== lease) {
      return false
    }
    this.pendingQueueDrainLease = undefined
    return true
  }

  replacePendingInteractions(interactions: readonly DeepChatPendingInteractionRef[]): void {
    this.pendingInteractions = interactions.map((interaction) => ({ ...interaction }))
    const pendingToolBatchCallIds = this.pendingInteractions
      .filter((interaction) => interaction.origin !== 'acp-permission')
      .map((interaction) => interaction.toolCallId)
    if (pendingToolBatchCallIds.length === 0) {
      this.pendingToolBatchState = undefined
    } else if (this.pendingToolBatchState) {
      this.pendingToolBatchState = {
        ...this.pendingToolBatchState,
        pendingInteractionCallIds: pendingToolBatchCallIds
      }
    }
  }

  replacePendingToolBatch(
    interactions: readonly DeepChatPendingInteractionRef[],
    state: PersistedToolBatchState
  ): void {
    this.pendingInteractions = interactions.map((interaction) => ({ ...interaction }))
    this.pendingToolBatchState = {
      callOrder: [...state.callOrder],
      invokedCallIds: [...state.invokedCallIds],
      committedResultCallIds: [...state.committedResultCallIds],
      pendingInteractionCallIds: [...state.pendingInteractionCallIds]
    }
  }

  getPendingToolBatchState(): PersistedToolBatchState | undefined {
    const state = this.pendingToolBatchState
    return state
      ? {
          callOrder: [...state.callOrder],
          invokedCallIds: [...state.invokedCallIds],
          committedResultCallIds: [...state.committedResultCallIds],
          pendingInteractionCallIds: [...state.pendingInteractionCallIds]
        }
      : undefined
  }

  advancePendingToolBatch(input: { invokedCallId?: string; committedResultCallId?: string }): void {
    const state = this.pendingToolBatchState
    if (!state) {
      return
    }
    const invokedCallIds = [...state.invokedCallIds]
    const committedResultCallIds = [...state.committedResultCallIds]
    if (input.invokedCallId && !invokedCallIds.includes(input.invokedCallId)) {
      invokedCallIds.push(input.invokedCallId)
    }
    if (
      input.committedResultCallId &&
      !committedResultCallIds.includes(input.committedResultCallId)
    ) {
      committedResultCallIds.push(input.committedResultCallId)
    }
    this.pendingToolBatchState = {
      ...state,
      invokedCallIds,
      committedResultCallIds
    }
  }

  getFirstPendingInteraction(): DeepChatPendingInteractionRef | undefined {
    const first = this.pendingInteractions[0]
    return first ? { ...first } : undefined
  }

  getPendingInteractions(): DeepChatPendingInteractionRef[] {
    return this.pendingInteractions.map((interaction) => ({ ...interaction }))
  }

  transitionPendingInteractionOrigin(
    messageId: string,
    toolCallId: string,
    origin: PendingToolInteractionOrigin
  ): boolean {
    const interaction = this.pendingInteractions.find(
      (candidate) => candidate.messageId === messageId && candidate.toolCallId === toolCallId
    )
    if (!interaction) {
      return false
    }
    this.pendingInteractions = this.pendingInteractions.map((candidate) =>
      candidate === interaction ? { ...candidate, origin } : candidate
    )
    return true
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
    this.invalidateToolProfileCache()
    return this.getRuntimeActivatedSkills()
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

  getCompactionState(): SessionCompactionState | undefined {
    return this.compactionState ? { ...this.compactionState } : undefined
  }

  setCompactionState(state: SessionCompactionState): void {
    this.compactionState = { ...state }
  }

  clearCompactionState(): void {
    this.compactionState = undefined
  }

  getMemorySessionHandle(): MemorySessionHandle {
    return this.memorySessionHandle
  }

  clearOwnedState(): void {
    this.abortAndClearGeneration()
    this.runtimeState = undefined
    this.generationSettings = undefined
    this.agentId = undefined
    this.projectDir = undefined
    this.clearFirstTurnReady()
    this.preStreamTranscriptAnchorId = undefined
    this.activeSteerPendingInputId = undefined
    this.pendingQueueDrainLease = undefined
    this.pendingInteractions = []
    this.pendingToolBatchState = undefined
    this.interactionLocks.clear()
    this.resumingMessages.clear()
    this.abortDeferredToolCalls()
    this.activeProviderPermissions.clear()
    this.runtimeActivatedSkills.clear()
    this.invalidateToolProfileCache()
    this.clearCompactionState()
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
