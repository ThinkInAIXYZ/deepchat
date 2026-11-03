import type {
  HarnessAcceptanceLane,
  HarnessControlLease,
  HarnessControlOwner,
  HarnessControlPort,
  HarnessControlCommand,
  HarnessInputSnapshot
} from '@shared/harness/control'
import {
  DeepChatControlSession,
  type ProviderPermissionTakeInput,
  type ProviderPermissionTakeResult,
  type PendingInteractionProjection
} from './controlSession'
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

export interface DeepChatContextWindowObservation {
  readonly providerId: string
  readonly modelId: string
  readonly providerContextLimitTokens?: number
  readonly providerPromptLimitTokens?: number
  readonly metadataSuspect: boolean
}

const MAX_CONTEXT_WINDOW_OBSERVATIONS = 16

export class DeepChatAgentInstance {
  readonly kind = 'deepchat' as const
  private inputEffectsRetired = false
  private runtimeState?: DeepChatSessionState
  private generationSettings?: SessionGenerationSettings
  private agentId?: string
  private projectDir?: string | null
  private pendingReadyClears = 0
  private readonly control: DeepChatControlSession
  private readonly firstTurnReadyWaiters = new Set<(ready: boolean) => void>()
  private preStreamTranscriptAnchorId?: string
  private readonly runtimeActivatedSkills = new Set<string>()
  private toolProfileCache?: DeepChatToolProfileCacheEntry
  private toolProfileRevisionToken = Symbol('deepchat-tool-profile-revision')
  private compactionState?: SessionCompactionState
  private readonly contextWindowObservations = new Map<string, DeepChatContextWindowObservation>()
  private readonly memorySessionHandle: MemorySessionHandle

  constructor(
    readonly sessionId: AppSessionId,
    control: HarnessControlPort
  ) {
    this.control = new DeepChatControlSession(sessionId, control, (state, current) => {
      if (state && this.runtimeState) this.runtimeState.status = state.status
      if (!current) this.settleFirstTurnReadyWaiters(false)
      else if (state?.firstTurnReady && this.pendingReadyClears === 0) {
        this.settleFirstTurnReadyWaiters(true)
      }
    })
    this.memorySessionHandle = Object.freeze({ sessionId })
  }

  getRuntimeState(): DeepChatSessionState | undefined {
    return this.runtimeState
  }

  setRuntimeState(state: DeepChatSessionState): void {
    this.runtimeState = { ...state, status: this.control.status }
  }

  getGenerationSettings(): SessionGenerationSettings | undefined {
    return this.generationSettings
  }

  setGenerationSettings(settings: SessionGenerationSettings): void {
    if (
      this.generationSettings &&
      this.generationSettings.contextLength !== settings.contextLength &&
      this.runtimeState
    ) {
      this.clearContextWindowObservation(this.runtimeState.providerId, this.runtimeState.modelId)
    }
    this.generationSettings = settings
  }

  getContextWindowObservation(
    providerId: string,
    modelId: string
  ): DeepChatContextWindowObservation | undefined {
    const observation = this.contextWindowObservations.get(
      this.contextWindowObservationKey(providerId, modelId)
    )
    return observation ? { ...observation } : undefined
  }

  clearContextWindowObservation(providerId: string, modelId: string): void {
    this.contextWindowObservations.delete(this.contextWindowObservationKey(providerId, modelId))
  }

  recordContextWindowObservation(input: {
    providerId: string
    modelId: string
    confidence: 'none' | 'qualitative' | 'explicit'
    limitTokens?: number
    limitScope?: 'context' | 'prompt'
  }): void {
    if (!input.providerId.trim() || !input.modelId.trim() || input.confidence === 'none') return
    const limitTokens =
      input.confidence === 'explicit' &&
      (input.limitScope === 'context' || input.limitScope === 'prompt') &&
      Number.isSafeInteger(input.limitTokens) &&
      (input.limitTokens ?? 0) > 0
        ? input.limitTokens
        : undefined
    const current = this.getContextWindowObservation(input.providerId, input.modelId)
    const providerContextLimitTokens =
      limitTokens !== undefined && input.limitScope === 'context'
        ? current?.providerContextLimitTokens === undefined
          ? limitTokens
          : Math.min(current.providerContextLimitTokens, limitTokens)
        : current?.providerContextLimitTokens
    const providerPromptLimitTokens =
      limitTokens !== undefined && input.limitScope === 'prompt'
        ? current?.providerPromptLimitTokens === undefined
          ? limitTokens
          : Math.min(current.providerPromptLimitTokens, limitTokens)
        : current?.providerPromptLimitTokens
    const key = this.contextWindowObservationKey(input.providerId, input.modelId)
    if (!current && this.contextWindowObservations.size >= MAX_CONTEXT_WINDOW_OBSERVATIONS) {
      const oldestKey = this.contextWindowObservations.keys().next().value
      if (oldestKey !== undefined) this.contextWindowObservations.delete(oldestKey)
    }
    this.contextWindowObservations.set(
      key,
      Object.freeze({
        providerId: input.providerId,
        modelId: input.modelId,
        ...(providerContextLimitTokens !== undefined ? { providerContextLimitTokens } : {}),
        ...(providerPromptLimitTokens !== undefined ? { providerPromptLimitTokens } : {}),
        metadataSuspect:
          current?.metadataSuspect === true ||
          input.confidence === 'qualitative' ||
          limitTokens === undefined
      })
    )
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
    if (this.control.firstTurnReady && this.pendingReadyClears === 0) return true

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

  get controlScopeId(): string {
    return this.control.id
  }

  get inputEffectsFenced(): boolean {
    return this.inputEffectsRetired
  }

  fenceInputEffects(): void {
    this.inputEffectsRetired = true
  }

  controlReady(): Promise<void> {
    return this.control.ready
  }

  isControlCurrent(): boolean {
    return this.control.current
  }

  retireControl(): void {
    this.control.retire()
  }

  async markFirstTurnReady(runId: string): Promise<boolean> {
    return await this.control.markReady(runId)
  }

  clearFirstTurnReady(): void {
    this.pendingReadyClears++
    this.settleFirstTurnReadyWaiters(false)
    void this.control
      .clearReady()
      .catch(() => {})
      .finally(() => {
        this.pendingReadyClears--
        if (this.control.firstTurnReady && this.pendingReadyClears === 0) {
          this.settleFirstTurnReadyWaiters(true)
        }
      })
  }

  getAbortController(): AbortController | undefined {
    return this.control.controller
  }

  getAbortSignal(): AbortSignal | undefined {
    return this.control.run?.abortController.signal ?? this.control.controller?.signal
  }

  async ensureOperationController(): Promise<AbortController> {
    return await this.control.prepareOperation()
  }

  operationOwner(controller: AbortController): { kind: 'operation'; id: string } {
    return this.control.owner(controller)
  }

  async transitionControlStatus(
    owner: HarnessControlOwner,
    status: DeepChatSessionState['status'],
    interactions?: PendingInteractionProjection
  ): Promise<{ previousStatus: DeepChatSessionState['status'] } | undefined> {
    return await this.control.setStatus(owner, status, interactions)
  }

  async clearAbortController(
    controller?: AbortController,
    settled?: () => void,
    origin?: { operationId: string; runId?: string }
  ): Promise<boolean> {
    return controller ? await this.control.clearController(controller, settled, origin) : false
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
    return this.control.run
  }

  async registerActiveGeneration<TStreamState>(
    run: LoopRun<TStreamState>
  ): Promise<LoopRun<TStreamState>> {
    return await this.control.registerRun(run)
  }

  async clearActiveGeneration(runId: string): Promise<boolean> {
    return await this.control.clearRun(runId)
  }

  isActiveRun(runId: string): boolean {
    return this.control.isRunCurrent(runId)
  }

  requestGenerationAbort(): void {
    this.control.abort()
  }

  abortAndClearGeneration(): void {
    const run = this.control.run
    const controller = this.control.controller
    this.control.abort()
    if (run) void this.control.clearRun(run.runId).catch(() => {})
    else if (controller) void this.control.clearController(controller).catch(() => {})
  }

  getActiveSteerPendingInputId(): string | undefined {
    return this.control.activeSteerInputId
  }

  async queryInput(snapshot: HarnessInputSnapshot, reason?: 'enqueue' | 'completed' | 'manual') {
    return await this.control.queryInput(snapshot, reason)
  }

  async beginInput(
    input: Omit<
      Extract<HarnessControlCommand, { method: 'beginInput' }>,
      'method' | 'scopeId' | 'requestId'
    >
  ) {
    return await this.control.beginInput(input)
  }

  async prepareClaimEffect(
    claimId: string,
    owner: HarnessControlOwner,
    action: Extract<HarnessControlCommand, { method: 'prepareClaimEffect' }>['action']
  ) {
    return await this.control.prepareClaimEffect(claimId, owner, action)
  }

  async ackInputEffect(
    input: Omit<Extract<HarnessControlCommand, { method: 'ackInputEffect' }>, 'method' | 'scopeId'>
  ): Promise<void> {
    await this.control.ackInputEffect(input)
  }

  async inputHold(
    input: Omit<Extract<HarnessControlCommand, { method: 'inputHold' }>, 'method' | 'scopeId'>
  ): Promise<boolean> {
    return await this.control.inputHold(input)
  }

  async endInput(drainLeaseId: string) {
    return await this.control.endInput(drainLeaseId)
  }

  isPendingQueueDraining(): boolean {
    return this.control.draining
  }

  async acquireAttachmentAcceptance(
    lane: HarnessAcceptanceLane,
    signal?: AbortSignal
  ): Promise<() => Promise<void>> {
    return await this.control.acquireAcceptance(lane, signal)
  }

  async replacePendingInteractions(
    interactions: readonly DeepChatPendingInteractionRef[],
    owner?: HarnessControlOwner,
    options?: { reconcile?: boolean }
  ): Promise<boolean> {
    return await this.control.replaceInteractions({ interactions, ...options }, owner)
  }

  async replacePendingToolBatch(
    interactions: readonly DeepChatPendingInteractionRef[],
    state: PersistedToolBatchState,
    owner?: HarnessControlOwner
  ): Promise<boolean> {
    return await this.control.replaceInteractions({ interactions, batch: state }, owner)
  }

  getPendingToolBatchState(): PersistedToolBatchState | undefined {
    return this.control.batch
  }

  async advancePendingToolBatch(
    input: { invokedCallId?: string; committedResultCallId?: string },
    owner?: HarnessControlOwner
  ): Promise<void> {
    await this.control.advanceBatch(input, owner)
  }

  getFirstPendingInteraction(): DeepChatPendingInteractionRef | undefined {
    return this.control.interactions[0]
  }

  getPendingInteractions(): DeepChatPendingInteractionRef[] {
    return this.control.interactions
  }

  async transitionPendingInteractionOrigin(
    messageId: string,
    toolCallId: string,
    origin: PendingToolInteractionOrigin,
    owner?: HarnessControlOwner
  ): Promise<boolean> {
    return await this.control.transitionInteractionOrigin(messageId, toolCallId, origin, owner)
  }

  hasPendingInteractions(): boolean {
    return this.control.interactions.length > 0
  }

  async checkPendingInteraction(
    lease: HarnessControlLease,
    owner: HarnessControlOwner
  ): Promise<boolean> {
    return await this.control.checkInteraction(lease, owner)
  }

  async acquireInteraction(
    messageId: string,
    toolCallId: string
  ): Promise<HarnessControlLease | 'parked' | null> {
    return await this.control.acquireLease({ kind: 'interaction', messageId, toolCallId })
  }

  async parkInteraction(lease: HarnessControlLease): Promise<void> {
    await this.control.parkInteraction(lease)
  }

  async unlockInteraction(lease: HarnessControlLease): Promise<void> {
    await this.control.releaseLease(lease)
  }

  async tryBeginResume(messageId: string): Promise<HarnessControlLease | null> {
    const lease = await this.control.acquireLease({ kind: 'resume', messageId })
    return lease === 'parked' ? null : lease
  }

  async finishResume(lease: HarnessControlLease): Promise<void> {
    await this.control.releaseLease(lease)
  }

  async registerDeferredToolAbortController(
    messageId: string,
    toolCallId: string,
    lease: HarnessControlLease,
    owner: HarnessControlOwner
  ): Promise<AbortController> {
    return await this.control.registerDeferred(messageId, toolCallId, lease, owner)
  }

  async clearDeferredToolAbortController(controller: AbortController): Promise<boolean> {
    return await this.control.clearDeferred(controller)
  }

  hasDeferredToolAbortController(toolCallId: string): boolean {
    return this.control.hasDeferred(toolCallId)
  }

  abortDeferredToolCalls(): void {
    this.control.abortDeferred()
  }

  async registerActiveProviderPermission(
    permission: DeepChatActiveProviderPermission,
    runId: string
  ): Promise<void> {
    await this.control.registerPermission(permission, runId)
  }

  getActiveProviderPermission(requestId: string): DeepChatActiveProviderPermission | undefined {
    return this.control.getPermission(requestId)
  }

  async takeProviderPermission(
    input: ProviderPermissionTakeInput
  ): Promise<ProviderPermissionTakeResult> {
    return await this.control.takePermission(input)
  }

  hasActiveProviderPermission(requestId: string): boolean {
    return this.control.getPermission(requestId) !== undefined
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

  getToolProfileRevisionToken(): symbol {
    return this.toolProfileRevisionToken
  }

  invalidateToolProfileCache(): void {
    this.toolProfileCache = undefined
    this.toolProfileRevisionToken = Symbol('deepchat-tool-profile-revision')
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
    this.abortDeferredToolCalls()
    this.runtimeActivatedSkills.clear()
    this.invalidateToolProfileCache()
    this.clearCompactionState()
    this.contextWindowObservations.clear()
    this.control.release()
  }

  private contextWindowObservationKey(providerId: string, modelId: string): string {
    return JSON.stringify([providerId, modelId])
  }

  private settleFirstTurnReadyWaiters(ready: boolean): void {
    const waiters = [...this.firstTurnReadyWaiters]
    this.firstTurnReadyWaiters.clear()
    for (const waiter of waiters) waiter(ready)
  }
}
