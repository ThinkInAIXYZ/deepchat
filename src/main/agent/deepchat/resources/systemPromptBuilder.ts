import type { ProviderModelResolutionPort } from '@/provider/settings'
import fs from 'fs'
import path from 'path'
import type {
  DeepChatPromptAssembly,
  DeepChatPromptAssemblySection,
  DeepChatPromptDegradationCode
} from '@shared/types/prompt-assembly'
import type { SkillServicePort } from '@shared/types/skill'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { ToolServicePort } from '@shared/types/tool'
import type { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import type { ProviderCatalogPort } from '@/provider/ports'
import {
  buildRuntimeCapabilitiesPrompt,
  buildSystemEnvPromptAssembly
} from './systemEnvPromptBuilder'
import { assemblePromptSections, createPromptAssemblySection } from './promptAssembly'
import type { SkillSettingsPort } from '@/skill/settings'
import { ResolvedCommandShellSchema, type ResolvedCommandShell } from '@shared/commandShell'
import { LIVE_DELEGATION_AGENT_TOOL_NAME } from '@shared/agentTools'
import { UNTRUSTED_CHILD_OUTPUT_POLICY } from '@shared/orchestration/resultSafety'
import {
  normalizeOrchestrationPolicy,
  type OrchestrationPolicy
} from '@shared/orchestration/policy'
import {
  projectSkillRoutingCards,
  renderSkillRoutingCatalog,
  type SkillRoutingCatalogProjection
} from '@/skill/routingCatalog'

export type AgentExtensionPolicy = {
  enabledMcpServerIds?: string[] | null
}

type SystemPromptSkillPort = Pick<
  SkillServicePort,
  'getMetadataList' | 'getActiveSkills' | 'resolveSessionAgentId'
>
type ToolPromptPort = Pick<ToolServicePort, 'buildToolSystemPrompt'>

export interface SystemPromptBuilderDependencies {
  providerSettings: ProviderModelResolutionPort
  skillSettings: SkillSettingsPort
  skillService: SystemPromptSkillPort
  providerCatalogPort: Pick<ProviderCatalogPort, 'getProviderModels' | 'getCustomModels'>
  toolService: ToolPromptPort
  assertCurrent(sessionId: string, instance: DeepChatAgentInstance): void
  isAcpBackedSubagentSession(sessionId: string, providerId?: string): boolean
  resolveProjectDir(
    sessionId: string,
    projectDir: string | null | undefined,
    instance: DeepChatAgentInstance
  ): string | null
  logSlowStep(sessionId: string, step: string, startedAt: number): void
}

export interface SystemPromptBuildInput {
  sessionId: string
  basePrompt: string
  toolDefinitions: MCPToolDefinition[]
  activeSkillNamesOverride?: string[]
  sessionActiveSkillNamesOverride?: string[]
  sessionSkillBodiesOverride?: readonly Readonly<{ name: string; content: string }>[]
  contextLength?: number
  orchestrationPolicy?: OrchestrationPolicy
  resourceInstance: DeepChatAgentInstance
  commandShell: ResolvedCommandShell
}

type PackageJsonManifest = {
  name?: unknown
  scripts?: Record<string, unknown>
}

function readPackageJsonManifest(workdir: string): PackageJsonManifest | null {
  try {
    const packageJsonPath = path.join(workdir, 'package.json')
    if (!fs.existsSync(packageJsonPath)) {
      return null
    }

    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }

    return parsed as PackageJsonManifest
  } catch {
    return null
  }
}

function getVerificationScriptNames(manifest: PackageJsonManifest | null): string[] {
  const scripts = manifest?.scripts
  if (!scripts || typeof scripts !== 'object') {
    return []
  }

  return Object.entries(scripts)
    .filter(
      ([name, value]) => typeof name === 'string' && typeof value === 'string' && value.trim()
    )
    .map(([name]) => name)
}

export async function buildSystemPromptAssemblyWithSkills(
  dependencies: SystemPromptBuilderDependencies,
  input: SystemPromptBuildInput
): Promise<DeepChatPromptAssembly> {
  const {
    sessionId,
    basePrompt,
    toolDefinitions,
    activeSkillNamesOverride,
    sessionActiveSkillNamesOverride,
    resourceInstance
  } = input
  const commandShell = ResolvedCommandShellSchema.parse(input.commandShell)
  dependencies.assertCurrent(sessionId, resourceInstance)
  const normalizedBase = basePrompt?.trim() ?? ''
  const state = resourceInstance.getRuntimeState()
  const providerId = state?.providerId?.trim() || 'unknown-provider'
  const modelId = state?.modelId?.trim() || 'unknown-model'
  if (dependencies.isAcpBackedSubagentSession(sessionId, providerId)) {
    return assemblePromptSections([
      createPromptAssemblySection({
        kind: 'configured_prompt',
        sourceRef: 'session:generation-settings.system-prompt',
        content: normalizedBase
      })
    ])
  }

  const workdir = resourceInstance.hasProjectDir()
    ? resourceInstance.getProjectDir()
    : dependencies.resolveProjectDir(sessionId, undefined, resourceInstance)
  const now = new Date()

  const skillsEnabled = dependencies.skillSettings.isEnabled()
  const skillService = dependencies.skillService
  const skillsMetadataDegradations: DeepChatPromptDegradationCode[] = []
  const pinnedSkillsDegradations: DeepChatPromptDegradationCode[] = []
  let sessionAgentId: string | null = null
  if (skillsEnabled) {
    try {
      sessionAgentId = await skillService.resolveSessionAgentId(sessionId)
    } catch (error) {
      console.warn(
        `[DeepChatAgent] Failed to resolve agent id for skills in session ${sessionId}:`,
        error
      )
    }
    if (!sessionAgentId) {
      skillsMetadataDegradations.push('skill_agent_unavailable')
      pinnedSkillsDegradations.push('skill_agent_unavailable')
    }
  }
  const availableSkills: Array<{
    name: string
    description: string
    category?: string | null
    platforms?: string[]
  }> = []
  let skillMetadataLookupFailed = false
  const activeSkillNames: string[] = activeSkillNamesOverride ? [...activeSkillNamesOverride] : []
  const sessionActiveSkillNames: string[] = sessionActiveSkillNamesOverride
    ? [...sessionActiveSkillNamesOverride]
    : []
  const skillDraftSuggestionsEnabled = dependencies.skillSettings.isDraftSuggestionsEnabled()

  if (skillsEnabled) {
    const metadataStartedAt = Date.now()
    try {
      const metadataList = sessionAgentId ? await skillService.getMetadataList(sessionAgentId) : []
      for (const metadata of metadataList) {
        const skillName = metadata?.name?.trim()
        if (skillName) {
          availableSkills.push({
            name: skillName,
            description: metadata.description?.trim() || '',
            category: metadata.category ?? null,
            platforms: metadata.platforms
          })
        }
      }
    } catch (error) {
      console.warn(
        `[DeepChatAgent] Failed to load skills metadata for session ${sessionId}:`,
        error
      )
      skillMetadataLookupFailed = true
      skillsMetadataDegradations.push('skill_metadata_unavailable')
    }
    dependencies.logSlowStep(sessionId, 'system-prompt.skills-metadata-load', metadataStartedAt)

    if (!sessionActiveSkillNamesOverride && !activeSkillNamesOverride) {
      const activeSkillsStartedAt = Date.now()
      try {
        const activeSkills = await skillService.getActiveSkills(sessionId)
        for (const skillName of activeSkills) {
          const normalizedName = skillName?.trim()
          if (normalizedName) {
            activeSkillNames.push(normalizedName)
            sessionActiveSkillNames.push(normalizedName)
          }
        }
      } catch (error) {
        console.warn(
          `[DeepChatAgent] Failed to load active skills for session ${sessionId}:`,
          error
        )
        pinnedSkillsDegradations.push('active_skills_unavailable')
      }
      dependencies.logSlowStep(sessionId, 'system-prompt.active-skills-load', activeSkillsStartedAt)
    }
  }

  let stepStartedAt = Date.now()
  const normalizedAvailableSkills = normalizeSkillMetadata(availableSkills)
  const availableSkillNames = new Set(normalizedAvailableSkills.map((skill) => skill.name))
  const requestedActiveSkills = normalizeStringList([
    ...activeSkillNames,
    ...sessionActiveSkillNames
  ])
  const normalizedSessionActiveSkills = normalizeStringList(sessionActiveSkillNames).filter(
    (skillName) => skillMetadataLookupFailed || availableSkillNames.has(skillName)
  )
  const normalizedActiveSkills = skillMetadataLookupFailed
    ? requestedActiveSkills
    : requestedActiveSkills.filter((skillName) => availableSkillNames.has(skillName))
  if (
    !skillMetadataLookupFailed &&
    activeSkillNamesOverride === undefined &&
    normalizedActiveSkills.length !== requestedActiveSkills.length
  ) {
    pinnedSkillsDegradations.push('pinned_skill_unavailable')
  }
  const agentToolNames = getAgentToolNames(toolDefinitions)
  const skillCapabilities = {
    canListSkills: agentToolNames.has('skill_list'),
    canViewSkills: agentToolNames.has('skill_view'),
    canManageDraftSkills: agentToolNames.has('skill_manage'),
    canRunSkillScripts: agentToolNames.has('skill_run')
  }
  const runtimePrompt = buildRuntimeCapabilitiesPrompt({
    hasYoBrowser: toolDefinitions.some(
      (tool) => tool.source === 'agent' && tool.server.name === 'yobrowser'
    ),
    hasExec: agentToolNames.has('exec'),
    hasProcess: agentToolNames.has('process')
  })
  const skillCatalogProjection = skillsEnabled
    ? renderSkillRoutingCatalog(
        projectSkillRoutingCards(normalizedAvailableSkills, normalizedSessionActiveSkills),
        input.contextLength
      )
    : null
  if (
    skillCatalogProjection?.report.mode === 'summary' ||
    skillCatalogProjection?.report.mode === 'name_only'
  ) {
    skillsMetadataDegradations.push('skill_catalog_shortened')
  }
  if (
    skillCatalogProjection?.report.mode === 'omitted' ||
    (skillCatalogProjection?.report.mode === 'absent' &&
      skillCatalogProjection.report.omittedNames.length > 0)
  ) {
    skillsMetadataDegradations.push('skill_catalog_omitted')
  }
  const skillsMetadataPrompt = skillsEnabled
    ? buildSkillsMetadataPrompt(
        skillCatalogProjection,
        skillCapabilities,
        skillDraftSuggestionsEnabled
      )
    : ''

  let skillsPrompt = ''
  if (skillsEnabled && input.sessionSkillBodiesOverride !== undefined) {
    const overrideNames = input.sessionSkillBodiesOverride.map((skill) => skill.name)
    if (
      new Set(overrideNames).size !== overrideNames.length ||
      overrideNames.some((name) => !normalizedSessionActiveSkills.includes(name)) ||
      normalizedSessionActiveSkills.some((name) => !overrideNames.includes(name))
    ) {
      throw new Error('Session Skill body projection does not match the active Skill set.')
    }
    skillsPrompt = renderSessionActiveSkillsContext(input.sessionSkillBodiesOverride)
  }

  let envSections: readonly DeepChatPromptAssemblySection[] = []
  try {
    stepStartedAt = Date.now()
    envSections = (
      await buildSystemEnvPromptAssembly({
        providerId,
        modelId,
        workdir,
        now,
        commandShell,
        modelLookup: dependencies.providerCatalogPort
      })
    ).sections
    dependencies.logSlowStep(sessionId, 'system-prompt.env-prompt', stepStartedAt)
  } catch (error) {
    console.warn(`[DeepChatAgent] Failed to build env prompt for session ${sessionId}:`, error)
    envSections = [
      createPromptAssemblySection({
        kind: 'system_environment',
        sourceRef: 'runtime:environment',
        content: '',
        degradationCodes: ['environment_build_failed']
      }),
      createPromptAssemblySection({
        kind: 'agents_instructions',
        sourceRef: 'workspace:AGENTS.md',
        content: '',
        degradationCodes: ['environment_build_failed']
      })
    ]
  }

  let toolingPrompt = ''
  const toolingDegradations: DeepChatPromptDegradationCode[] = []
  try {
    stepStartedAt = Date.now()
    toolingPrompt = dependencies.toolService.buildToolSystemPrompt({
      conversationId: sessionId,
      toolDefinitions
    })
    dependencies.logSlowStep(sessionId, 'system-prompt.tooling-prompt', stepStartedAt)
  } catch (error) {
    console.warn(`[DeepChatAgent] Failed to build tooling prompt for session ${sessionId}:`, error)
    toolingDegradations.push('tooling_build_failed')
  }

  stepStartedAt = Date.now()
  const assembly = assemblePromptSections([
    createPromptAssemblySection({
      kind: 'configured_prompt',
      sourceRef: 'session:generation-settings.system-prompt',
      content: normalizedBase
    }),
    createPromptAssemblySection({
      kind: 'runtime_capabilities',
      sourceRef: 'runtime:tool-capabilities',
      content: runtimePrompt
    }),
    ...envSections,
    createPromptAssemblySection({
      kind: 'skills_metadata',
      sourceRef: 'skills:catalog',
      content: skillsMetadataPrompt,
      degradationCodes: skillsMetadataDegradations
    }),
    createPromptAssemblySection({
      kind: 'pinned_skills',
      sourceRef: 'skills:active',
      content: skillsPrompt,
      degradationCodes: pinnedSkillsDegradations
    }),
    createPromptAssemblySection({
      kind: 'tooling',
      sourceRef: 'runtime:tool-system-prompt',
      content: toolingPrompt,
      degradationCodes: toolingDegradations
    }),
    createPromptAssemblySection({
      kind: 'orchestration_policy',
      sourceRef: 'session:orchestration-policy',
      content: buildOrchestrationPolicyPrompt(input.orchestrationPolicy, agentToolNames)
    }),
    createPromptAssemblySection({
      kind: 'permission_rules',
      sourceRef: 'runtime:tool-execution-policy',
      content: buildPermissionRulesPrompt(agentToolNames)
    }),
    createPromptAssemblySection({
      kind: 'verification_policy',
      sourceRef: 'runtime:workspace-verification-policy',
      content: buildVerificationPolicyPrompt(workdir)
    })
  ])
  dependencies.logSlowStep(sessionId, 'system-prompt.compose', stepStartedAt)

  dependencies.assertCurrent(sessionId, resourceInstance)
  return assembly
}

export async function buildSystemPromptWithSkills(
  dependencies: SystemPromptBuilderDependencies,
  input: SystemPromptBuildInput
): Promise<string> {
  return (await buildSystemPromptAssemblyWithSkills(dependencies, input)).prompt
}

function buildOrchestrationPolicyPrompt(
  policy: OrchestrationPolicy | undefined,
  agentToolNames: Set<string>
): string {
  const hasSubagents = agentToolNames.has(LIVE_DELEGATION_AGENT_TOOL_NAME)
  if (!hasSubagents) {
    return ''
  }

  const normalizedPolicy = normalizeOrchestrationPolicy(policy)
  const lines = [
    '## Multi-Agent Orchestration Policy',
    normalizedPolicy === 'proactive'
      ? 'The user enabled proactive multi-Agent collaboration for this session.'
      : 'The session uses explicit multi-Agent collaboration. This revokes any earlier instruction to delegate proactively.',
    'Do the work directly when it is simple, tightly sequential, or cheaper than coordination.'
  ]
  if (normalizedPolicy === 'explicit') {
    lines.push(
      'Use Subagents only when the user, an active Skill, or project instructions explicitly request multi-Agent orchestration.'
    )
  } else {
    lines.push(
      'Delegate only when independent context, isolation, parallelism, or durable recovery provides clear value. Never delegate merely to demonstrate that proactive collaboration is enabled.'
    )
  }
  lines.push(
    `Use \`${LIVE_DELEGATION_AGENT_TOOL_NAME}\` for bounded child tasks. Use \`spawn\` to start work, \`send\` for non-triggering context, and \`follow_up\` only to start another child turn.`,
    UNTRUSTED_CHILD_OUTPUT_POLICY
  )
  lines.push(
    'Do not run overlapping write-heavy children in the same workspace. Account for every spawned child until it reaches a terminal state.'
  )
  return lines.join('\n')
}

function buildPermissionRulesPrompt(agentToolNames: Set<string>): string {
  const readOnlyTools = ['read'].filter((toolName) => agentToolNames.has(toolName))
  const serializedTools = ['write', 'edit', 'exec', 'process'].filter((toolName) =>
    agentToolNames.has(toolName)
  )

  if (readOnlyTools.length === 0 && serializedTools.length === 0) {
    return ''
  }

  const lines = ['## Permission Rules']
  if (readOnlyTools.length > 0) {
    lines.push(
      `Read-only Agent tools may be batched in parallel when useful: ${readOnlyTools
        .map((toolName) => `\`${toolName}\``)
        .join(', ')}.`
    )
  }
  if (serializedTools.length > 0) {
    lines.push(
      `Mutating and runtime tools stay serialized or permission-gated: ${serializedTools
        .map((toolName) => `\`${toolName}\``)
        .join(', ')}.`
    )
  }
  lines.push('Do not assume approval for file writes or commands when the session asks for it.')

  return lines.join('\n')
}

function buildVerificationPolicyPrompt(workdir: string | null): string {
  const lines = [
    '## Verification Policy',
    'After changing code, configuration, tests, docs that affect behavior, or generated assets, check verification status before the final response.',
    'If verification was not run, state the reason explicitly in the final response.'
  ]

  const normalizedWorkdir = workdir?.trim()
  if (!normalizedWorkdir) {
    return lines.join('\n')
  }

  const manifest = readPackageJsonManifest(normalizedWorkdir)
  const verificationScripts = getVerificationScriptNames(manifest)
  const isDeepChatWorkspace =
    String(manifest?.name ?? '').toLowerCase() === 'deepchat' ||
    ['format', 'i18n', 'lint'].every((scriptName) => verificationScripts.includes(scriptName))

  if (isDeepChatWorkspace) {
    lines.push(
      'In the DeepChat repository, prioritize `pnpm run format`, `pnpm run i18n`, and `pnpm run lint` after feature work.'
    )
  } else if (verificationScripts.length > 0) {
    const suggestedScripts = verificationScripts
      .slice(0, 4)
      .map((scriptName) => `\`${scriptName}\``)
    lines.push(
      `When relevant, prefer project-local verification scripts such as ${suggestedScripts.join(', ')}.`
    )
  }

  return lines.join('\n')
}

function buildSkillsMetadataPrompt(
  catalogProjection: SkillRoutingCatalogProjection | null,
  capabilities: {
    canListSkills: boolean
    canViewSkills: boolean
    canManageDraftSkills: boolean
    canRunSkillScripts: boolean
  },
  skillDraftSuggestionsEnabled: boolean
): string {
  if (
    !capabilities.canListSkills &&
    !capabilities.canViewSkills &&
    !capabilities.canManageDraftSkills &&
    !capabilities.canRunSkillScripts
  ) {
    return ''
  }

  const lines = ['## Skills']
  let hasContent = false

  if (capabilities.canListSkills || capabilities.canViewSkills) {
    lines.push('Before replying, always scan available skills.')
    hasContent = true
  }
  if (capabilities.canViewSkills) {
    lines.push('If any skill plausibly matches the task, call `skill_view` first.')
    lines.push(
      'Viewing a skill root `SKILL.md` activates that skill for the current message/tool loop; it does not pin the skill to the conversation. Viewing linked skill files is read-only and does not activate the skill.'
    )
  }
  if (capabilities.canListSkills) {
    lines.push(
      'If the catalog is incomplete or no visible card matches, use `skill_list` with a query before concluding that no relevant skill exists.'
    )
    hasContent = true
  }
  if (capabilities.canRunSkillScripts) {
    lines.push(
      'Use `skill_run` only for skills that are active in the current message/tool loop, including manually pinned skills and skills activated by `skill_view`.'
    )
    hasContent = true
  }
  if (capabilities.canManageDraftSkills && skillDraftSuggestionsEnabled) {
    lines.push(
      'After completing a complex task, solving a tricky bug, or discovering a non-trivial workflow, you may draft a reusable skill with `skill_manage`.'
    )
    lines.push(
      'Only propose one draft per task, do it after the main answer is complete, and use `deepchat_question` to ask whether the user wants to keep the draft.'
    )
    lines.push(
      'Do not modify installed skills with `skill_manage`; it is draft-only in this version.'
    )
    hasContent = true
  }

  if (catalogProjection?.content) {
    lines.push(catalogProjection.content)
    hasContent = true
  }

  return hasContent ? lines.join('\n') : ''
}

export function renderSessionSkillBody(skill: Readonly<{ name: string; content: string }>): string {
  if (!skill.name || skill.name !== skill.name.trim() || !skill.content) {
    throw new Error('Session Skill body projection is invalid.')
  }
  return [`### ${skill.name}`, skill.content].join('\n')
}

function buildPinnedSkillsPrompt(skillSections: string[], sessionPersistentOnly = false): string {
  if (skillSections.length === 0) {
    return ''
  }
  return [
    '## Active Skills',
    sessionPersistentOnly
      ? 'These Session Skills are persistent context for this conversation. Follow them when relevant.'
      : 'These skills are active for the current message context. Some may be manually pinned for the conversation; others may have been activated by `skill_view` for this message/tool loop only. Follow them when relevant.',
    '',
    skillSections.join('\n\n')
  ].join('\n')
}

export function renderSessionActiveSkillsContext(
  skills: readonly Readonly<{ name: string; content: string }>[]
): string {
  return buildPinnedSkillsPrompt(skills.map(renderSessionSkillBody), true)
}

export function resolveEffectiveActiveSkillNames(
  sessionActiveSkillNames: string[],
  instance: DeepChatAgentInstance
): string[] {
  return normalizeStringList([...sessionActiveSkillNames, ...instance.getRuntimeActivatedSkills()])
}

export function normalizeStringList(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))
  ).sort((a, b) => a.localeCompare(b))
}

function normalizeSkillMetadata(
  skills: Array<{
    name: string
    description: string
    category?: string | null
    platforms?: string[]
  }>
): Array<{
  name: string
  description: string
  category?: string | null
  platforms?: string[]
}> {
  const deduped = new Map<string, (typeof skills)[number]>()
  for (const skill of skills) {
    const name = skill.name.trim()
    if (!name || deduped.has(name)) {
      continue
    }
    deduped.set(name, {
      ...skill,
      name,
      description: skill.description.trim(),
      category: skill.category?.trim() || null,
      platforms: skill.platforms?.map((platform) => platform.trim()).filter(Boolean)
    })
  }
  return Array.from(deduped.values()).sort((left, right) => {
    return (
      (left.category ?? '').localeCompare(right.category ?? '') ||
      left.name.localeCompare(right.name)
    )
  })
}

function getAgentToolNames(toolDefinitions: MCPToolDefinition[]): Set<string> {
  return new Set(
    toolDefinitions.filter((tool) => tool.source === 'agent').map((tool) => tool.function.name)
  )
}
