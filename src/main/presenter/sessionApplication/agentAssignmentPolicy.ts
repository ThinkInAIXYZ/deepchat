import { resolveAcpAgentAlias } from '@shared/utils/acpAgentAlias'
import type {
  DeepChatAgentConfig,
  PermissionMode,
  SessionGenerationSettings
} from '@shared/types/agent-interface'
import type {
  CreateAssignmentInput,
  ResolvedSessionAssignment,
  ResolvedSubagentAssignment,
  ResolvedTransferTarget,
  SessionAssignmentCatalogPort,
  SessionAssignmentConfigPort,
  SessionAssignmentPolicyPort,
  SubagentAssignmentInput
} from './ports'
import {
  normalizeActiveSkills,
  normalizeDisabledAgentTools
} from '@/agent/shared/agentSessionNormalization'

const resolveAssignmentPermissionMode = (mode?: PermissionMode | null): PermissionMode =>
  mode ?? 'full_access'

export class SessionAgentAssignmentPolicy implements SessionAssignmentPolicyPort {
  constructor(
    private readonly catalog: SessionAssignmentCatalogPort,
    private readonly config: SessionAssignmentConfigPort
  ) {}

  async resolveCreateAssignment(input: CreateAssignmentInput): Promise<ResolvedSessionAssignment> {
    const descriptor = this.catalog.resolveAgent(input.agentId)
    const agentConfig =
      descriptor.kind === 'deepchat'
        ? await this.config.resolveDeepChatAgentConfig(descriptor.id)
        : null
    const projectDir = this.resolveProjectDir(input, agentConfig?.defaultProjectPath)
    const defaultModel = this.config.getDefaultModel()
    const providerId =
      descriptor.kind === 'acp'
        ? 'acp'
        : (input.providerId ??
          agentConfig?.defaultModelPreset?.providerId ??
          defaultModel?.providerId ??
          '')
    const modelId =
      descriptor.kind === 'acp'
        ? descriptor.id
        : (input.modelId ?? agentConfig?.defaultModelPreset?.modelId ?? defaultModel?.modelId ?? '')

    if (!providerId || !modelId) {
      throw new Error('No provider or model configured. Please set a default model in settings.')
    }
    this.assertAcpSessionHasWorkdir(providerId, projectDir)

    return {
      agentId: descriptor.id,
      agentType: descriptor.kind,
      providerId,
      modelId,
      projectDir,
      permissionMode: resolveAssignmentPermissionMode(
        input.permissionMode ?? agentConfig?.permissionMode
      ),
      generationSettings: this.mergeDefaultGenerationSettings(
        agentConfig,
        input.generationSettings
      ),
      disabledAgentTools:
        descriptor.kind === 'deepchat'
          ? normalizeDisabledAgentTools(input.disabledAgentTools ?? agentConfig?.disabledAgentTools)
          : [],
      subagentEnabled:
        descriptor.kind === 'deepchat'
          ? (input.subagentEnabled ?? agentConfig?.subagentEnabled ?? false)
          : false
    }
  }

  resolveAcpDraftAssignment(
    agentId: string,
    permissionMode?: PermissionMode
  ): { agentId: string; permissionMode: PermissionMode } {
    const descriptor = this.catalog.resolveAgent(agentId)
    if (descriptor.kind !== 'acp') {
      throw new Error(`Agent ${agentId} is not an ACP agent.`)
    }
    return {
      agentId: descriptor.id,
      permissionMode: resolveAssignmentPermissionMode(permissionMode)
    }
  }

  async resolveSubagentAssignment(
    input: SubagentAssignmentInput
  ): Promise<ResolvedSubagentAssignment> {
    let descriptor: { id: string; kind: 'deepchat' | 'acp' }
    try {
      descriptor = this.catalog.resolveAgent(resolveAcpAgentAlias(input.agentId.trim()))
    } catch {
      throw new Error(`Agent ${input.agentId} is not a valid subagent target.`)
    }

    if (descriptor.kind === 'acp') {
      this.assertAcpSessionHasWorkdir('acp', input.projectDir)
      return {
        agentId: descriptor.id,
        targetAgentId: input.targetAgentId?.trim() ? descriptor.id : null,
        providerId: 'acp',
        modelId: descriptor.id,
        permissionMode: resolveAssignmentPermissionMode(input.permissionMode),
        generationSettings: { systemPrompt: '' },
        disabledAgentTools: [],
        activeSkills: []
      }
    }

    this.assertAcpSessionHasWorkdir(input.providerId, input.projectDir)

    const parentAgentId = input.parentAgentId?.trim() || null
    const isCrossAgent = Boolean(parentAgentId && parentAgentId !== descriptor.id)
    const targetAgentId = input.targetAgentId?.trim() ? descriptor.id : null

    if (!isCrossAgent) {
      return {
        agentId: descriptor.id,
        targetAgentId,
        providerId: input.providerId,
        modelId: input.modelId,
        permissionMode: resolveAssignmentPermissionMode(input.permissionMode),
        generationSettings: input.generationSettings,
        disabledAgentTools: normalizeDisabledAgentTools(input.disabledAgentTools),
        activeSkills: normalizeActiveSkills(input.activeSkills)
      }
    }

    // Cross-agent child: keep parent workdir/model, apply target host security policy.
    const agentConfig = await this.config.resolveDeepChatAgentConfig(descriptor.id)
    const parentGeneration = input.generationSettings ?? {}
    const generationSettings = this.mergeDefaultGenerationSettings(agentConfig, {
      ...parentGeneration,
      systemPrompt:
        typeof agentConfig?.systemPrompt === 'string'
          ? agentConfig.systemPrompt
          : parentGeneration.systemPrompt
    })

    return {
      agentId: descriptor.id,
      targetAgentId,
      providerId: input.providerId,
      modelId: input.modelId,
      permissionMode: resolveAssignmentPermissionMode(agentConfig?.permissionMode),
      generationSettings,
      disabledAgentTools: normalizeDisabledAgentTools(agentConfig?.disabledAgentTools),
      activeSkills: this.filterSkillsByAllowList(
        normalizeActiveSkills(input.activeSkills),
        agentConfig?.enabledSkillNames
      )
    }
  }

  async resolveTransferTarget(
    targetAgentId: string,
    currentProjectDir: string | null
  ): Promise<ResolvedTransferTarget> {
    let descriptor: { id: string; kind: 'deepchat' | 'acp' }
    try {
      descriptor = this.catalog.resolveAgent(resolveAcpAgentAlias(targetAgentId.trim()))
    } catch {
      throw new Error(`Target agent not found: ${targetAgentId}`)
    }
    if (descriptor.kind === 'acp') {
      throw new Error('Conversation history cannot be moved to ACP agents.')
    }

    const agentConfig = await this.config.resolveDeepChatAgentConfig(descriptor.id)
    const defaultModel = this.config.getDefaultModel()
    const providerId =
      agentConfig?.defaultModelPreset?.providerId?.trim() || defaultModel?.providerId?.trim() || ''
    const modelId =
      agentConfig?.defaultModelPreset?.modelId?.trim() || defaultModel?.modelId?.trim() || ''
    if (!providerId || !modelId) {
      throw new Error('Target DeepChat agent does not have a default model.')
    }
    if (providerId.toLowerCase() === 'acp') {
      throw new Error('Conversation history cannot be moved to ACP agents.')
    }

    return {
      agentId: descriptor.id,
      providerId,
      modelId,
      projectDir:
        currentProjectDir?.trim() ||
        agentConfig?.defaultProjectPath?.trim() ||
        this.config.getDefaultProjectPath()?.trim() ||
        null,
      permissionMode: resolveAssignmentPermissionMode(agentConfig?.permissionMode),
      generationSettings: this.mergeDefaultGenerationSettings(agentConfig),
      disabledAgentTools: normalizeDisabledAgentTools(agentConfig?.disabledAgentTools),
      subagentEnabled: agentConfig?.subagentEnabled === true
    }
  }

  assertAcpSessionHasWorkdir(providerId: string, projectDir: string | null): void {
    if (providerId === 'acp' && !projectDir?.trim()) {
      throw new Error('ACP agent requires selecting a workdir before sending messages.')
    }
  }

  private resolveProjectDir(
    input: CreateAssignmentInput,
    agentDefaultProjectDir: string | null | undefined
  ): string | null {
    if (input.preserveExplicitNullProjectDir && input.projectDir === null) return null
    return (
      input.projectDir?.trim() ||
      agentDefaultProjectDir?.trim() ||
      this.config.getDefaultProjectPath()?.trim() ||
      null
    )
  }

  private mergeDefaultGenerationSettings(
    config: DeepChatAgentConfig | null,
    overrides?: Partial<SessionGenerationSettings>
  ): Partial<SessionGenerationSettings> | undefined {
    const defaults: Partial<SessionGenerationSettings> = {}
    if (typeof config?.systemPrompt === 'string') defaults.systemPrompt = config.systemPrompt
    const merged = { ...defaults, ...overrides }
    return Object.keys(merged).length > 0 ? merged : undefined
  }

  private filterSkillsByAllowList(skills: string[], allowList?: string[] | null): string[] {
    if (allowList === null || allowList === undefined) {
      return skills
    }
    const allowed = new Set(
      allowList
        .map((skillName) => (typeof skillName === 'string' ? skillName.trim() : ''))
        .filter((skillName) => skillName.length > 0)
    )
    return skills.filter((skillName) => allowed.has(skillName))
  }
}
