import logger from '@shared/logger'
import type {
  DeepChatSessionState,
  PermissionMode,
  SessionAgentContextUpdate,
  SessionGenerationSettings
} from '@shared/types/agent-interface'
import type { SessionUiPort } from '../runtimePorts'
import type { SQLitePresenter } from '../sqlitePresenter'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import { emitDeepChatInternalSessionUpdate } from './internalSessionEvents'
import type { DeepChatMessageStore } from './messageStore'
import type { RuntimeSharedState } from './runtimeSharedState'
import type { DeepChatSessionStore } from './sessionStore'
import { normalizePermissionMode, type SessionSettingsService } from './sessionSettingsService'
import type { GenerationControlService } from './generationControlService'

export type SessionInitialization = {
  agentId?: string
  providerId: string
  modelId: string
  projectDir?: string | null
  permissionMode?: PermissionMode
  generationSettings?: Partial<SessionGenerationSettings>
}

export type SessionLifecycleHost = {
  hasPendingInteractions: (sessionId: string) => boolean
  destroyPendingInputs: (sessionId: string) => void
  initializeMemoryCompactionSession: (sessionId: string) => void
  destroyMemoryCompactionSession: (sessionId: string) => void
  invalidateSystemPromptCache: (sessionId: string) => void
  invalidateToolProfileCache: (sessionId: string) => void
  clearRuntimeActivatedSkills: (sessionId: string) => void
  clearConversationToolMapping: (sessionId: string) => void
}

export type SessionLifecycleDependencies = {
  sqlitePresenter: SQLitePresenter
  sessionStore: DeepChatSessionStore
  messageStore: DeepChatMessageStore
  runtimeSharedState: RuntimeSharedState
  sessionSettingsService: SessionSettingsService
  generationControlService: GenerationControlService
  sessionUiPort?: SessionUiPort
}

export class SessionLifecycleService {
  private readonly firstTurnReadySessions = new Set<string>()
  private readonly firstTurnReadyWaiters = new Map<string, Set<(ready: boolean) => void>>()
  private readonly sessionAgentIds = new Map<string, string>()
  private readonly sessionProjectDirs = new Map<string, string | null>()

  constructor(
    private readonly dependencies: SessionLifecycleDependencies,
    private readonly host: SessionLifecycleHost
  ) {}

  async initSession(sessionId: string, config: SessionInitialization): Promise<void> {
    const projectDir = this.normalizeProjectDir(config.projectDir)
    const permissionMode = normalizePermissionMode(config.permissionMode)
    logger.info(
      `[DeepChatAgent] initSession id=${sessionId} provider=${config.providerId} model=${config.modelId} permission=${permissionMode} projectDir=${projectDir ?? '<none>'}`
    )
    const generationSettings =
      await this.dependencies.sessionSettingsService.prepareGenerationSettings(
        config.providerId,
        config.modelId,
        config.generationSettings ?? {}
      )

    this.dependencies.sessionStore.create(
      sessionId,
      config.providerId,
      config.modelId,
      permissionMode,
      generationSettings
    )
    this.sessionAgentIds.set(
      sessionId,
      config.agentId?.trim() || this.getSessionAgentId(sessionId) || 'deepchat'
    )
    this.sessionProjectDirs.set(sessionId, projectDir)
    this.dependencies.sessionSettingsService.cacheGenerationSettings(sessionId, generationSettings)
    this.dependencies.runtimeSharedState.runtimeState.set(sessionId, {
      status: 'idle',
      providerId: config.providerId,
      modelId: config.modelId,
      permissionMode
    })
    this.host.initializeMemoryCompactionSession(sessionId)
    this.clearFirstTurnReady(sessionId)
    this.host.invalidateSystemPromptCache(sessionId)
    this.host.invalidateToolProfileCache(sessionId)
  }

  async destroySession(sessionId: string): Promise<void> {
    // Invalidate queued memory work before deleting the runtime and persistence rows it references.
    this.host.destroyMemoryCompactionSession(sessionId)
    this.dependencies.generationControlService.destroySession(sessionId)
    this.clearFirstTurnReady(sessionId)

    this.host.destroyPendingInputs(sessionId)
    this.dependencies.messageStore.deleteBySession(sessionId)
    this.dependencies.sessionStore.delete(sessionId)
    this.dependencies.runtimeSharedState.runtimeState.delete(sessionId)
    this.sessionAgentIds.delete(sessionId)
    this.dependencies.sessionSettingsService.clearSession(sessionId)
    this.sessionProjectDirs.delete(sessionId)
    this.host.invalidateSystemPromptCache(sessionId)
    this.host.invalidateToolProfileCache(sessionId)
    this.host.clearRuntimeActivatedSkills(sessionId)
    this.host.clearConversationToolMapping(sessionId)
  }

  async getSessionState(sessionId: string): Promise<DeepChatSessionState | null> {
    return await this.getResolvedSessionState(sessionId, 'full')
  }

  async getSessionListState(sessionId: string): Promise<DeepChatSessionState | null> {
    return await this.getResolvedSessionState(sessionId, 'summary')
  }

  async waitForFirstTurnReady(
    sessionId: string,
    options?: { timeoutMs?: number }
  ): Promise<boolean> {
    if (this.firstTurnReadySessions.has(sessionId)) {
      return true
    }

    const timeoutMs = Math.max(0, options?.timeoutMs ?? 30000)
    if (timeoutMs === 0) {
      return false
    }

    return await new Promise<boolean>((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout>

      const waiters =
        this.firstTurnReadyWaiters.get(sessionId) ?? new Set<(ready: boolean) => void>()
      const cleanup = () => {
        const current = this.firstTurnReadyWaiters.get(sessionId)
        current?.delete(resolveWaiter)
        if (current?.size === 0) {
          this.firstTurnReadyWaiters.delete(sessionId)
        }
      }
      const settle = (ready: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        cleanup()
        resolve(ready)
      }
      const resolveWaiter = (ready: boolean) => settle(ready)

      waiters.add(resolveWaiter)
      this.firstTurnReadyWaiters.set(sessionId, waiters)
      timer = setTimeout(() => settle(false), timeoutMs)
    })
  }

  markFirstTurnReady(sessionId: string): void {
    if (this.firstTurnReadySessions.has(sessionId)) {
      return
    }

    this.firstTurnReadySessions.add(sessionId)
    this.settleFirstTurnReadyWaiters(sessionId, true)
  }

  clearFirstTurnReady(sessionId: string): void {
    this.firstTurnReadySessions.delete(sessionId)
    this.settleFirstTurnReadyWaiters(sessionId, false)
  }

  async setSessionAgentContext(
    sessionId: string,
    config: SessionAgentContextUpdate
  ): Promise<void> {
    const nextProviderId = config.providerId?.trim()
    const nextModelId = config.modelId?.trim()
    const nextAgentId = config.agentId?.trim()
    if (!nextAgentId || !nextProviderId || !nextModelId) {
      throw new Error('Session agent context update requires agentId, providerId and modelId.')
    }

    const state = this.dependencies.runtimeSharedState.runtimeState.get(sessionId)
    const dbSession = this.dependencies.sessionStore.get(sessionId)
    if (!state && !dbSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    if (state?.status === 'generating') {
      throw new Error('Cannot move session while it is generating.')
    }

    const permissionMode = normalizePermissionMode(config.permissionMode)
    const sanitizedGenerationSettings =
      await this.dependencies.sessionSettingsService.prepareGenerationSettings(
        nextProviderId,
        nextModelId,
        config.generationSettings ?? {}
      )

    this.dependencies.runtimeSharedState.runtimeState.set(sessionId, {
      status: state?.status ?? 'idle',
      providerId: nextProviderId,
      modelId: nextModelId,
      permissionMode
    })
    this.dependencies.sessionStore.updateSessionModel(sessionId, nextProviderId, nextModelId)
    this.dependencies.sessionStore.updatePermissionMode(sessionId, permissionMode)
    this.dependencies.sessionSettingsService.replaceGenerationSettings(
      sessionId,
      sanitizedGenerationSettings
    )
    this.sessionAgentIds.set(sessionId, nextAgentId)
    this.sessionProjectDirs.set(sessionId, this.normalizeProjectDir(config.projectDir))
    this.host.invalidateSystemPromptCache(sessionId)
    this.host.invalidateToolProfileCache(sessionId)
  }

  async setSessionProjectDir(sessionId: string, projectDir: string | null): Promise<void> {
    const normalized = this.normalizeProjectDir(projectDir)
    const previous = this.sessionProjectDirs.has(sessionId)
      ? (this.sessionProjectDirs.get(sessionId) ?? null)
      : this.resolvePersistedSessionProjectDir(sessionId)
    this.sessionProjectDirs.set(sessionId, normalized)
    if (previous !== normalized) {
      this.host.invalidateSystemPromptCache(sessionId)
      this.host.invalidateToolProfileCache(sessionId)
    }
  }

  getSessionAgentId(sessionId: string): string | undefined {
    const cached = this.sessionAgentIds.get(sessionId)?.trim()
    if (cached) {
      return cached
    }

    const persisted = this.dependencies.sqlitePresenter.newSessionsTable
      ?.get(sessionId)
      ?.agent_id?.trim()
    if (persisted) {
      this.sessionAgentIds.set(sessionId, persisted)
      return persisted
    }

    return undefined
  }

  resolveProjectDir(sessionId: string, incoming?: string | null): string | null {
    if (incoming !== undefined) {
      const normalized = this.normalizeProjectDir(incoming)
      const previous = this.sessionProjectDirs.get(sessionId) ?? null
      this.sessionProjectDirs.set(sessionId, normalized)
      if (previous !== normalized) {
        this.host.invalidateSystemPromptCache(sessionId)
        this.host.invalidateToolProfileCache(sessionId)
      }
      return normalized
    }
    if (this.sessionProjectDirs.has(sessionId)) {
      return this.sessionProjectDirs.get(sessionId) ?? null
    }

    const persisted = this.resolvePersistedSessionProjectDir(sessionId)
    this.sessionProjectDirs.set(sessionId, persisted)
    return persisted
  }

  setSessionStatus(sessionId: string, status: DeepChatSessionState['status']): void {
    const current = this.dependencies.runtimeSharedState.runtimeState.get(sessionId)
    if (!current || current.status === status) {
      return
    }
    current.status = status
    publishDeepchatEvent('sessions.status.changed', {
      sessionId,
      status,
      version: Date.now()
    })
    publishDeepchatEvent('sessions.updated', {
      sessionIds: [sessionId],
      reason: 'updated'
    })
    emitDeepChatInternalSessionUpdate({
      sessionId,
      kind: 'status',
      updatedAt: Date.now(),
      status
    })

    this.dependencies.sessionUiPort?.refreshSessionUi()
  }

  private async getResolvedSessionState(
    sessionId: string,
    hydrationMode: 'full' | 'summary'
  ): Promise<DeepChatSessionState | null> {
    const state = this.dependencies.runtimeSharedState.runtimeState.get(sessionId)
    if (state) {
      this.getSessionAgentId(sessionId)
      if (this.host.hasPendingInteractions(sessionId)) {
        state.status = 'generating'
      }
      if (hydrationMode === 'full') {
        await this.dependencies.sessionSettingsService.getEffectiveGenerationSettings(sessionId)
      }
      return { ...state }
    }

    const dbSession = this.dependencies.sessionStore.get(sessionId)
    if (!dbSession) return null

    this.getSessionAgentId(sessionId)
    const rebuilt: DeepChatSessionState = {
      status: this.host.hasPendingInteractions(sessionId) ? 'generating' : 'idle',
      providerId: dbSession.provider_id,
      modelId: dbSession.model_id,
      permissionMode: normalizePermissionMode(dbSession.permission_mode)
    }
    this.dependencies.runtimeSharedState.runtimeState.set(sessionId, rebuilt)
    if (hydrationMode === 'full') {
      await this.dependencies.sessionSettingsService.getEffectiveGenerationSettings(sessionId)
    }
    return { ...rebuilt }
  }

  private settleFirstTurnReadyWaiters(sessionId: string, ready: boolean): void {
    const waiters = this.firstTurnReadyWaiters.get(sessionId)
    if (!waiters) {
      return
    }

    this.firstTurnReadyWaiters.delete(sessionId)
    for (const waiter of waiters) {
      waiter(ready)
    }
  }

  private normalizeProjectDir(projectDir?: string | null): string | null {
    const normalized = projectDir?.trim()
    return normalized ? normalized : null
  }

  private resolvePersistedSessionProjectDir(sessionId: string): string | null {
    try {
      const session = this.dependencies.sqlitePresenter.newSessionsTable?.get(sessionId)
      return this.normalizeProjectDir(session?.project_dir ?? null)
    } catch (error) {
      console.warn('[DeepChatAgent] Failed to resolve persisted project directory:', {
        sessionId,
        error
      })
      return null
    }
  }
}
