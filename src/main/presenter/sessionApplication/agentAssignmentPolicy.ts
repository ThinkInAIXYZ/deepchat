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

const RETIRED_DEFAULT_AGENT_TOOLS = new Set(['find', 'ls'])
const LEGACY_PERSISTED_DISABLED_AGENT_TOOLS = new Set(['find', 'grep', 'ls'])
const LEGACY_AGENT_TOOL_NAME_MAP: Record<string, string> = {
  yo_browser_cdp_send: 'cdp_send',
  yo_browser_window_open: 'load_url',
  yo_browser_window_list: 'get_browser_status'
}

const normalizePermissionMode = (mode: PermissionMode | null | undefined): PermissionMode =>
  mode === 'default' || mode === 'auto_approve' ? mode : 'full_access'

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
      permissionMode:
        input.permissionMode !== undefined
          ? normalizePermissionMode(input.permissionMode)
          : normalizePermissionMode(agentConfig?.permissionMode),
      generationSettings: this.mergeDefaultGenerationSettings(
        agentConfig,
        input.generationSettings
      ),
      disabledAgentTools:
        descriptor.kind === 'deepchat'
          ? this.normalizeDisabledAgentTools(
              input.disabledAgentTools ?? agentConfig?.disabledAgentTools
            )
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
      permissionMode: normalizePermissionMode(permissionMode)
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
        generationSettings: { systemPrompt: '' },
        disabledAgentTools: [],
        activeSkills: []
      }
    }

    this.assertAcpSessionHasWorkdir(input.providerId, input.projectDir)

    return {
      agentId: descriptor.id,
      targetAgentId: input.targetAgentId?.trim() ? descriptor.id : null,
      providerId: input.providerId,
      modelId: input.modelId,
      generationSettings: input.generationSettings,
      disabledAgentTools: this.normalizeDisabledAgentTools(input.disabledAgentTools),
      activeSkills: this.normalizeActiveSkills(input.activeSkills)
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
      permissionMode: normalizePermissionMode(agentConfig?.permissionMode),
      generationSettings: this.mergeDefaultGenerationSettings(agentConfig),
      disabledAgentTools: this.normalizeDisabledAgentTools(agentConfig?.disabledAgentTools),
      subagentEnabled: agentConfig?.subagentEnabled === true
    }
  }

  assertAcpSessionHasWorkdir(providerId: string, projectDir: string | null): void {
    if (providerId === 'acp' && !projectDir?.trim()) {
      throw new Error('ACP agent requires selecting a workdir before sending messages.')
    }
  }

  normalizeDisabledAgentTools(
    disabledAgentTools?: string[],
    options?: { dropLegacySearchTools?: boolean }
  ): string[] {
    if (!Array.isArray(disabledAgentTools)) return []
    const retiredTools = options?.dropLegacySearchTools
      ? LEGACY_PERSISTED_DISABLED_AGENT_TOOLS
      : RETIRED_DEFAULT_AGENT_TOOLS

    return Array.from(
      new Set(
        disabledAgentTools
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .map((item) => LEGACY_AGENT_TOOL_NAME_MAP[item] ?? item)
          .filter((item) => Boolean(item) && !retiredTools.has(item))
      )
    ).sort((left, right) => left.localeCompare(right))
  }

  normalizeActiveSkills(activeSkills?: string[]): string[] {
    if (!Array.isArray(activeSkills)) return []
    return Array.from(
      new Set(
        activeSkills
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
      )
    )
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
}
