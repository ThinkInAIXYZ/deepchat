import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type {
  AgentTransferBlockReason,
  AgentTransferImpact,
  AgentTransferImpactSample,
  PermissionMode,
  SessionGenerationSettings,
  SessionRecord,
  SessionWithState,
  SubagentTapeLinkInput,
  SubagentTapeLinkReceipt
} from '@shared/types/agent-interface'
import type { AcpConfigState } from '@shared/presenter'
import { resolveAcpAgentAlias } from '@shared/utils/acpAgentAlias'
import type {
  SessionAgentAssignmentPort,
  SessionAssignmentAcpControlPort,
  SessionAssignmentEnvironmentPort,
  SessionAssignmentPolicyPort,
  SessionAssignmentProjectionPort,
  SessionAssignmentRuntimePort,
  SessionAssignmentStorePort,
  SessionAssignmentWorkdirPort,
  SessionLifecycleDeletionPort
} from './ports'
import { normalizeDisabledAgentTools } from '@/agent/shared/agentSessionNormalization'

export interface SessionAgentAssignmentDependencies {
  sessions: SessionAssignmentStorePort
  runtime: SessionAssignmentRuntimePort
  policy: SessionAssignmentPolicyPort
  projection: SessionAssignmentProjectionPort
  deletion: SessionLifecycleDeletionPort
  environment: SessionAssignmentEnvironmentPort
  acp: SessionAssignmentAcpControlPort
}

export class SessionAgentAssignmentCoordinator
  implements SessionAgentAssignmentPort, SessionAssignmentWorkdirPort
{
  constructor(private readonly dependencies: SessionAgentAssignmentDependencies) {}

  async linkSubagentTape(input: SubagentTapeLinkInput): Promise<SubagentTapeLinkReceipt> {
    this.requireChildSession(input.parentSessionId, input.childSessionId)
    const resolved = this.dependencies.runtime.resolveSubagentFacet(
      toAppSessionId(input.parentSessionId)
    )
    return await resolved.facet.linkTape({
      ...input,
      parentSessionId: toAppSessionId(input.parentSessionId),
      childSessionId: toAppSessionId(input.childSessionId)
    })
  }

  async getAgentTransferImpact(agentId: string): Promise<AgentTransferImpact> {
    const normalizedAgentId = agentId.trim()
    if (!normalizedAgentId) {
      throw new Error('Agent id is required.')
    }

    const sessions = this.dependencies.sessions.list({
      agentId: normalizedAgentId,
      includeSubagents: true
    })
    const samples: AgentTransferImpactSample[] = []
    let emptyDrafts = 0
    let movableSessions = 0
    let blockedSessions = 0

    for (const session of sessions) {
      const assessment = await this.assessTransferSession(session)
      if (assessment.isEmptyDraft) emptyDrafts += 1
      if (assessment.blockReason) {
        blockedSessions += 1
      } else if (!assessment.isEmptyDraft) {
        movableSessions += 1
      }

      if (samples.length < 6 && (!assessment.isEmptyDraft || assessment.blockReason)) {
        samples.push({
          id: session.id,
          title: session.title,
          sessionKind: session.sessionKind,
          isDraft: Boolean(session.isDraft),
          projectDir: session.projectDir,
          status: assessment.status,
          blockReason: assessment.blockReason
        })
      }
    }

    return {
      agentId: normalizedAgentId,
      totalSessions: sessions.length,
      regularSessions: sessions.filter((session) => session.sessionKind === 'regular').length,
      subagentSessions: sessions.filter((session) => session.sessionKind === 'subagent').length,
      emptyDrafts,
      movableSessions,
      blockedSessions,
      samples
    }
  }

  async moveAgentSessions(
    fromAgentId: string,
    toAgentId: string
  ): Promise<{ movedSessionIds: string[]; deletedSessionIds: string[] }> {
    const sourceAgentId = fromAgentId.trim()
    const targetAgentId = toAgentId.trim()
    if (!sourceAgentId || !targetAgentId) {
      throw new Error('Source and target agent ids are required.')
    }
    if (sourceAgentId === targetAgentId) {
      throw new Error('Source and target agents cannot be the same.')
    }
    await this.dependencies.policy.resolveTransferTarget(targetAgentId, null)

    const sessions = this.dependencies.sessions.list({
      agentId: sourceAgentId,
      includeSubagents: true
    })
    const transferSessionIds: string[] = []
    const emptyDraftSessionIds: string[] = []
    const movedSessionIds: string[] = []
    const deletedSessionIds: string[] = []
    const deletedSessionIdSet = new Set<string>()

    for (const session of sessions) {
      const assessment = await this.assessTransferSession(session)
      if (assessment.blockReason) {
        throw new Error(`Session ${session.id} cannot be moved: ${assessment.blockReason}`)
      }
      if (assessment.isEmptyDraft) {
        emptyDraftSessionIds.push(session.id)
        continue
      }

      await this.dependencies.policy.resolveTransferTarget(targetAgentId, session.projectDir)
      transferSessionIds.push(session.id)
    }

    try {
      for (const sessionId of transferSessionIds) {
        if (deletedSessionIdSet.has(sessionId)) continue
        if (!this.dependencies.sessions.get(sessionId)) {
          throw new Error(`Session ${sessionId} is no longer available.`)
        }
        await this.moveSessionToAgentInternal(sessionId, targetAgentId, true)
        movedSessionIds.push(sessionId)
      }

      for (const sessionId of emptyDraftSessionIds) {
        if (deletedSessionIdSet.has(sessionId)) continue
        if (!this.dependencies.sessions.get(sessionId)) {
          throw new Error(`Session ${sessionId} is no longer available.`)
        }
        const deleted = await this.dependencies.deletion.deleteSessionTree(sessionId)
        deleted.forEach((deletedSessionId) => deletedSessionIdSet.add(deletedSessionId))
        deletedSessionIds.push(...deleted)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const partialCounts = [
        movedSessionIds.length > 0 ? `${movedSessionIds.length} moved` : '',
        deletedSessionIds.length > 0 ? `${deletedSessionIds.length} deleted` : ''
      ].filter(Boolean)

      if (partialCounts.length > 0) {
        this.notifyTransferResults(movedSessionIds, deletedSessionIds)
        throw new Error(`${message} Partial transfer completed: ${partialCounts.join(', ')}.`)
      }
      throw error
    }

    this.notifyTransferResults(movedSessionIds, deletedSessionIds)
    return { movedSessionIds, deletedSessionIds }
  }

  async deleteAgentSessions(agentId: string): Promise<string[]> {
    const normalizedAgentId = agentId.trim()
    if (!normalizedAgentId) {
      throw new Error('Agent id is required.')
    }

    const sessions = this.dependencies.sessions.list({
      agentId: normalizedAgentId,
      includeSubagents: true
    })
    const deletedSessionIds: string[] = []
    const deletedSessionIdSet = new Set<string>()

    for (const session of sessions) {
      const assessment = await this.assessTransferSession(session)
      if (assessment.blockReason) {
        throw new Error(`Session ${session.id} cannot be deleted: ${assessment.blockReason}`)
      }
    }

    for (const session of sessions) {
      if (deletedSessionIdSet.has(session.id) || !this.dependencies.sessions.get(session.id)) {
        continue
      }
      const deleted = await this.dependencies.deletion.deleteSessionTree(session.id)
      deleted.forEach((sessionId) => deletedSessionIdSet.add(sessionId))
      deletedSessionIds.push(...deleted)
    }

    if (deletedSessionIds.length > 0) {
      this.dependencies.projection.notify({
        sessionIds: deletedSessionIds,
        reason: 'deleted'
      })
    }
    return deletedSessionIds
  }

  async moveSessionToAgent(sessionId: string, toAgentId: string): Promise<SessionWithState> {
    const updated = await this.moveSessionToAgentInternal(sessionId, toAgentId)
    this.dependencies.projection.notify({ sessionIds: [sessionId], reason: 'updated' })
    return updated
  }

  async getAcpSessionCommands(sessionId: string): Promise<
    Array<{
      name: string
      description: string
      input?: { hint: string } | null
    }>
  > {
    if (!this.dependencies.sessions.get(sessionId)) return []
    const { handle } = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
    if (handle.kind === 'acp') return await handle.acp.getCommands()
    if ((await handle.snapshot())?.providerId !== 'acp') return []
    return await this.dependencies.acp.getAcpSessionCommands(sessionId)
  }

  async getAcpSessionConfigOptions(sessionId: string): Promise<AcpConfigState | null> {
    if (!this.dependencies.sessions.get(sessionId)) return null
    const { handle } = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
    if (handle.kind === 'acp') return await handle.acp.getConfigOptions()
    if ((await handle.snapshot())?.providerId !== 'acp') return null
    return await this.dependencies.acp.getAcpSessionConfigOptions(sessionId)
  }

  async setAcpSessionConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean
  ): Promise<AcpConfigState | null> {
    if (!this.dependencies.sessions.get(sessionId)) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const { handle } = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
    if (handle.kind === 'acp') return await handle.acp.setConfigOption(configId, value)
    if ((await handle.snapshot())?.providerId !== 'acp') {
      throw new Error('ACP session config options are only available for ACP sessions.')
    }
    return await this.dependencies.acp.setAcpSessionConfigOption(sessionId, configId, value)
  }

  async getPermissionMode(sessionId: string): Promise<PermissionMode> {
    this.requireSession(sessionId)
    return await this.dependencies.runtime
      .resolveSession(toAppSessionId(sessionId))
      .handle.settings.getPermissionMode()
  }

  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    this.requireSession(sessionId)
    await this.dependencies.runtime
      .resolveSession(toAppSessionId(sessionId))
      .handle.settings.setPermissionMode(mode)
  }

  async setSessionModel(
    sessionId: string,
    providerId: string,
    modelId: string
  ): Promise<SessionWithState> {
    const session = this.requireSession(sessionId)
    const nextProviderId = providerId?.trim()
    const nextModelId = modelId?.trim()
    if (!nextProviderId || !nextModelId) {
      throw new Error('setSessionModel requires providerId and modelId.')
    }

    const { handle } = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
    if (handle.kind !== 'deepchat') throw new Error('ACP session model is locked.')
    await handle.deepchat.setModel(nextProviderId, nextModelId)
    const state = await handle.snapshot()
    const updated: SessionWithState = {
      ...session,
      status: state?.status ?? 'idle',
      providerId: state?.providerId ?? nextProviderId,
      modelId: state?.modelId ?? nextModelId
    }
    this.dependencies.projection.notify({ sessionIds: [sessionId], reason: 'updated' })
    return updated
  }

  async setSessionProjectDir(
    sessionId: string,
    projectDir: string | null
  ): Promise<SessionWithState> {
    const session = this.requireSession(sessionId)
    const { handle } = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
    const state = await handle.snapshot()
    const providerId = state?.providerId?.trim() || (handle.kind === 'acp' ? 'acp' : '')
    const normalizedProjectDir = projectDir?.trim() || null
    this.assertAcpSessionHasWorkdir(providerId, normalizedProjectDir)

    this.dependencies.sessions.update(sessionId, { projectDir: normalizedProjectDir })
    if (normalizedProjectDir) this.dependencies.environment.syncPath(normalizedProjectDir)
    await handle.settings.setProjectDir(normalizedProjectDir)
    await this.syncAcpSessionWorkdir(providerId, sessionId, session.agentId, normalizedProjectDir)

    if (!this.dependencies.sessions.get(sessionId)) {
      throw new Error(`Session not found after update: ${sessionId}`)
    }

    this.dependencies.projection.notify({ sessionIds: [sessionId], reason: 'updated' })
    const materialized = await this.dependencies.projection.materialize(sessionId)
    if (!materialized) {
      throw new Error(`Failed to build session state after project update: ${sessionId}`)
    }
    return materialized
  }

  async getSessionGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null> {
    this.requireSession(sessionId)
    return await this.dependencies.runtime
      .resolveSession(toAppSessionId(sessionId))
      .handle.settings.getGenerationSettings()
  }

  async getSessionDisabledAgentTools(sessionId: string): Promise<string[]> {
    this.requireSession(sessionId)
    return this.dependencies.sessions.getDisabledAgentTools(sessionId)
  }

  async updateSessionDisabledAgentTools(
    sessionId: string,
    disabledAgentTools: string[]
  ): Promise<string[]> {
    this.requireSession(sessionId)
    const normalized = normalizeDisabledAgentTools(disabledAgentTools)
    this.dependencies.sessions.updateDisabledAgentTools(sessionId, normalized)

    const { handle } = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
    if (handle.kind === 'deepchat') handle.deepchat.invalidateSystemPromptCache()
    return normalized
  }

  async updateSessionGenerationSettings(
    sessionId: string,
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings> {
    this.requireSession(sessionId)
    return await this.dependencies.runtime
      .resolveSession(toAppSessionId(sessionId))
      .handle.settings.updateGenerationSettings(settings)
  }

  assertAcpSessionHasWorkdir(providerId: string, projectDir: string | null): void {
    this.dependencies.policy.assertAcpSessionHasWorkdir(providerId, projectDir)
  }

  async syncAcpSessionWorkdir(
    providerId: string,
    sessionId: string,
    agentId: string,
    projectDir?: string | null
  ): Promise<void> {
    if (providerId !== 'acp') return
    const normalizedProjectDir = projectDir?.trim()
    if (!normalizedProjectDir) return

    try {
      const { handle } = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
      if (handle.kind === 'acp') {
        await handle.acp.updateWorkdir(normalizedProjectDir)
        return
      }
      await this.dependencies.acp.setAcpWorkdir(
        sessionId,
        resolveAcpAgentAlias(agentId),
        normalizedProjectDir
      )
    } catch (error) {
      console.warn('[SessionAgentAssignmentCoordinator] Failed to sync ACP workdir:', {
        sessionId,
        agentId,
        projectDir: normalizedProjectDir,
        error
      })
      throw error
    }
  }

  async prepareDirectAcpSession(sessionId: string): Promise<void> {
    const { handle } = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
    if (handle.kind !== 'acp') {
      throw new Error(`Session ${sessionId} is not a direct ACP session.`)
    }
    await handle.acp.prepare()
  }

  async clearCompatibilityAcpSession(sessionId: string): Promise<void> {
    await this.dependencies.acp.clearAcpSession(sessionId)
  }

  private async assessTransferSession(session: SessionRecord): Promise<{
    status: SessionWithState['status']
    isEmptyDraft: boolean
    blockReason?: AgentTransferBlockReason
  }> {
    const { handle, facet } = this.dependencies.runtime.resolveTransferSource(
      toAppSessionId(session.id)
    )
    const state = await handle.snapshot()
    const status = state?.status ?? 'idle'
    let hasMessages = true
    try {
      hasMessages = await facet.hasMessages(toAppSessionId(session.id))
    } catch (error) {
      console.warn(
        `[SessionAgentAssignmentCoordinator] Failed to inspect messages for session=${session.id}:`,
        error
      )
    }

    let hasPendingInput = false
    try {
      hasPendingInput = (await facet.listPendingInputs(toAppSessionId(session.id))).length > 0
    } catch (error) {
      console.warn(
        `[SessionAgentAssignmentCoordinator] Failed to inspect pending input for session=${session.id}:`,
        error
      )
      hasPendingInput = true
    }

    const hasSubagentChildren =
      session.sessionKind === 'regular' &&
      this.dependencies.sessions.list({
        includeSubagents: true,
        parentSessionId: session.id
      }).length > 0
    const isEmptyDraft = Boolean(session.isDraft) && !hasMessages && !hasSubagentChildren

    if (status === 'generating') return { status, isEmptyDraft, blockReason: 'active' }
    if (hasPendingInput) return { status, isEmptyDraft, blockReason: 'pending-input' }
    return { status, isEmptyDraft }
  }

  private async moveSessionToAgentInternal(
    sessionId: string,
    toAgentId: string,
    allowSubagent: boolean = false
  ): Promise<SessionWithState> {
    const session = this.requireSession(sessionId)
    if (!allowSubagent && session.sessionKind !== 'regular') {
      throw new Error('Only regular conversations can be moved from the conversation menu.')
    }

    const targetAgentId = toAgentId.trim()
    if (!targetAgentId) throw new Error('Target agent id is required.')
    if (session.agentId === targetAgentId) {
      throw new Error('Conversation is already assigned to the selected agent.')
    }

    const assessment = await this.assessTransferSession(session)
    if (assessment.blockReason) {
      throw new Error(`Session ${sessionId} cannot be moved: ${assessment.blockReason}`)
    }

    const target = await this.dependencies.policy.resolveTransferTarget(
      targetAgentId,
      session.projectDir
    )
    const source = this.dependencies.runtime.resolveTransferSource(toAppSessionId(sessionId))
    const sourceState = await source.handle.snapshot()
    const previousDirectAcp = source.handle.kind === 'acp'
    const previousCompatibilityAcp =
      source.handle.kind === 'deepchat' && sourceState?.providerId === 'acp'
    const { facet: transferTarget } = this.dependencies.runtime.resolveDeepChatTransferTarget(
      target.agentId
    )

    await transferTarget.setSessionAgentContext(toAppSessionId(sessionId), {
      agentId: target.agentId,
      providerId: target.providerId,
      modelId: target.modelId,
      projectDir: target.projectDir,
      permissionMode: target.permissionMode,
      generationSettings: target.generationSettings
    })

    this.dependencies.sessions.updateAgentId(sessionId, target.agentId)
    this.dependencies.sessions.update(sessionId, {
      projectDir: target.projectDir
    })
    this.dependencies.sessions.updateDisabledAgentTools(sessionId, target.disabledAgentTools)
    await this.syncAcpSessionWorkdir(
      target.providerId,
      sessionId,
      target.agentId,
      target.projectDir
    )

    if (!this.dependencies.sessions.get(sessionId)) {
      throw new Error(`Session not found after transfer: ${sessionId}`)
    }
    const materialized = await this.dependencies.projection.materialize(sessionId)
    if (!materialized) {
      throw new Error(`Failed to build session state after transfer: ${sessionId}`)
    }

    if (previousDirectAcp && source.closeRuntime) {
      try {
        await source.closeRuntime()
      } catch (error) {
        console.warn(
          `[SessionAgentAssignmentCoordinator] Failed to close direct ACP runtime after transfer ${sessionId}:`,
          error
        )
      }
    } else if (previousCompatibilityAcp) {
      try {
        await this.clearCompatibilityAcpSession(sessionId)
      } catch (error) {
        console.warn(
          `[SessionAgentAssignmentCoordinator] Failed to clear stale ACP binding after transfer ${sessionId}:`,
          error
        )
      }
    }

    return materialized
  }

  private requireSession(sessionId: string): SessionRecord {
    const session = this.dependencies.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return session
  }

  private requireChildSession(parentSessionId: string, childSessionId: string): void {
    this.requireSession(parentSessionId)
    const child = this.requireSession(childSessionId)
    if (child.sessionKind !== 'subagent' || child.parentSessionId !== parentSessionId) {
      throw new Error(`Session ${childSessionId} is not a child of ${parentSessionId}.`)
    }
  }

  private notifyTransferResults(movedSessionIds: string[], deletedSessionIds: string[]): void {
    if (movedSessionIds.length > 0) {
      this.dependencies.projection.notify({ sessionIds: movedSessionIds, reason: 'updated' })
    }
    if (deletedSessionIds.length > 0) {
      this.dependencies.projection.notify({ sessionIds: deletedSessionIds, reason: 'deleted' })
    }
  }
}
