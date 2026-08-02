import path from 'node:path'
import type { WorkflowRun } from '@shared/workflow/domain'
import type { ChatMessageRecord, DeepChatAgentConfig } from '@shared/types/agent-interface'
import type { AgentToolSessionPort, ConversationSessionInfo } from '@/tool/runtimePorts'
import type { AgentSettingsPort } from '@/agent/settings'
import type {
  WorkflowCapabilityScopeResolution,
  WorkflowLaunchScopePort,
  WorkflowScopeRequest
} from './service'
import { canonicalizeWorkflowJson } from './domain/json'
import type { WorkflowExecutionSnapshot } from '@shared/workflow/domain'
import { canonicalizeWorkflowExecutionSnapshot } from './domain/executionSnapshot'

const WORKFLOW_CAPABILITY_SCOPE_MAX_BYTES = 512 * 1024

export interface WorkflowLaunchScopeResolverOptions {
  sessions: Pick<AgentToolSessionPort, 'resolveConversationSessionInfo'>
  agents: Pick<AgentSettingsPort, 'getAgentType' | 'resolveDeepChatAgentConfig'>
  messages: {
    getMessage(messageId: string): ChatMessageRecord | null | Promise<ChatMessageRecord | null>
  }
}

export class WorkflowLaunchScopeResolver implements WorkflowLaunchScopePort {
  constructor(private readonly options: WorkflowLaunchScopeResolverOptions) {}

  async resolve(
    input: WorkflowScopeRequest
  ): Promise<WorkflowCapabilityScopeResolution & { executionSnapshot: WorkflowExecutionSnapshot }> {
    const { parent, scope } = await this.resolveBase(input)
    if (parent.generationSettings === null) {
      throw new Error('Workflow parent generation settings are unavailable.')
    }
    const executionSnapshot = canonicalizeWorkflowExecutionSnapshot({
      schemaVersion: 1,
      providerId: parent.providerId,
      modelId: parent.modelId,
      generationSettings: parent.generationSettings
    }).snapshot
    return { ...scope, executionSnapshot }
  }

  async resolveCapabilityScope(
    input: WorkflowScopeRequest
  ): Promise<WorkflowCapabilityScopeResolution> {
    return (await this.resolveBase(input)).scope
  }

  private async resolveBase(input: WorkflowScopeRequest): Promise<{
    parent: ConversationSessionInfo
    scope: WorkflowCapabilityScopeResolution
  }> {
    const parent = await this.options.sessions.resolveConversationSessionInfo(input.parentSessionId)
    if (!parent) {
      throw new Error(`Workflow parent session does not exist: ${input.parentSessionId}`)
    }
    if (parent.agentType !== 'deepchat' || parent.sessionKind !== 'regular') {
      throw new Error('Workflow runs require a regular DeepChat parent session.')
    }

    const parentConfig = await this.options.agents.resolveDeepChatAgentConfig(parent.agentId)
    if (parentConfig.subagentEnabled !== true) {
      throw new Error('Workflow runs are disabled by the parent agent policy.')
    }

    await this.assertParentMessage(input.parentSessionId, input.parentMessageId)
    const allowedAgentIds = [...new Set(input.allowedAgentIds.map((id) => id.trim()))]
      .filter(Boolean)
      .sort()
    if (allowedAgentIds.length === 0) {
      throw new Error('Workflow launch requires at least one allowed DeepChat agent.')
    }

    const targetPolicies = await Promise.all(
      allowedAgentIds.map(async (agentId) => {
        if ((await this.options.agents.getAgentType(agentId)) !== 'deepchat') {
          throw new Error(
            `Workflow target agent is unavailable or not a DeepChat agent: ${agentId}`
          )
        }
        const config = await this.options.agents.resolveDeepChatAgentConfig(agentId)
        return projectTargetPolicy(agentId, config)
      })
    )
    const workspacePath = normalizeWorkspacePath(parent.projectDir)
    const capabilityScopeHash = canonicalizeWorkflowJson(
      {
        schemaVersion: 1,
        parent: projectParentPolicy(parent, parentConfig, workspacePath),
        targetPolicies
      },
      { maxBytes: WORKFLOW_CAPABILITY_SCOPE_MAX_BYTES }
    ).sha256
    const capabilities = [
      'deepchat-child-sessions',
      workspacePath ? 'inherit-parent-workspace' : 'no-workspace',
      'existing-child-tool-permissions',
      allowedAgentIds.some((agentId) => agentId !== parent.agentId)
        ? 'cross-agent-security-policy'
        : 'same-agent-security-policy'
    ]

    return {
      parent,
      scope: {
        workspacePath,
        allowedAgentIds,
        capabilityScopeHash,
        capabilities
      }
    }
  }

  private async assertParentMessage(
    parentSessionId: string,
    parentMessageId: string | null
  ): Promise<void> {
    if (parentMessageId === null) {
      return
    }
    const message = await this.options.messages.getMessage(parentMessageId)
    if (!message || message.sessionId !== parentSessionId) {
      throw new Error(
        `Workflow parent message ${parentMessageId} does not belong to session ${parentSessionId}.`
      )
    }
  }
}

export async function assertCurrentWorkflowRunScope(
  scope: WorkflowLaunchScopePort,
  run: WorkflowRun
): Promise<void> {
  let resolved: Awaited<ReturnType<WorkflowLaunchScopePort['resolveCapabilityScope']>>
  try {
    resolved = await scope.resolveCapabilityScope({
      parentSessionId: run.parentSessionId,
      // The message is immutable provenance, not execution authority. It is checked during
      // prepare/launch but may be pruned while a durable run remains resumable.
      parentMessageId: null,
      allowedAgentIds: run.allowedAgentIds
    })
  } catch (error) {
    throw new WorkflowCapabilityScopeChangedError(
      `Workflow capability scope can no longer be resolved: ${normalizeErrorMessage(error)}`,
      { cause: error }
    )
  }

  const expectedAgentIds = [...new Set(run.allowedAgentIds)].sort()
  const resolvedAgentIds = [...new Set(resolved.allowedAgentIds)].sort()
  if (
    resolved.workspacePath !== run.workspacePath ||
    resolved.capabilityScopeHash !== run.capabilityScopeHash ||
    resolvedAgentIds.length !== expectedAgentIds.length ||
    resolvedAgentIds.some((agentId, index) => agentId !== expectedAgentIds[index])
  ) {
    throw new WorkflowCapabilityScopeChangedError(
      'Workflow workspace or effective child capability scope changed after launch.'
    )
  }
}

export class WorkflowCapabilityScopeChangedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WorkflowCapabilityScopeChangedError'
  }
}

function normalizeWorkspacePath(projectDir: string | null): string | null {
  const normalized = projectDir?.trim()
  return normalized ? path.resolve(normalized) : null
}

function projectParentPolicy(
  parent: ConversationSessionInfo,
  config: DeepChatAgentConfig,
  workspacePath: string | null
): unknown {
  return {
    sessionId: parent.sessionId,
    agentId: parent.agentId,
    workspacePath,
    permissionMode: parent.permissionMode,
    disabledAgentTools: [...new Set(parent.disabledAgentTools)].sort(),
    activeSkills: [...new Set(parent.activeSkills)].sort(),
    subagentEnabled: config.subagentEnabled === true
  }
}

function projectTargetPolicy(agentId: string, config: DeepChatAgentConfig): unknown {
  return {
    agentId,
    configHash: canonicalizeWorkflowJson(normalizeAgentConfigForHash(config), {
      maxBytes: WORKFLOW_CAPABILITY_SCOPE_MAX_BYTES
    }).sha256
  }
}

function normalizeAgentConfigForHash(config: DeepChatAgentConfig): unknown {
  return normalizePlainJson({
    ...config,
    ...(Array.isArray(config.disabledAgentTools)
      ? { disabledAgentTools: [...new Set(config.disabledAgentTools)].sort() }
      : {}),
    ...(Array.isArray(config.enabledSkillNames)
      ? { enabledSkillNames: [...new Set(config.enabledSkillNames)].sort() }
      : {}),
    ...(Array.isArray(config.enabledMcpServerIds)
      ? { enabledMcpServerIds: [...new Set(config.enabledMcpServerIds)].sort() }
      : {})
  })
}

function normalizePlainJson(value: unknown): unknown {
  return value === undefined ? null : JSON.parse(JSON.stringify(value))
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
