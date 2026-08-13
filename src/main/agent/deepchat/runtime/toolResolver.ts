import type { SkillServicePort } from '@shared/types/skill'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { ToolServicePort } from '@shared/types/tool'
import type {
  AgentType,
  DeepChatAgentConfig,
  DeepChatSubagentCapability,
  SessionKind
} from '@shared/types/agent-interface'
import type { SessionDatabase } from '@/session/data/database'
import type {
  DeepChatAgentInstance,
  DeepChatToolProfileKind
} from '@/agent/deepchat/instance/deepChatAgentInstance'
import {
  isStaleDeepChatInstanceError,
  type DeepChatAgentRuntime,
  type SessionScopeRegistry
} from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { SessionIdentityService } from './sessionIdentityService'
import type { ToolCatalogPort } from '@/agent/deepchat/loop/ports'
import {
  normalizeStringList,
  type AgentExtensionPolicy
} from '@/agent/deepchat/resources/systemPromptBuilder'
import { createToolCatalogPort } from './toolAdapters'
import type { SkillSettingsPort } from '@/skill/settings'
import type { AgentSettingsPort } from '@/agent/settings'
import { resolveDeepChatSubagentCapability } from '@shared/lib/deepchatSubagents'
import {
  normalizeOrchestrationPolicy,
  type OrchestrationPolicy
} from '@shared/orchestration/policy'
import { composeSubagentAuthority } from '@/session/subagentAuthority'

type ToolResolverSkillPort = Pick<
  SkillServicePort,
  'getActiveSkills' | 'revalidateActiveSkillsForAgent' | 'validateSkillNames'
>

export interface DeepChatToolResolverDependencies {
  agentSettings: Pick<AgentSettingsPort, 'getAgentType' | 'resolveDeepChatAgentConfig'>
  skillSettings: SkillSettingsPort
  sqlitePresenter: SessionDatabase
  toolService: ToolServicePort
  skillService: ToolResolverSkillPort
  registry: SessionScopeRegistry & Pick<DeepChatAgentRuntime, 'getToolRegistryRevision'>
  identity: Pick<SessionIdentityService, 'getAgentId' | 'isAcpBackedSubagentSession'>
}

export interface DeepChatToolCatalogSnapshot {
  activeSkillNames: string[]
  enabledMcpServerIds: string[] | null | undefined
}

export class DeepChatToolResolver {
  constructor(private readonly dependencies: DeepChatToolResolverDependencies) {}

  private assertCurrent(sessionId: string, instance: DeepChatAgentInstance): void {
    this.dependencies.registry.scopeFor(toAppSessionId(sessionId), instance).assertCurrent()
  }

  resolveOrchestrationPolicy(sessionId: string): OrchestrationPolicy {
    const sessionRow = this.dependencies.sqlitePresenter.newSessionsTable?.get?.(sessionId)
    return normalizeOrchestrationPolicy(sessionRow?.orchestration_policy)
  }

  async loadToolDefinitionsForSession(
    sessionId: string,
    projectDir: string | null,
    activeSkillNamesOverride?: string[],
    providedResourceInstance?: DeepChatAgentInstance,
    onResolved?: (snapshot: DeepChatToolCatalogSnapshot) => void
  ): Promise<MCPToolDefinition[]> {
    const resourceInstance =
      providedResourceInstance ??
      this.dependencies.registry.getOrHydrateScope(toAppSessionId(sessionId)).instance
    const catalog = this.createSessionToolCatalogPort(
      sessionId,
      projectDir,
      resourceInstance,
      onResolved,
      true
    )
    return await catalog.resolve(
      activeSkillNamesOverride === undefined
        ? undefined
        : { activeSkillNames: activeSkillNamesOverride }
    )
  }

  createSessionToolCatalogPort(
    sessionId: string,
    projectDir: string | null,
    resourceInstance: DeepChatAgentInstance,
    onResolved?: (snapshot: DeepChatToolCatalogSnapshot) => void,
    trustActiveSkillNamesOverride = false
  ): ToolCatalogPort {
    const catalog = createToolCatalogPort<DeepChatToolProfileKind>({
      toolService: this.dependencies.toolService,
      resolveContext: async (request) => {
        this.assertCurrent(sessionId, resourceInstance)
        const activeSkillNamesOverride = request?.activeSkillNames
        const failClosed = request?.failClosed === true
        const scopedAgentId =
          resourceInstance.getAgentId()?.trim() ||
          this.dependencies.identity.getAgentId(sessionId)?.trim() ||
          null
        const agentId = scopedAgentId ?? 'deepchat'
        const toolPolicy = await this.resolveAgentToolPolicy(
          sessionId,
          resourceInstance,
          failClosed
        )
        const policy = toolPolicy.extensionPolicy
        const requestedActiveSkillNames = failClosed
          ? normalizeStringList([
              ...(await this.resolveActiveSkillNamesForToolProfile(sessionId, true)),
              ...resourceInstance.getRuntimeActivatedSkills()
            ])
          : activeSkillNamesOverride === undefined
            ? await this.resolveActiveSkillNamesForToolProfile(sessionId)
            : normalizeStringList(activeSkillNamesOverride)
        const effectiveActiveSkillNames =
          activeSkillNamesOverride !== undefined && trustActiveSkillNamesOverride && !failClosed
            ? normalizeStringList(activeSkillNamesOverride)
            : await this.validateSkillNamesForAgent(
                scopedAgentId,
                requestedActiveSkillNames,
                failClosed
              )
        const profile = this.resolveToolProfile(
          sessionId,
          projectDir,
          effectiveActiveSkillNames,
          policy,
          toolPolicy.disabledAgentTools,
          toolPolicy.subagentCapability,
          resourceInstance
        )
        this.assertCurrent(sessionId, resourceInstance)
        const enabledMcpServerIds = this.toToolDefinitionMcpServerIds(policy.enabledMcpServerIds)

        return {
          profile: profile.kind,
          fingerprint: profile.fingerprint,
          cached: failClosed ? undefined : resourceInstance.getToolProfileCache(),
          context: {
            agentId,
            disabledAgentTools: toolPolicy.disabledAgentTools,
            chatMode: 'agent',
            conversationId: sessionId,
            sessionKind: toolPolicy.sessionKind,
            agentWorkspacePath: projectDir,
            activeSkillNames: effectiveActiveSkillNames,
            subagentCapability: toolPolicy.subagentCapability,
            ...(failClosed ? { requireCompleteCatalog: true } : {}),
            ...(enabledMcpServerIds === undefined ? {} : { enabledMcpServerIds })
          }
        }
      },
      commitCache: (entry) => {
        this.assertCurrent(sessionId, resourceInstance)
        resourceInstance.setToolProfileCache(entry)
      },
      onResolved: ({ context }) => {
        onResolved?.({
          activeSkillNames: normalizeStringList(context.activeSkillNames ?? []),
          enabledMcpServerIds: this.normalizeNullablePolicyList(context.enabledMcpServerIds)
        })
      }
    })

    return {
      resolve: async (request) => {
        this.assertCurrent(sessionId, resourceInstance)
        const providerId = resourceInstance.getRuntimeState()?.providerId?.trim()
        if (this.dependencies.identity.isAcpBackedSubagentSession(sessionId, providerId)) {
          onResolved?.({
            activeSkillNames: normalizeStringList(request?.activeSkillNames ?? []),
            enabledMcpServerIds: undefined
          })
          return []
        }

        try {
          return await catalog.resolve(request)
        } catch (error) {
          if (isStaleDeepChatInstanceError(error)) throw error
          if (request?.failClosed) throw error
          console.error('[DeepChatAgent] failed to fetch tool definitions:', error)
          onResolved?.({
            activeSkillNames: normalizeStringList(request?.activeSkillNames ?? []),
            enabledMcpServerIds: undefined
          })
          return []
        }
      }
    }
  }

  private resolveToolProfile(
    sessionId: string,
    projectDir: string | null,
    activeSkillNamesOverride: string[],
    extensionPolicy: AgentExtensionPolicy,
    disabledAgentTools: string[],
    subagentCapability: DeepChatSubagentCapability,
    resourceInstance?: DeepChatAgentInstance
  ): { kind: DeepChatToolProfileKind; fingerprint: string } {
    const normalizedProjectDir = projectDir?.trim() || null
    const skillsEnabled = this.dependencies.skillSettings.isEnabled()
    const activeSkillNames = normalizeStringList(activeSkillNamesOverride)
    const state =
      resourceInstance?.getRuntimeState() ?? this.dependencies.registry.getHydratedScope(toAppSessionId(sessionId))?.state()
    const agentId =
      resourceInstance?.getAgentId()?.trim() ||
      this.dependencies.identity.getAgentId(sessionId) ||
      'deepchat'
    const kind: DeepChatToolProfileKind = normalizedProjectDir ? 'code' : 'general'

    return {
      kind,
      fingerprint: JSON.stringify({
        kind,
        agentId,
        projectDir: normalizedProjectDir ?? '',
        providerId: state?.providerId ?? '',
        modelId: state?.modelId ?? '',
        toolRegistryRevision: this.dependencies.registry.getToolRegistryRevision(),
        disabledAgentTools: [...disabledAgentTools].sort((left, right) =>
          left.localeCompare(right)
        ),
        enabledMcpServerIds: this.normalizeNullablePolicyList(extensionPolicy.enabledMcpServerIds),
        skillsEnabled,
        activeSkillNames,
        subagentCapability: subagentCapability.cacheKey
      })
    }
  }

  async resolveActiveSkillNamesForToolProfile(
    sessionId: string,
    failClosed = false
  ): Promise<string[]> {
    if (!this.dependencies.skillSettings.isEnabled()) {
      return []
    }

    try {
      return normalizeStringList(await this.dependencies.skillService.getActiveSkills(sessionId))
    } catch (error) {
      console.warn(
        `[DeepChatAgent] Failed to load active skills for tool profile in session ${sessionId}:`,
        error
      )
      if (failClosed) throw error
      return []
    }
  }

  private async resolveAgentToolPolicy(
    sessionId: string,
    resourceInstance?: DeepChatAgentInstance,
    failClosed = false
  ): Promise<{
    extensionPolicy: AgentExtensionPolicy
    disabledAgentTools: string[]
    subagentCapability: DeepChatSubagentCapability
    sessionKind: SessionKind | undefined
  }> {
    const agentId =
      resourceInstance?.getAgentId()?.trim() ||
      this.dependencies.identity.getAgentId(sessionId) ||
      'deepchat'
    const sessionRow = this.dependencies.sqlitePresenter.newSessionsTable?.get?.(sessionId)
    const persistedDisabledAgentTools = this.getDisabledAgentTools(sessionId)
    const resolveCapability = (agentType: AgentType | null, config?: DeepChatAgentConfig | null) =>
      resolveDeepChatSubagentCapability({
        agentType,
        sessionKind: sessionRow?.session_kind ?? null,
        agentPolicyEnabled: config?.subagentEnabled !== false,
        slots: config?.subagents
      })

    const [agentTypeResult, configResult] = await Promise.allSettled([
      this.dependencies.agentSettings.getAgentType(agentId),
      this.dependencies.agentSettings.resolveDeepChatAgentConfig(agentId)
    ])
    const agentType = agentTypeResult.status === 'fulfilled' ? agentTypeResult.value : null

    if (agentTypeResult.status === 'rejected') {
      console.warn(
        `[DeepChatAgent] Failed to resolve Agent type for tool policy ${agentId}:`,
        agentTypeResult.reason
      )
      if (failClosed) throw agentTypeResult.reason
    }
    if (configResult.status === 'rejected') {
      console.warn(
        `[DeepChatAgent] Failed to resolve tool policy for agent ${agentId}:`,
        configResult.reason
      )
      if (failClosed) throw configResult.reason
      if (sessionRow?.session_kind === 'subagent') {
        throw new Error(`Subagent Session ${sessionId} tool policy is unavailable.`)
      }
      return {
        extensionPolicy: {},
        disabledAgentTools: persistedDisabledAgentTools,
        subagentCapability: resolveCapability(agentType, null),
        sessionKind: sessionRow?.session_kind
      }
    }

    const config = configResult.value
    if (sessionRow?.session_kind === 'subagent') {
      const parentSessionId = sessionRow.parent_session_id?.trim()
      const parentRow = parentSessionId
        ? this.dependencies.sqlitePresenter.newSessionsTable.get(parentSessionId)
        : null
      const parentAgentId = parentRow?.agent_id?.trim()
      if (!parentSessionId || !parentAgentId) {
        throw new Error(`Subagent Session ${sessionId} has no resolvable parent tool policy.`)
      }

      let parentConfig: DeepChatAgentConfig
      try {
        parentConfig = await this.dependencies.agentSettings.resolveDeepChatAgentConfig(
          parentAgentId
        )
      } catch (error) {
        console.warn(
          `[DeepChatAgent] Failed to resolve parent tool policy for subagent ${sessionId}:`,
          error
        )
        throw new Error(`Subagent Session ${sessionId} parent tool policy is unavailable.`)
      }

      const authority = composeSubagentAuthority(
        { disabledAgentTools: persistedDisabledAgentTools },
        parentConfig,
        config
      )
      return {
        extensionPolicy: {
          enabledMcpServerIds: authority.enabledMcpServerIds
        },
        disabledAgentTools: authority.disabledAgentTools,
        subagentCapability: resolveCapability(agentType, config),
        sessionKind: sessionRow.session_kind
      }
    }

    return {
      extensionPolicy: config
        ? {
            enabledMcpServerIds: config.enabledMcpServerIds
          }
        : {},
      disabledAgentTools: persistedDisabledAgentTools,
      subagentCapability: resolveCapability(agentType, config),
      sessionKind: sessionRow?.session_kind
    }
  }

  async resolveAgentExtensionPolicy(
    sessionId: string,
    resourceInstance?: DeepChatAgentInstance
  ): Promise<AgentExtensionPolicy> {
    return (await this.resolveAgentToolPolicy(sessionId, resourceInstance)).extensionPolicy
  }

  toToolDefinitionMcpServerIds(value?: string[] | null): string[] | undefined {
    if (value === null || value === undefined) {
      return undefined
    }
    return normalizeStringList(value)
  }

  async revalidateActiveSkillsForAgent(sessionId: string, agentId: string): Promise<void> {
    try {
      await this.dependencies.skillService.revalidateActiveSkillsForAgent(sessionId, agentId)
    } catch (error) {
      console.warn(
        `[DeepChatAgent] Failed to revalidate active skills after agent rebind for session ${sessionId}:`,
        error
      )
    }
  }

  async validateSkillNamesForSession(
    sessionId: string,
    skillNames: string[],
    resourceInstance?: DeepChatAgentInstance
  ): Promise<string[]> {
    const agentId =
      resourceInstance?.getAgentId()?.trim() ||
      this.dependencies.identity.getAgentId(sessionId)?.trim() ||
      null
    return await this.validateSkillNamesForAgent(agentId, skillNames)
  }

  private async validateSkillNamesForAgent(
    agentId: string | null,
    skillNames: string[],
    failClosed = false
  ): Promise<string[]> {
    const normalizedSkillNames = normalizeStringList(skillNames)
    if (!agentId || !this.dependencies.skillSettings.isEnabled()) {
      if (failClosed && normalizedSkillNames.length > 0) {
        throw new Error(
          !agentId
            ? 'Cannot validate runtime Skills without an Agent identity.'
            : 'Cannot refresh runtime Skills while Skills are disabled.'
        )
      }
      return []
    }

    try {
      const validatedSkillNames = normalizeStringList(
        await this.dependencies.skillService.validateSkillNames(agentId, normalizedSkillNames)
      )
      if (
        failClosed &&
        (validatedSkillNames.length !== normalizedSkillNames.length ||
          validatedSkillNames.some((name, index) => name !== normalizedSkillNames[index]))
      ) {
        throw new Error('Runtime Skill validation did not preserve the requested Skill set.')
      }
      return validatedSkillNames
    } catch (error) {
      console.warn(`[DeepChatAgent] Failed to validate active skills for Agent ${agentId}:`, error)
      if (failClosed) throw error
      return []
    }
  }

  normalizeNullablePolicyList(value?: string[] | null): string[] | null | undefined {
    if (value === null || value === undefined) {
      return value
    }
    return normalizeStringList(value)
  }

  getDisabledAgentTools(sessionId: string): string[] {
    const sessions = this.dependencies.sqlitePresenter.newSessionsTable
    const sessionRow = sessions.get(sessionId)
    const parentSessionId =
      sessionRow?.session_kind === 'subagent' ? sessionRow.parent_session_id?.trim() : null
    return composeSubagentAuthority(
      { disabledAgentTools: sessions.getDisabledAgentTools(sessionId) },
      {
        disabledAgentTools: parentSessionId
          ? sessions.getDisabledAgentTools(parentSessionId)
          : undefined
      }
    ).disabledAgentTools
  }
}
