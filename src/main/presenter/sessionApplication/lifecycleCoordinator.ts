import logger from '@shared/logger'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { normalizeCreateSessionInput } from '@/agent/shared/agentSessionNormalization'
import type {
  CreateDetachedSessionInput,
  CreateSessionInput,
  DeepChatSubagentMeta,
  PermissionMode,
  SessionRecord,
  SessionWithState
} from '@shared/types/agent-interface'
import type {
  SessionAssignmentPolicyPort,
  SessionAssignmentWorkdirPort,
  SessionInitialTurnPort,
  SessionLifecycleDeletionPort,
  SessionLifecyclePort,
  SessionLifecycleProjectionPort,
  SessionLifecycleRuntimeConfig,
  SessionLifecycleRuntimePort,
  SessionLifecycleSkillPort,
  SessionLifecycleStorePort,
  SessionLifecyclePermissionPort,
  SessionLifecycleSubagentInput,
  SessionLifecycleTranscriptPort
} from './ports'

const SUBAGENT_SESSION_INIT_MAX_ATTEMPTS = 2

export interface SessionLifecycleCoordinatorDependencies {
  sessions: SessionLifecycleStorePort
  runtime: SessionLifecycleRuntimePort
  transcript: SessionLifecycleTranscriptPort
  skills: SessionLifecycleSkillPort
  assignmentPolicy: SessionAssignmentPolicyPort
  workdir: SessionAssignmentWorkdirPort
  initialTurn: SessionInitialTurnPort
  projection: SessionLifecycleProjectionPort
  deletion: SessionLifecycleDeletionPort
  permissions?: SessionLifecyclePermissionPort
}

export class SessionLifecycleCoordinator implements SessionLifecyclePort {
  constructor(private readonly dependencies: SessionLifecycleCoordinatorDependencies) {}

  async createSession(input: CreateSessionInput, webContentsId: number): Promise<SessionWithState> {
    const assignment = await this.dependencies.assignmentPolicy.resolveCreateAssignment({
      agentId: input.agentId || 'deepchat',
      providerId: input.providerId,
      modelId: input.modelId,
      projectDir: input.projectDir,
      permissionMode: input.permissionMode,
      generationSettings: input.generationSettings,
      disabledAgentTools: input.disabledAgentTools,
      subagentEnabled: input.subagentEnabled,
      preserveExplicitNullProjectDir: true
    })
    const {
      agentId,
      providerId,
      modelId,
      projectDir,
      permissionMode,
      generationSettings,
      disabledAgentTools,
      subagentEnabled
    } = assignment
    logger.info(
      `[SessionLifecycleCoordinator] createSession agent=${agentId} webContentsId=${webContentsId}`
    )
    const normalizedInput = normalizeCreateSessionInput(input)
    logger.info(`[SessionLifecycleCoordinator] resolved provider=${providerId} model=${modelId}`)

    const title = normalizedInput.text.slice(0, 50) || 'New Chat'
    const sessionId = this.dependencies.sessions.create(agentId, title, projectDir, {
      isDraft: false,
      disabledAgentTools,
      subagentEnabled
    })
    logger.info(`[SessionLifecycleCoordinator] session created id=${sessionId}`)

    try {
      await this.initializeSessionRuntime(sessionId, {
        agentId,
        providerId,
        modelId,
        projectDir,
        permissionMode,
        ...(generationSettings ? { generationSettings } : {})
      })
    } catch (error) {
      await this.cleanupFailedSessionInitialization(sessionId, providerId)
      throw error
    }
    logger.info('[SessionLifecycleCoordinator] agent.initSession done')

    this.dependencies.projection.bindWindow(webContentsId, sessionId)
    this.dependencies.projection.notify({
      sessionIds: [sessionId],
      reason: 'created',
      activeSessionId: sessionId,
      webContentsId
    })

    const state = await this.dependencies.runtime.resolveSession(sessionId).snapshot()
    const result: SessionWithState = {
      id: sessionId,
      agentId,
      title,
      projectDir,
      isPinned: false,
      isDraft: false,
      sessionKind: 'regular',
      parentSessionId: null,
      subagentEnabled,
      subagentMeta: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: state?.status ?? 'idle',
      providerId: state?.providerId ?? providerId,
      modelId: state?.modelId ?? modelId
    }

    this.dependencies.initialTurn.startInitialTurn({
      sessionId,
      content: normalizedInput,
      projectDir,
      initialTitle: title,
      fallbackProviderId: providerId,
      fallbackModelId: modelId
    })
    return result
  }

  async createDetachedSession(input: CreateDetachedSessionInput): Promise<SessionWithState> {
    const title = input.title?.trim() || 'New Chat'
    const {
      agentId,
      providerId,
      modelId,
      projectDir,
      permissionMode,
      generationSettings,
      disabledAgentTools,
      subagentEnabled
    } = await this.dependencies.assignmentPolicy.resolveCreateAssignment({
      agentId: input.agentId?.trim() || 'deepchat',
      providerId: input.providerId,
      modelId: input.modelId,
      projectDir: input.projectDir,
      permissionMode: input.permissionMode,
      generationSettings: input.generationSettings,
      disabledAgentTools: input.disabledAgentTools,
      subagentEnabled: input.subagentEnabled,
      preserveExplicitNullProjectDir: false
    })

    const sessionId = this.dependencies.sessions.create(agentId, title, projectDir, {
      isDraft: false,
      disabledAgentTools,
      subagentEnabled,
      metadata: input.metadata ?? null
    })
    try {
      await this.initializeSessionRuntime(sessionId, {
        agentId,
        providerId,
        modelId,
        projectDir,
        permissionMode,
        generationSettings
      })
    } catch (error) {
      await this.cleanupFailedSessionInitialization(sessionId, providerId)
      throw error
    }

    if (input.activeSkills && input.activeSkills.length > 0) {
      await this.dependencies.skills.setActiveSkills(sessionId, input.activeSkills)
    }
    this.dependencies.projection.notify({ sessionIds: [sessionId], reason: 'created' })

    const state = await this.dependencies.runtime.resolveSession(sessionId).snapshot()
    return {
      id: sessionId,
      agentId,
      title,
      projectDir,
      isPinned: false,
      isDraft: false,
      sessionKind: 'regular',
      parentSessionId: null,
      subagentEnabled,
      subagentMeta: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      status: state?.status ?? 'idle',
      providerId: state?.providerId ?? providerId,
      modelId: state?.modelId ?? modelId
    }
  }

  async createSubagentSession(input: SessionLifecycleSubagentInput): Promise<SessionWithState> {
    const parentSessionId = input.parentSessionId?.trim()
    if (!parentSessionId) throw new Error('Subagent session requires a parentSessionId.')

    const slotId = input.slotId?.trim()
    if (!slotId) throw new Error('Subagent session requires a slotId.')

    const displayName = input.displayName?.trim() || 'Subagent'
    const agentId = input.agentId?.trim()
    if (!agentId) throw new Error('Subagent session requires an agentId.')

    const projectDir = input.projectDir?.trim() || null
    const runtimeConfig = await this.dependencies.assignmentPolicy.resolveSubagentAssignment({
      agentId,
      parentAgentId: input.parentAgentId,
      targetAgentId: input.targetAgentId,
      projectDir,
      providerId: input.providerId,
      modelId: input.modelId,
      permissionMode: input.permissionMode,
      generationSettings: input.generationSettings,
      disabledAgentTools: input.disabledAgentTools,
      activeSkills: input.activeSkills
    })
    const subagentMeta: DeepChatSubagentMeta = {
      slotId,
      displayName,
      targetAgentId: runtimeConfig.targetAgentId || null
    }
    let lastError: unknown = null

    for (let attempt = 1; attempt <= SUBAGENT_SESSION_INIT_MAX_ATTEMPTS; attempt += 1) {
      const sessionId = this.dependencies.sessions.create(
        runtimeConfig.agentId,
        displayName,
        projectDir,
        {
          isDraft: false,
          disabledAgentTools: runtimeConfig.disabledAgentTools,
          subagentEnabled: false,
          sessionKind: 'subagent',
          parentSessionId,
          subagentMeta
        }
      )

      try {
        await this.initializeSessionRuntime(sessionId, {
          agentId: runtimeConfig.agentId,
          providerId: runtimeConfig.providerId,
          modelId: runtimeConfig.modelId,
          projectDir,
          permissionMode: runtimeConfig.permissionMode,
          generationSettings: runtimeConfig.generationSettings
        })
        if (runtimeConfig.activeSkills.length > 0) {
          await this.dependencies.skills.setActiveSkills(sessionId, runtimeConfig.activeSkills)
        }
        const parentAgentId = input.parentAgentId?.trim()
        if (parentAgentId && runtimeConfig.agentId === parentAgentId) {
          // Only self-target children share the parent's trust boundary.
          this.dependencies.permissions?.cloneSessionPermissions?.(parentSessionId, sessionId)
        }
        if (!this.dependencies.sessions.get(sessionId)) {
          throw new Error(`Subagent session not found after creation: ${sessionId}`)
        }

        const session = await this.dependencies.projection.materializeRequired(sessionId)
        this.dependencies.projection.notify({ sessionIds: [session.id], reason: 'created' })
        return session
      } catch (error) {
        lastError = error
        await this.cleanupFailedSessionInitialization(sessionId, runtimeConfig.providerId)
        if (attempt >= SUBAGENT_SESSION_INIT_MAX_ATTEMPTS) throw error

        console.warn(
          `[SessionLifecycleCoordinator] Retrying subagent session initialization (${attempt}/${SUBAGENT_SESSION_INIT_MAX_ATTEMPTS - 1} retry used) for agent=${runtimeConfig.agentId} slot=${slotId}:`,
          error
        )
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Failed to create subagent session for slot ${slotId}.`)
  }

  async ensureAcpDraftSession(input: {
    agentId: string
    projectDir: string
    permissionMode?: PermissionMode
  }): Promise<SessionWithState> {
    const agentId = input.agentId?.trim()
    if (!agentId) throw new Error('ACP draft session requires an agentId.')

    const projectDir = input.projectDir?.trim()
    if (!projectDir) throw new Error('ACP draft session requires a non-empty projectDir.')

    const { agentId: canonicalAgentId, permissionMode } =
      this.dependencies.assignmentPolicy.resolveAcpDraftAssignment(agentId, input.permissionMode)
    let record = await this.findReusableDraftSession(canonicalAgentId, projectDir)
    let createdDraftSession = false
    if (!record) {
      const sessionId = this.dependencies.sessions.create(
        canonicalAgentId,
        'New Chat',
        projectDir,
        { isDraft: true, subagentEnabled: false }
      )
      try {
        await this.ensureSessionRuntimeInitialized(sessionId, {
          agentId: canonicalAgentId,
          providerId: 'acp',
          modelId: canonicalAgentId,
          projectDir,
          permissionMode
        })
      } catch (error) {
        await this.cleanupFailedSessionInitialization(sessionId, 'acp')
        throw error
      }
      record = this.dependencies.sessions.get(sessionId)
      if (!record) throw new Error(`Failed to read created ACP draft session: ${sessionId}`)
      createdDraftSession = true
    } else {
      await this.ensureSessionRuntimeInitialized(record.id, {
        agentId: canonicalAgentId,
        providerId: 'acp',
        modelId: canonicalAgentId,
        projectDir,
        permissionMode
      })
    }

    await this.dependencies.workdir.prepareDirectAcpSession(record.id)
    this.dependencies.projection.notify({
      sessionIds: [record.id],
      reason: createdDraftSession ? 'created' : 'updated'
    })
    const state = await this.dependencies.runtime
      .resolveSession(toAppSessionId(record.id))
      .snapshot()
    return {
      ...record,
      status: state?.status ?? 'idle',
      providerId: state?.providerId ?? 'acp',
      modelId: state?.modelId ?? canonicalAgentId
    }
  }

  async forkSession(
    sourceSessionId: string,
    targetMessageId: string,
    newTitle?: string
  ): Promise<SessionWithState> {
    const sourceSession = this.dependencies.sessions.get(sourceSessionId)
    if (!sourceSession) throw new Error(`Session not found: ${sourceSessionId}`)

    const sourceRuntime = this.dependencies.runtime.resolveSession(toAppSessionId(sourceSessionId))
    const sourceState = await sourceRuntime.snapshot()
    if (!sourceState) throw new Error(`Session state not found: ${sourceSessionId}`)
    const generationSettings = await sourceRuntime.getGenerationSettings()
    const title = this.buildForkTitle(sourceSession.title, newTitle)
    const targetSessionId = this.dependencies.sessions.create(
      sourceSession.agentId,
      title,
      sourceSession.projectDir ?? null,
      { isDraft: false }
    )

    try {
      await this.initializeSessionRuntime(targetSessionId, {
        agentId: sourceSession.agentId,
        providerId: sourceState.providerId,
        modelId: sourceState.modelId,
        projectDir: sourceSession.projectDir ?? null,
        permissionMode: sourceState.permissionMode,
        generationSettings: generationSettings ?? undefined
      })
      await this.dependencies.transcript.forkSessionFromMessage(
        sourceSessionId,
        targetSessionId,
        targetMessageId
      )
    } catch (error) {
      try {
        await this.dependencies.runtime.resolveSession(targetSessionId).close()
      } catch (cleanupError) {
        console.warn(
          `[SessionLifecycleCoordinator] Failed to cleanup forked session runtime ${targetSessionId}:`,
          cleanupError
        )
      }
      this.dependencies.sessions.delete(targetSessionId)
      throw error
    }

    this.dependencies.projection.notify({ sessionIds: [targetSessionId], reason: 'created' })
    const record = this.dependencies.sessions.get(targetSessionId)
    if (!record) throw new Error(`Forked session not found: ${targetSessionId}`)
    const targetState = await this.dependencies.runtime.resolveSession(targetSessionId).snapshot()
    return {
      ...record,
      status: targetState?.status ?? 'idle',
      providerId: targetState?.providerId ?? sourceState.providerId,
      modelId: targetState?.modelId ?? sourceState.modelId
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const deletedSessionIds = await this.dependencies.deletion.deleteSessionTree(sessionId)
    this.dependencies.projection.notify({ sessionIds: deletedSessionIds, reason: 'deleted' })
  }

  private async findReusableDraftSession(
    agentId: string,
    projectDir: string
  ): Promise<SessionRecord | null> {
    for (const session of this.dependencies.sessions.list({ agentId, projectDir })) {
      if (!session.isDraft) continue
      if (!(await this.hasSessionMessages(session.id))) return session
    }
    return null
  }

  private async hasSessionMessages(sessionId: string): Promise<boolean> {
    try {
      return await this.dependencies.transcript.hasMessages(sessionId)
    } catch (error) {
      console.warn(
        `[SessionLifecycleCoordinator] Failed to inspect messages for session=${sessionId}:`,
        error
      )
      return true
    }
  }

  private async ensureSessionRuntimeInitialized(
    sessionId: string,
    config: SessionLifecycleRuntimeConfig & { projectDir: string }
  ): Promise<void> {
    const runtime = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
    if (!(await runtime.isInitialized())) {
      await this.initializeSessionRuntime(sessionId, config)
      return
    }
    const state = await runtime.snapshot()
    if (!state) throw new Error(`Session ${sessionId} not found`)
    if (state.permissionMode && state.permissionMode !== config.permissionMode) {
      await runtime.setPermissionMode(config.permissionMode)
    }
    await this.dependencies.workdir.syncAcpSessionWorkdir(
      config.providerId,
      sessionId,
      config.agentId ?? config.modelId,
      config.projectDir
    )
  }

  private async initializeSessionRuntime(
    sessionId: string,
    config: SessionLifecycleRuntimeConfig
  ): Promise<void> {
    await this.dependencies.runtime.resolveSession(toAppSessionId(sessionId)).initialize(config)
    await this.dependencies.workdir.syncAcpSessionWorkdir(
      config.providerId,
      sessionId,
      config.agentId ?? config.modelId,
      config.projectDir ?? null
    )
  }

  private async cleanupFailedSessionInitialization(
    sessionId: string,
    providerId?: string
  ): Promise<void> {
    try {
      const runtime = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
      if (providerId === 'acp' && runtime.kind !== 'acp') {
        try {
          await this.dependencies.workdir.clearCompatibilityAcpSession(sessionId)
        } catch (error) {
          console.warn(
            `[SessionLifecycleCoordinator] Failed to clear ACP session after initialization error ${sessionId}:`,
            error
          )
        }
      }

      await runtime.close()
    } catch (cleanupError) {
      console.warn(
        `[SessionLifecycleCoordinator] Failed to cleanup session runtime after initialization error ${sessionId}:`,
        cleanupError
      )
    } finally {
      this.dependencies.sessions.delete(sessionId)
    }
  }

  private buildForkTitle(sourceTitle: string, customTitle?: string): string {
    const normalizedCustom = customTitle?.trim()
    if (normalizedCustom) return normalizedCustom
    const base = sourceTitle?.trim() || 'New Chat'
    return base.length >= 60 ? base.slice(0, 60).trim() : `${base} - Fork`
  }
}
