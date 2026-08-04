import type { ProviderModelResolutionPort } from '@/provider/settings'
import type {
  DeepChatSessionState,
  PermissionMode,
  SessionAgentContextUpdate,
  SessionGenerationSettings
} from '@shared/types/agent-interface'

import type { ToolServicePort } from '@shared/types/tool'
import type { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import type {
  SessionRuntimeScope,
  SessionScopeRegistry
} from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { SessionIdentityService } from './sessionIdentityService'
import { BUILTIN_DEEPCHAT_AGENT_ID } from '@/agent/deepchat/deepChatAgentRepository'
import type { SessionPermissionPort } from '@/session/contracts'
import {
  buildPersistedGenerationSettingsPatch,
  buildPersistedGenerationSettingsReplacement,
  mapPersistedGenerationPatch,
  sanitizeGenerationSettings,
  type PersistedSessionGenerationRow
} from './generationSettings'
import {
  assertProviderModelRuntimeFacts,
  resolveProviderModelRuntimeFacts,
  type ProviderModelRuntimeFacts
} from './providerModelRuntimeFacts'
import type { SessionSettingsStore } from '@/session/data/settings'
import type { DeepChatToolResolver } from './toolResolver'
import type { PromptSettings } from '@/agent/promptSettings'

interface SessionSettingsCoordinatorDependencies {
  providerSettings: ProviderModelResolutionPort
  promptSettings: Pick<PromptSettings, 'getDefaultSystemPrompt'>
  sessionStore: SessionSettingsStore
  toolResolver: DeepChatToolResolver
  toolService: ToolServicePort
  sessionPermissionPort: SessionPermissionPort
  registry: SessionScopeRegistry
  identity: Pick<SessionIdentityService, 'getAgentId'>
  beginSessionAgentReassignment(sessionId: string): Promise<void>
  finishSessionAgentReassignment(sessionId: string): void
  readPersistedProjectDir(sessionId: string): string | null | undefined
}

export class SessionSettingsCoordinator {
  constructor(private readonly deps: SessionSettingsCoordinatorDependencies) {}

  private instance(sessionId: string): DeepChatAgentInstance {
    return this.deps.registry.getOrHydrateScope(toAppSessionId(sessionId)).instance
  }

  private state(sessionId: string): DeepChatSessionState | undefined {
    return this.deps.registry.getHydratedScope(toAppSessionId(sessionId))?.state()
  }

  private assertCurrent(sessionId: string, instance: DeepChatAgentInstance): void {
    this.deps.registry.scopeFor(toAppSessionId(sessionId), instance).assertCurrent()
  }

  private resolveUpdateScope(sessionId: string): {
    scope: SessionRuntimeScope
    dbSession: ReturnType<SessionSettingsStore['get']>
  } {
    const appSessionId = toAppSessionId(sessionId)
    const hydratedScope = this.deps.registry.getHydratedScope(appSessionId)
    const dbSession = this.deps.sessionStore.get(sessionId)
    if (!hydratedScope?.state() && !dbSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const scope = hydratedScope ?? this.deps.registry.getOrHydrateScope(appSessionId)
    scope.assertCurrent()
    return { scope, dbSession }
  }

  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    const state = this.state(sessionId)
    this.deps.sessionStore.updatePermissionMode(sessionId, mode)
    if (state) {
      state.permissionMode = mode
    }
  }

  async setModel(sessionId: string, providerId: string, modelId: string): Promise<void> {
    const nextProviderId = providerId?.trim()
    const nextModelId = modelId?.trim()
    if (!nextProviderId || !nextModelId) {
      throw new Error('Session model update requires providerId and modelId.')
    }

    const { scope, dbSession } = this.resolveUpdateScope(sessionId)
    const state = scope.state()
    const permissionMode = state?.permissionMode ?? dbSession?.permission_mode
    if (!permissionMode) {
      throw new Error(`Session ${sessionId} permission mode is missing`)
    }
    if (state?.status === 'generating') {
      throw new Error('Cannot switch model while session is generating.')
    }

    const currentGeneration = await this.getEffectiveGenerationSettings(sessionId, scope.instance)
    const sanitized = await sanitizeGenerationSettings(
      this.deps.providerSettings,
      this.deps.promptSettings,
      nextProviderId,
      nextModelId,
      { systemPrompt: currentGeneration.systemPrompt }
    )
    scope.assertCurrent()
    const currentState = scope.state()
    if (currentState?.status === 'generating') {
      throw new Error('Cannot switch model while session is generating.')
    }
    this.deps.sessionStore.updateSessionConfiguration(
      sessionId,
      nextProviderId,
      nextModelId,
      buildPersistedGenerationSettingsReplacement(sanitized)
    )

    if (currentState) {
      currentState.providerId = nextProviderId
      currentState.modelId = nextModelId
    } else {
      scope.instance.setRuntimeState({
        status: 'idle',
        providerId: nextProviderId,
        modelId: nextModelId,
        permissionMode
      })
    }
    scope.instance.setGenerationSettings(sanitized)
    scope.instance.invalidateToolProfileCache()
  }

  async applyTurnExecutionSnapshot(
    sessionId: string,
    snapshot: {
      providerId: string
      modelId: string
      generationSettings: SessionGenerationSettings
    }
  ): Promise<void> {
    const providerId = snapshot.providerId.trim()
    const modelId = snapshot.modelId.trim()
    if (!providerId || !modelId) {
      throw new Error('Turn execution snapshot requires providerId and modelId.')
    }

    const { scope, dbSession } = this.resolveUpdateScope(sessionId)
    const state = scope.state()
    const permissionMode = state?.permissionMode ?? dbSession?.permission_mode
    if (!permissionMode) {
      throw new Error(`Session ${sessionId} permission mode is missing`)
    }
    if (state?.status === 'generating') {
      throw new Error('Cannot apply a turn execution snapshot while session is generating.')
    }

    const generationSettings = await sanitizeGenerationSettings(
      this.deps.providerSettings,
      this.deps.promptSettings,
      providerId,
      modelId,
      snapshot.generationSettings
    )
    scope.assertCurrent()
    const currentState = scope.state()
    if (currentState?.status === 'generating') {
      throw new Error('Cannot apply a turn execution snapshot while session is generating.')
    }
    const currentPermissionMode =
      currentState?.permissionMode ?? this.deps.sessionStore.get(sessionId)?.permission_mode
    if (!currentPermissionMode) {
      throw new Error(`Session ${sessionId} permission mode is missing`)
    }
    this.deps.sessionStore.updateSessionConfiguration(
      sessionId,
      providerId,
      modelId,
      buildPersistedGenerationSettingsReplacement(generationSettings)
    )
    if (currentState) {
      currentState.providerId = providerId
      currentState.modelId = modelId
    } else {
      scope.instance.setRuntimeState({
        status: 'idle',
        providerId,
        modelId,
        permissionMode: currentPermissionMode
      })
    }
    scope.instance.setGenerationSettings(generationSettings)
    scope.instance.invalidateToolProfileCache()
  }

  async setAgentContext(sessionId: string, config: SessionAgentContextUpdate): Promise<void> {
    const nextProviderId = config.providerId?.trim()
    const nextModelId = config.modelId?.trim()
    const nextAgentId = config.agentId?.trim()
    if (!nextAgentId || !nextProviderId || !nextModelId) {
      throw new Error('Session agent context update requires agentId, providerId and modelId.')
    }

    const { scope } = this.resolveUpdateScope(sessionId)
    const state = scope.state()
    if (state?.status === 'generating') {
      throw new Error('Cannot move session while it is generating.')
    }

    const permissionMode = config.permissionMode
    const generationSettings = await sanitizeGenerationSettings(
      this.deps.providerSettings,
      this.deps.promptSettings,
      nextProviderId,
      nextModelId,
      config.generationSettings ?? {}
    )
    scope.assertCurrent()
    if (scope.state()?.status === 'generating') {
      throw new Error('Cannot move session while it is generating.')
    }
    const isAgentReassignment =
      (this.deps.identity.getAgentId(sessionId) ?? BUILTIN_DEEPCHAT_AGENT_ID) !== nextAgentId
    try {
      if (isAgentReassignment) {
        await this.deps.beginSessionAgentReassignment(sessionId)
      }
      scope.assertCurrent()
      const currentState = scope.state()
      if (currentState?.status === 'generating') {
        throw new Error('Cannot move session while it is generating.')
      }
      this.deps.sessionStore.updateSessionConfiguration(
        sessionId,
        nextProviderId,
        nextModelId,
        buildPersistedGenerationSettingsReplacement(generationSettings),
        permissionMode
      )

      scope.instance.setRuntimeState({
        status: currentState?.status ?? 'idle',
        providerId: nextProviderId,
        modelId: nextModelId,
        permissionMode
      })
      scope.instance.setAgentId(nextAgentId)
      scope.instance.setProjectDir(this.normalizeProjectDir(config.projectDir))
      scope.instance.setGenerationSettings(generationSettings)
      this.deps.sessionPermissionPort.clearSessionPermissions(sessionId)
      this.deps.toolService.clearAgentPlanState(sessionId)
      scope.instance.replaceRuntimeActivatedSkills([])
      scope.instance.invalidateToolProfileCache()
      await this.deps.toolResolver.revalidateActiveSkillsForAgent(sessionId, nextAgentId)
      if (scope.isCurrent()) {
        scope.instance.invalidateToolProfileCache()
      }
    } finally {
      if (isAgentReassignment) {
        this.deps.finishSessionAgentReassignment(sessionId)
      }
    }
  }

  setProjectDir(sessionId: string, projectDir: string | null): void {
    this.applyProjectDir(sessionId, this.instance(sessionId), projectDir)
  }

  resolveProjectDir(
    sessionId: string,
    incoming?: string | null,
    expectedInstance = this.instance(sessionId)
  ): string | null {
    this.assertCurrent(sessionId, expectedInstance)
    if (incoming !== undefined) {
      return this.applyProjectDir(sessionId, expectedInstance, incoming)
    }
    if (expectedInstance.hasProjectDir()) {
      return expectedInstance.getProjectDir()
    }

    const persisted = this.resolvePersistedProjectDir(sessionId)
    expectedInstance.setProjectDir(persisted)
    return persisted
  }

  normalizeProjectDir(projectDir?: string | null): string | null {
    const normalized = projectDir?.trim()
    return normalized ? normalized : null
  }

  private applyProjectDir(
    sessionId: string,
    instance: DeepChatAgentInstance,
    projectDir?: string | null
  ): string | null {
    const normalized = this.normalizeProjectDir(projectDir)
    const previous = instance.hasProjectDir()
      ? instance.getProjectDir()
      : this.resolvePersistedProjectDir(sessionId)
    instance.setProjectDir(normalized)
    if (previous !== normalized) {
      instance.invalidateToolProfileCache()
    }
    return normalized
  }

  getPermissionMode(sessionId: string): PermissionMode {
    const state = this.state(sessionId)
    if (state) {
      return state.permissionMode
    }
    return this.deps.sessionStore.get(sessionId)?.permission_mode ?? 'default'
  }

  async getGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null> {
    const state = this.state(sessionId)
    const dbSession = this.deps.sessionStore.get(sessionId)
    if (!state && !dbSession) {
      return null
    }
    return await this.getEffectiveGenerationSettings(sessionId)
  }

  async updateGenerationSettings(
    sessionId: string,
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings> {
    const { scope, dbSession } = this.resolveUpdateScope(sessionId)
    const state = scope.state()
    const providerId = state?.providerId ?? dbSession?.provider_id
    const modelId = state?.modelId ?? dbSession?.model_id
    if (!providerId || !modelId) {
      throw new Error(`Session ${sessionId} model information is missing`)
    }

    const current = await this.getEffectiveGenerationSettings(sessionId, scope.instance)
    const sanitized = await sanitizeGenerationSettings(
      this.deps.providerSettings,
      this.deps.promptSettings,
      providerId,
      modelId,
      settings,
      current
    )
    scope.assertCurrent()
    const latestState = scope.state()
    const latestDbSession = latestState ? dbSession : this.deps.sessionStore.get(sessionId)
    const latestProviderId = latestState?.providerId ?? latestDbSession?.provider_id
    const latestModelId = latestState?.modelId ?? latestDbSession?.model_id
    if (latestProviderId !== providerId || latestModelId !== modelId) {
      throw new Error(`Session ${sessionId} model changed while generation settings were updating.`)
    }
    this.deps.sessionStore.updateGenerationSettings(
      sessionId,
      buildPersistedGenerationSettingsPatch(settings, sanitized)
    )
    scope.instance.setGenerationSettings(sanitized)
    return sanitized
  }

  async getEffectiveGenerationSettings(
    sessionId: string,
    expectedInstance = this.instance(sessionId),
    providedProviderModelFacts?: ProviderModelRuntimeFacts
  ): Promise<SessionGenerationSettings> {
    this.assertCurrent(sessionId, expectedInstance)
    const state = expectedInstance.getRuntimeState()
    let dbSession: PersistedSessionGenerationRow | undefined
    if (providedProviderModelFacts) {
      dbSession = state
        ? undefined
        : (this.deps.sessionStore.get(sessionId) as PersistedSessionGenerationRow | undefined)
      const expectedProviderId = state?.providerId ?? dbSession?.provider_id
      const expectedModelId = state?.modelId ?? dbSession?.model_id
      if (!expectedProviderId || !expectedModelId) {
        throw new Error(`Session ${sessionId} not found`)
      }
      assertProviderModelRuntimeFacts(
        providedProviderModelFacts,
        expectedProviderId,
        expectedModelId
      )
    }
    const cached = expectedInstance.getGenerationSettings()
    if (cached) {
      return { ...cached }
    }

    dbSession ??= this.deps.sessionStore.get(sessionId) as
      | PersistedSessionGenerationRow
      | undefined
    const providerId = state?.providerId ?? dbSession?.provider_id
    const modelId = state?.modelId ?? dbSession?.model_id

    if (!providerId || !modelId) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const providerModelFacts =
      providedProviderModelFacts ??
      resolveProviderModelRuntimeFacts(this.deps.providerSettings, providerId, modelId)
    const persistedPatch = dbSession
      ? mapPersistedGenerationPatch(
          this.deps.providerSettings,
          dbSession,
          providerModelFacts.capabilitySnapshot
        )
      : {}
    const sanitized = await sanitizeGenerationSettings(
      this.deps.providerSettings,
      this.deps.promptSettings,
      providerId,
      modelId,
      persistedPatch,
      undefined,
      providerModelFacts
    )
    this.assertCurrent(sessionId, expectedInstance)
    expectedInstance.setGenerationSettings(sanitized)
    return { ...sanitized }
  }

  private resolvePersistedProjectDir(sessionId: string): string | null {
    try {
      return this.normalizeProjectDir(this.deps.readPersistedProjectDir(sessionId))
    } catch (error) {
      console.warn('[DeepChatAgent] Failed to resolve persisted project directory:', {
        sessionId,
        error
      })
      return null
    }
  }

}
