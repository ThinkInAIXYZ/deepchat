import type {
  DeepChatSessionState,
  PermissionMode,
  SessionAgentContextUpdate,
  SessionGenerationSettings
} from '@shared/types/agent-interface'
import type { IConfigPresenter } from '@shared/presenter'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import type { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import { BUILTIN_DEEPCHAT_AGENT_ID } from '@/agent/deepchat/deepChatAgentRepository'
import type { SessionPermissionPort } from '../runtimePorts'
import {
  buildPersistedGenerationSettingsPatch,
  buildPersistedGenerationSettingsReplacement,
  sanitizeGenerationSettings
} from './generationSettings'
import type { DeepChatSessionStore } from './sessionStore'
import type { DeepChatToolResolver } from './toolResolver'

interface SessionSettingsCoordinatorDependencies {
  configPresenter: IConfigPresenter
  sessionStore: DeepChatSessionStore
  toolResolver: DeepChatToolResolver
  toolPresenter: IToolPresenter | null
  sessionPermissionPort?: SessionPermissionPort
  getRuntimeState(sessionId: string): DeepChatSessionState | undefined
  getSessionAgentId(sessionId: string): string | undefined
  getInstance(sessionId: string): DeepChatAgentInstance
  beginSessionAgentReassignment(sessionId: string): Promise<void>
  finishSessionAgentReassignment(sessionId: string): void
  getEffectiveGenerationSettings(sessionId: string): Promise<SessionGenerationSettings>
  normalizeProjectDir(projectDir?: string | null): string | null
  resolvePersistedProjectDir(sessionId: string): string | null
  invalidateSystemPromptCache(sessionId: string): void
  invalidateToolProfileCache(sessionId: string): void
}

export class SessionSettingsCoordinator {
  constructor(private readonly deps: SessionSettingsCoordinatorDependencies) {}

  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    const state = this.deps.getRuntimeState(sessionId)
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

    const state = this.deps.getRuntimeState(sessionId)
    const dbSession = this.deps.sessionStore.get(sessionId)
    if (!state && !dbSession) {
      throw new Error(`Session ${sessionId} not found`)
    }
    const permissionMode = state?.permissionMode ?? dbSession?.permission_mode
    if (!permissionMode) {
      throw new Error(`Session ${sessionId} permission mode is missing`)
    }
    if (state?.status === 'generating') {
      throw new Error('Cannot switch model while session is generating.')
    }

    const currentGeneration = await this.deps.getEffectiveGenerationSettings(sessionId)
    const sanitized = await sanitizeGenerationSettings(
      this.deps.configPresenter,
      nextProviderId,
      nextModelId,
      { systemPrompt: currentGeneration.systemPrompt }
    )
    this.deps.sessionStore.updateSessionConfiguration(
      sessionId,
      nextProviderId,
      nextModelId,
      buildPersistedGenerationSettingsReplacement(sanitized)
    )

    const instance = this.deps.getInstance(sessionId)
    if (state) {
      state.providerId = nextProviderId
      state.modelId = nextModelId
    } else {
      instance.setRuntimeState({
        status: 'idle',
        providerId: nextProviderId,
        modelId: nextModelId,
        permissionMode
      })
    }
    instance.setGenerationSettings(sanitized)
    this.invalidateCaches(sessionId)
  }

  async setAgentContext(sessionId: string, config: SessionAgentContextUpdate): Promise<void> {
    const nextProviderId = config.providerId?.trim()
    const nextModelId = config.modelId?.trim()
    const nextAgentId = config.agentId?.trim()
    if (!nextAgentId || !nextProviderId || !nextModelId) {
      throw new Error('Session agent context update requires agentId, providerId and modelId.')
    }

    const state = this.deps.getRuntimeState(sessionId)
    const dbSession = this.deps.sessionStore.get(sessionId)
    if (!state && !dbSession) {
      throw new Error(`Session ${sessionId} not found`)
    }
    if (state?.status === 'generating') {
      throw new Error('Cannot move session while it is generating.')
    }

    const permissionMode = config.permissionMode
    const generationSettings = await sanitizeGenerationSettings(
      this.deps.configPresenter,
      nextProviderId,
      nextModelId,
      config.generationSettings ?? {}
    )
    const isAgentReassignment =
      (this.deps.getSessionAgentId(sessionId) ?? BUILTIN_DEEPCHAT_AGENT_ID) !== nextAgentId
    try {
      if (isAgentReassignment) {
        await this.deps.beginSessionAgentReassignment(sessionId)
      }
      this.deps.sessionStore.updateSessionConfiguration(
        sessionId,
        nextProviderId,
        nextModelId,
        buildPersistedGenerationSettingsReplacement(generationSettings),
        permissionMode
      )

      const instance = this.deps.getInstance(sessionId)
      instance.setRuntimeState({
        status: state?.status ?? 'idle',
        providerId: nextProviderId,
        modelId: nextModelId,
        permissionMode
      })
      instance.setAgentId(nextAgentId)
      instance.setProjectDir(this.deps.normalizeProjectDir(config.projectDir))
      instance.setGenerationSettings(generationSettings)
      this.deps.sessionPermissionPort?.clearSessionPermissions(sessionId)
      this.deps.toolPresenter?.clearAgentPlanState?.(sessionId)
      instance.replaceRuntimeActivatedSkills([])
      await this.deps.toolResolver.refilterActiveSkillsForAgentPolicy(
        sessionId,
        nextAgentId,
        instance
      )
      this.invalidateCaches(sessionId)
    } finally {
      if (isAgentReassignment) {
        this.deps.finishSessionAgentReassignment(sessionId)
      }
    }
  }

  setProjectDir(sessionId: string, projectDir: string | null): void {
    const normalized = this.deps.normalizeProjectDir(projectDir)
    const instance = this.deps.getInstance(sessionId)
    const previous = instance.hasProjectDir()
      ? instance.getProjectDir()
      : this.deps.resolvePersistedProjectDir(sessionId)
    instance.setProjectDir(normalized)
    if (previous !== normalized) {
      this.invalidateCaches(sessionId)
    }
  }

  getPermissionMode(sessionId: string): PermissionMode {
    const state = this.deps.getRuntimeState(sessionId)
    if (state) {
      return state.permissionMode
    }
    return this.deps.sessionStore.get(sessionId)?.permission_mode ?? 'default'
  }

  async getGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null> {
    const state = this.deps.getRuntimeState(sessionId)
    const dbSession = this.deps.sessionStore.get(sessionId)
    if (!state && !dbSession) {
      return null
    }
    return await this.deps.getEffectiveGenerationSettings(sessionId)
  }

  async updateGenerationSettings(
    sessionId: string,
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings> {
    const state = this.deps.getRuntimeState(sessionId)
    const dbSession = this.deps.sessionStore.get(sessionId)
    if (!state && !dbSession) {
      throw new Error(`Session ${sessionId} not found`)
    }
    const providerId = state?.providerId ?? dbSession?.provider_id
    const modelId = state?.modelId ?? dbSession?.model_id
    if (!providerId || !modelId) {
      throw new Error(`Session ${sessionId} model information is missing`)
    }

    const current = await this.deps.getEffectiveGenerationSettings(sessionId)
    const sanitized = await sanitizeGenerationSettings(
      this.deps.configPresenter,
      providerId,
      modelId,
      settings,
      current
    )
    this.deps.sessionStore.updateGenerationSettings(
      sessionId,
      buildPersistedGenerationSettingsPatch(settings, sanitized)
    )
    this.deps.getInstance(sessionId).setGenerationSettings(sanitized)
    if (Object.prototype.hasOwnProperty.call(settings, 'systemPrompt')) {
      this.deps.invalidateSystemPromptCache(sessionId)
    }
    return sanitized
  }

  private invalidateCaches(sessionId: string): void {
    this.deps.invalidateSystemPromptCache(sessionId)
    this.deps.invalidateToolProfileCache(sessionId)
  }
}
