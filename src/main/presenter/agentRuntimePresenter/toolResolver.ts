import type { IConfigPresenter, ISkillPresenter } from '@shared/presenter'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import type { DeepChatSessionState } from '@shared/types/agent-interface'
import type { SQLitePresenter } from '../sqlitePresenter'
import type {
  DeepChatAgentInstance,
  DeepChatToolProfileKind
} from '@/agent/deepchat/instance/deepChatAgentInstance'
import type { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type { ToolCatalogPort } from '@/agent/deepchat/loop/ports'
import {
  filterSkillNamesByPolicy,
  normalizeStringList,
  type AgentExtensionPolicy
} from '@/agent/deepchat/resources/systemPromptBuilder'
import { createToolCatalogPort } from './toolAdapters'

type ToolResolverSkillPort = Pick<ISkillPresenter, 'getActiveSkills' | 'setActiveSkills'>

export interface DeepChatToolResolverDependencies {
  configPresenter: IConfigPresenter
  sqlitePresenter: SQLitePresenter
  toolPresenter: IToolPresenter | null
  skillPresenter?: ToolResolverSkillPort
  deepChatRuntime: DeepChatAgentRuntime
  getDeepChatInstance(sessionId: string): DeepChatAgentInstance
  getSessionAgentId(sessionId: string): string | undefined
  getRuntimeState(sessionId: string): DeepChatSessionState | undefined
  assertCurrent(sessionId: string, instance: DeepChatAgentInstance): void
  isAcpBackedSubagentSession(sessionId: string, providerId?: string): boolean
  isStaleInstanceError(error: unknown): boolean
}

export class DeepChatToolResolver {
  constructor(private readonly dependencies: DeepChatToolResolverDependencies) {}

  async loadToolDefinitionsForSession(
    sessionId: string,
    projectDir: string | null,
    activeSkillNamesOverride?: string[],
    providedResourceInstance?: DeepChatAgentInstance
  ): Promise<MCPToolDefinition[]> {
    if (!this.dependencies.toolPresenter) {
      return []
    }

    const resourceInstance =
      providedResourceInstance ?? this.dependencies.getDeepChatInstance(sessionId)
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
      toolPresenter: this.dependencies.toolPresenter,
      resolveContext: async (activeSkillNamesOverride) => {
        this.dependencies.assertCurrent(sessionId, resourceInstance)
        const agentId =
          resourceInstance.getAgentId()?.trim() ||
          this.dependencies.getSessionAgentId(sessionId) ||
          'deepchat'
        const policy = await this.resolveAgentExtensionPolicy(sessionId, resourceInstance)
        const effectiveActiveSkillNames =
          activeSkillNamesOverride === undefined
            ? await this.resolveActiveSkillNamesForToolProfile(sessionId, resourceInstance)
            : filterSkillNamesByPolicy(activeSkillNamesOverride, policy)
        const profile = await this.resolveToolProfile(
          sessionId,
          projectDir,
          effectiveActiveSkillNames,
          policy,
          resourceInstance
        )
        this.dependencies.assertCurrent(sessionId, resourceInstance)
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
            ...(enabledMcpServerIds === undefined ? {} : { enabledMcpServerIds })
          }
        }
      },
      commitCache: (entry) => {
        this.dependencies.assertCurrent(sessionId, resourceInstance)
        resourceInstance.setToolProfileCache(entry)
      }
    })

    return {
      resolve: async (request) => {
        if (!this.dependencies.toolPresenter) {
          return []
        }

        this.dependencies.assertCurrent(sessionId, resourceInstance)
        const providerId = resourceInstance.getRuntimeState()?.providerId?.trim()
        if (this.dependencies.isAcpBackedSubagentSession(sessionId, providerId)) {
          return []
        }

        try {
          return await catalog.resolve(request)
        } catch (error) {
          if (this.dependencies.isStaleInstanceError(error)) throw error
          console.error('[DeepChatAgent] failed to fetch tool definitions:', error)
          return []
        }
      }
    }
  }

  private async resolveToolProfile(
    sessionId: string,
    projectDir: string | null,
    activeSkillNamesOverride?: string[],
    extensionPolicy?: AgentExtensionPolicy,
    resourceInstance?: DeepChatAgentInstance
  ): Promise<{ kind: DeepChatToolProfileKind; fingerprint: string }> {
    const normalizedProjectDir = projectDir?.trim() || null
    const skillsEnabled = this.dependencies.configPresenter.getSkillsEnabled()
    const policy =
      extensionPolicy ?? (await this.resolveAgentExtensionPolicy(sessionId, resourceInstance))
    const activeSkillNames = filterSkillNamesByPolicy(
      activeSkillNamesOverride ??
        (await this.resolveActiveSkillNamesForToolProfile(sessionId, resourceInstance)),
      policy
    )
    const disabledAgentTools = this.getDisabledAgentTools(sessionId)
    const state =
      resourceInstance?.getRuntimeState() ?? this.dependencies.getRuntimeState(sessionId)
    const agentId =
      resourceInstance?.getAgentId()?.trim() ||
      this.dependencies.getSessionAgentId(sessionId) ||
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
        toolRegistryRevision: this.dependencies.deepChatRuntime.getToolRegistryRevision(),
        disabledAgentTools: [...disabledAgentTools].sort((left, right) =>
          left.localeCompare(right)
        ),
        enabledSkillNames: this.normalizeNullablePolicyList(policy.enabledSkillNames),
        enabledMcpServerIds: this.normalizeNullablePolicyList(policy.enabledMcpServerIds),
        skillsEnabled,
        activeSkillNames
      })
    }
  }

  async resolveActiveSkillNamesForToolProfile(
    sessionId: string,
    resourceInstance?: DeepChatAgentInstance
  ): Promise<string[]> {
    if (
      !this.dependencies.configPresenter.getSkillsEnabled() ||
      !this.dependencies.skillPresenter?.getActiveSkills
    ) {
      return []
    }

    try {
      const policy = await this.resolveAgentExtensionPolicy(sessionId, resourceInstance)
      return filterSkillNamesByPolicy(
        normalizeStringList(await this.dependencies.skillPresenter.getActiveSkills(sessionId)),
        policy
      )
    } catch (error) {
      console.warn(
        `[DeepChatAgent] Failed to load active skills for tool profile in session ${sessionId}:`,
        error
      )
      return []
    }
  }

  async resolveAgentExtensionPolicy(
    sessionId: string,
    resourceInstance?: DeepChatAgentInstance
  ): Promise<AgentExtensionPolicy> {
    const agentId =
      resourceInstance?.getAgentId()?.trim() ||
      this.dependencies.getSessionAgentId(sessionId) ||
      'deepchat'
    if (typeof this.dependencies.configPresenter.resolveDeepChatAgentConfig !== 'function') {
      return {}
    }

    try {
      const config = await this.dependencies.configPresenter.resolveDeepChatAgentConfig(agentId)
      return {
        enabledSkillNames: config.enabledSkillNames,
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

  async refilterActiveSkillsForAgentPolicy(
    sessionId: string,
    agentId: string,
    resourceInstance?: DeepChatAgentInstance
  ): Promise<void> {
    if (
      !this.dependencies.skillPresenter?.getActiveSkills ||
      !this.dependencies.skillPresenter?.setActiveSkills
    ) {
      return
    }
    try {
      // Prefer explicit target agent config so rebind does not depend on session row timing.
      const targetConfig =
        typeof this.dependencies.configPresenter.resolveDeepChatAgentConfig === 'function'
          ? await this.dependencies.configPresenter.resolveDeepChatAgentConfig(agentId)
          : null
      const policy: AgentExtensionPolicy = targetConfig
        ? {
            enabledSkillNames: targetConfig.enabledSkillNames,
            enabledMcpServerIds: targetConfig.enabledMcpServerIds
          }
        : await this.resolveAgentExtensionPolicy(sessionId, resourceInstance)
      const current = await this.dependencies.skillPresenter.getActiveSkills(sessionId)
      const allowed = filterSkillNamesByPolicy(current, policy)
      await this.dependencies.skillPresenter.setActiveSkills(sessionId, allowed)
    } catch (error) {
      console.warn(
        `[DeepChatAgent] Failed to refilter active skills after agent rebind for session ${sessionId}:`,
        error
      )
    }
  }

  normalizeNullablePolicyList(value?: string[] | null): string[] | null | undefined {
    if (value === null || value === undefined) {
      return value
    }
    return normalizeStringList(value)
  }

  getDisabledAgentTools(sessionId: string): string[] {
    return (
      this.dependencies.sqlitePresenter.newSessionsTable?.getDisabledAgentTools(sessionId) ?? []
    )
  }
}
