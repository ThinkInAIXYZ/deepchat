import type { SkillServicePort } from '@shared/types/skill'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { ToolServicePort } from '@shared/types/tool'
import type {
  AgentType,
  DeepChatAgentConfig,
  DeepChatSubagentCapability
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
  normalizeSessionOrchestrationMode,
  type SessionOrchestrationMode
} from '@shared/workflow/orchestrationMode'

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

export class DeepChatToolResolver {
  constructor(private readonly dependencies: DeepChatToolResolverDependencies) {}

  private assertCurrent(sessionId: string, instance: DeepChatAgentInstance): void {
    this.dependencies.registry.scopeFor(toAppSessionId(sessionId), instance).assertCurrent()
  }

  async loadToolDefinitionsForSession(
    sessionId: string,
    projectDir: string | null,
    activeSkillNamesOverride?: string[],
    providedResourceInstance?: DeepChatAgentInstance
  ): Promise<MCPToolDefinition[]> {
    const resourceInstance =
      providedResourceInstance ??
      this.dependencies.registry.getOrHydrateScope(toAppSessionId(sessionId)).instance
    const catalog = this.createSessionToolCatalogPort(sessionId, projectDir, resourceInstance)
    return await catalog.resolve(
      activeSkillNamesOverride === undefined
        ? undefined
        : { activeSkillNames: activeSkillNamesOverride }
    )
  }

  createSessionToolCatalogPort(
    sessionId: string,
    projectDir: string | null,
    resourceInstance: DeepChatAgentInstance
  ): ToolCatalogPort {
    const catalog = createToolCatalogPort<DeepChatToolProfileKind>({
      toolService: this.dependencies.toolService,
      resolveContext: async (activeSkillNamesOverride) => {
        this.assertCurrent(sessionId, resourceInstance)
        const scopedAgentId =
          resourceInstance.getAgentId()?.trim() ||
          this.dependencies.identity.getAgentId(sessionId)?.trim() ||
          null
        const agentId = scopedAgentId ?? 'deepchat'
        const toolPolicy = await this.resolveAgentToolPolicy(sessionId, resourceInstance)
        const orchestrationMode = toolPolicy.orchestrationMode
        const policy = toolPolicy.extensionPolicy
        const effectiveActiveSkillNames =
          activeSkillNamesOverride === undefined
            ? await this.resolveActiveSkillNamesForToolProfile(sessionId)
            : await this.validateSkillNamesForAgent(scopedAgentId, activeSkillNamesOverride)
        const profile = this.resolveToolProfile(
          sessionId,
          projectDir,
          effectiveActiveSkillNames,
          policy,
          toolPolicy.subagentCapability,
          orchestrationMode,
          resourceInstance
        )
        this.assertCurrent(sessionId, resourceInstance)
        const enabledMcpServerIds = this.toToolDefinitionMcpServerIds(policy.enabledMcpServerIds)

        return {
          profile: profile.kind,
          fingerprint: profile.fingerprint,
          cached: resourceInstance.getToolProfileCache(),
          context: {
            agentId,
            disabledAgentTools: this.getDisabledAgentTools(sessionId),
            chatMode: 'agent',
            conversationId: sessionId,
            agentWorkspacePath: projectDir,
            activeSkillNames: effectiveActiveSkillNames,
            subagentCapability: toolPolicy.subagentCapability,
            orchestrationMode,
            ...(enabledMcpServerIds === undefined ? {} : { enabledMcpServerIds })
          }
        }
      },
      commitCache: (entry) => {
        this.assertCurrent(sessionId, resourceInstance)
        resourceInstance.setToolProfileCache(entry)
      }
    })

    return {
      resolve: async (request) => {
        this.assertCurrent(sessionId, resourceInstance)
        const providerId = resourceInstance.getRuntimeState()?.providerId?.trim()
        if (this.dependencies.identity.isAcpBackedSubagentSession(sessionId, providerId)) {
          return []
        }

        try {
          return await catalog.resolve(request)
        } catch (error) {
          if (isStaleDeepChatInstanceError(error)) throw error
          console.error('[DeepChatAgent] failed to fetch tool definitions:', error)
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
    subagentCapability: DeepChatSubagentCapability,
    orchestrationMode: SessionOrchestrationMode,
    resourceInstance?: DeepChatAgentInstance
  ): { kind: DeepChatToolProfileKind; fingerprint: string } {
    const normalizedProjectDir = projectDir?.trim() || null
    const skillsEnabled = this.dependencies.skillSettings.isEnabled()
    const activeSkillNames = normalizeStringList(activeSkillNamesOverride)
    const disabledAgentTools = this.getDisabledAgentTools(sessionId)
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
        subagentCapability: subagentCapability.cacheKey,
        orchestrationMode
      })
    }
  }

  async resolveActiveSkillNamesForToolProfile(
    sessionId: string
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
      return []
    }
  }

  private async resolveAgentToolPolicy(
    sessionId: string,
    resourceInstance?: DeepChatAgentInstance
  ): Promise<{
    extensionPolicy: AgentExtensionPolicy
    subagentCapability: DeepChatSubagentCapability
    orchestrationMode: SessionOrchestrationMode
  }> {
    const agentId =
      resourceInstance?.getAgentId()?.trim() ||
      this.dependencies.identity.getAgentId(sessionId) ||
      'deepchat'
    const sessionRow = this.dependencies.sqlitePresenter.newSessionsTable?.get?.(sessionId)
    const orchestrationMode = normalizeSessionOrchestrationMode(sessionRow?.orchestration_mode)
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
    }
    if (configResult.status === 'rejected') {
      console.warn(
        `[DeepChatAgent] Failed to resolve tool policy for agent ${agentId}:`,
        configResult.reason
      )
      return {
        extensionPolicy: {},
        subagentCapability: resolveCapability(agentType, null),
        orchestrationMode
      }
    }

    const config = configResult.value
    return {
      extensionPolicy: config
        ? {
            enabledMcpServerIds: config.enabledMcpServerIds
          }
        : {},
      subagentCapability: resolveCapability(agentType, config),
      orchestrationMode
    }
  }

  async resolveAgentExtensionPolicy(
    sessionId: string,
    resourceInstance?: DeepChatAgentInstance
  ): Promise<AgentExtensionPolicy> {
    const agentId =
      resourceInstance?.getAgentId()?.trim() ||
      this.dependencies.identity.getAgentId(sessionId) ||
      'deepchat'
    try {
      const config = await this.dependencies.agentSettings.resolveDeepChatAgentConfig(agentId)
      return {
        enabledMcpServerIds: config.enabledMcpServerIds
      }
    } catch (error) {
      console.warn(
        `[DeepChatAgent] Failed to resolve extension policy for agent ${agentId}:`,
        error
      )
      return {}
    }
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
    skillNames: string[]
  ): Promise<string[]> {
    if (!agentId || !this.dependencies.skillSettings.isEnabled()) return []

    try {
      return await this.dependencies.skillService.validateSkillNames(
        agentId,
        normalizeStringList(skillNames)
      )
    } catch (error) {
      console.warn(`[DeepChatAgent] Failed to validate active skills for Agent ${agentId}:`, error)
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
    return this.dependencies.sqlitePresenter.newSessionsTable.getDisabledAgentTools(sessionId)
  }
}
