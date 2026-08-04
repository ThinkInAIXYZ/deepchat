import type { PermissionMode, SessionGenerationSettings } from '@shared/types/agent-interface'
import type { ConversationSessionInfo } from '@/tool/runtimePorts'
import type {
  SessionAgentAssignmentPort,
  SessionAssignmentPolicyPort,
  SessionPermissionPort
} from '@/session/contracts'

export interface LiveDelegationTurnExecutionSnapshot {
  providerId: string
  modelId: string
  generationSettings: SessionGenerationSettings | null
}

export interface PrepareLiveDelegationTurnInput {
  parentSessionId: string
  parentAgentId: string
  parentPermissionMode: PermissionMode
  childSessionId: string
  targetAgentId: string
  slotId: string
  delegationId: string
  projectDir: string | null
  executionSnapshot: LiveDelegationTurnExecutionSnapshot | null
}

export interface LiveDelegationSafetyPort {
  prepareTurn(input: PrepareLiveDelegationTurnInput): Promise<ConversationSessionInfo | null>
}

export interface LiveDelegationSafetyCoordinatorOptions {
  sessions: {
    resolveConversationSessionInfo(sessionId: string): Promise<ConversationSessionInfo | null>
  }
  assignmentPolicy: Pick<SessionAssignmentPolicyPort, 'resolveSubagentAssignment'>
  assignment: Pick<SessionAgentAssignmentPort, 'setPermissionMode' | 'setSessionProjectDir'>
  permissions: Pick<SessionPermissionPort, 'clearSessionPermissions'>
  executionSnapshots: {
    applyTurnExecutionSnapshot(
      sessionId: string,
      snapshot: {
        providerId: string
        modelId: string
        generationSettings: SessionGenerationSettings
      }
    ): Promise<void>
  }
}

export class LiveDelegationSafetyCoordinator implements LiveDelegationSafetyPort {
  constructor(private readonly options: LiveDelegationSafetyCoordinatorOptions) {}

  async prepareTurn(
    input: PrepareLiveDelegationTurnInput
  ): Promise<ConversationSessionInfo | null> {
    let child = await this.options.sessions.resolveConversationSessionInfo(input.childSessionId)
    if (!child) return null
    this.assertLineage(child, input)
    let assignment = await this.resolveAssignment(child, input)

    if (input.executionSnapshot) {
      await this.restoreExecutionSnapshot(child, input.executionSnapshot)
      child = await this.options.sessions.resolveConversationSessionInfo(input.childSessionId)
      if (!child) return null
      this.assertLineage(child, input)
      assignment = await this.resolveAssignment(child, input)
    }

    const projectDir = input.projectDir?.trim() || null
    const projectChanged = (child.projectDir?.trim() || null) !== projectDir
    const permissionChanged = child.permissionMode !== assignment.permissionMode
    if (!projectChanged && !permissionChanged) return child

    this.options.permissions.clearSessionPermissions(child.sessionId)

    // A workdir update crosses a security boundary. Stage the restrictive mode first so a
    // partial failure cannot leave the child with broad authority over either workdir.
    let currentPermissionMode = child.permissionMode
    if (projectChanged && currentPermissionMode !== 'default') {
      await this.options.assignment.setPermissionMode(child.sessionId, 'default')
      currentPermissionMode = 'default'
    }
    if (projectChanged) {
      await this.options.assignment.setSessionProjectDir(child.sessionId, projectDir)
    }
    if (currentPermissionMode !== assignment.permissionMode) {
      await this.options.assignment.setPermissionMode(child.sessionId, assignment.permissionMode)
    }

    const updated = await this.options.sessions.resolveConversationSessionInfo(child.sessionId)
    if (!updated) return null
    this.assertLineage(updated, input)
    if (
      (updated.projectDir?.trim() || null) !== projectDir ||
      updated.permissionMode !== assignment.permissionMode
    ) {
      throw new Error(`Child Session ${child.sessionId} safety state did not converge.`)
    }
    return updated
  }

  private async resolveAssignment(
    child: ConversationSessionInfo,
    input: PrepareLiveDelegationTurnInput
  ) {
    const assignment = await this.options.assignmentPolicy.resolveSubagentAssignment({
      agentId: input.targetAgentId,
      parentAgentId: input.parentAgentId,
      targetAgentId: input.targetAgentId,
      projectDir: input.projectDir,
      providerId: child.providerId,
      modelId: child.modelId,
      permissionMode: input.parentPermissionMode,
      generationSettings: child.generationSettings ?? undefined,
      disabledAgentTools: child.disabledAgentTools,
      activeSkills: child.activeSkills
    })
    if (assignment.agentId !== child.agentId) {
      throw new Error(`Subagent target changed for child Session ${child.sessionId}.`)
    }
    return assignment
  }

  private async restoreExecutionSnapshot(
    child: ConversationSessionInfo,
    snapshot: LiveDelegationTurnExecutionSnapshot
  ): Promise<void> {
    if (child.agentType === 'deepchat') {
      if (!snapshot.generationSettings) {
        throw new Error(`DeepChat child Session ${child.sessionId} has no execution settings.`)
      }
      await this.options.executionSnapshots.applyTurnExecutionSnapshot(child.sessionId, {
        providerId: snapshot.providerId,
        modelId: snapshot.modelId,
        generationSettings: snapshot.generationSettings
      })
      return
    }
    if (child.agentType === 'acp') {
      if (child.providerId !== snapshot.providerId || child.modelId !== snapshot.modelId) {
        throw new Error(`ACP child Session ${child.sessionId} execution target changed.`)
      }
      return
    }
    throw new Error(`Child Session ${child.sessionId} has no executable Agent type.`)
  }

  private assertLineage(
    child: ConversationSessionInfo,
    input: PrepareLiveDelegationTurnInput
  ): void {
    if (
      child.sessionKind !== 'subagent' ||
      child.parentSessionId !== input.parentSessionId ||
      child.subagentMeta?.slotId !== input.slotId ||
      child.subagentMeta.liveDelegation?.delegationId !== input.delegationId
    ) {
      throw new Error(`Child session lineage changed for delegation ${input.delegationId}.`)
    }
  }
}
