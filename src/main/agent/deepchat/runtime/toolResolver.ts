import {
  SKILL_NAME_MAX_LENGTH,
  type SkillMetadataSnapshotPort,
  type SkillServicePort
} from '@shared/types/skill'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { ToolServicePort } from '@shared/types/tool'
import { types as nodeTypes } from 'node:util'
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
import { awaitWithAbort } from '@/lib/awaitWithAbort'
import { resolveDeepChatSubagentCapability } from '@shared/lib/deepchatSubagents'
import {
  normalizeOrchestrationPolicy,
  type OrchestrationPolicy
} from '@shared/orchestration/policy'
import { composeSubagentAuthority } from '@/session/subagentAuthority'
import { normalizeSkillToolName } from '@/skill/toolNameMapping'
import {
  buildExecutionToolCeiling,
  buildExecutionToolTargetKey
} from '@/tape/domain/executionContract'
import { buildCanonicalToolCatalog } from './toolSurface'

type ToolResolverSkillPort = Pick<
  SkillServicePort,
  | 'getActiveSkills'
  | 'snapshotPersistedActiveSkillNames'
  | 'revalidateActiveSkillsForAgent'
  | 'validateSkillNames'
> &
  SkillMetadataSnapshotPort

export const MAX_RUN_TOOL_UNIVERSE_SKILLS = 1_024
export const MAX_RUN_TOOL_UNIVERSE_DEFINITIONS = 1_024
export const MAX_SKILL_TOOL_REQUIREMENTS = 256
export const MAX_RUN_TOOL_REQUIREMENTS = 4_096
export const MAX_RUN_TOOL_REQUIREMENT_NAME_BYTES = 1_024
const MAX_RUN_ACTIVE_SKILL_NAMES = MAX_RUN_TOOL_UNIVERSE_SKILLS
const MAX_RUN_DEGRADATION_COUNT = MAX_RUN_TOOL_REQUIREMENTS
const MAX_UNAVAILABLE_TOOL_DEFINITION_SOURCES = MAX_RUN_TOOL_UNIVERSE_DEFINITIONS
const RUN_SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
const RUN_SKILL_TOOL_REQUIREMENT_ALIASES = new Map<string, string>([
  ['list_directory', 'glob'],
  ['list_files', 'glob'],
  ['search_files', 'grep'],
  ['run_terminal_cmd', 'exec']
])

export type RunToolUniverseDegradationCode =
  | 'active-skill-snapshot-unavailable'
  | 'active-skill-snapshot-invalid'
  | 'active-skill-limit-exceeded'
  | 'skill-catalog-unavailable'
  | 'skill-limit-exceeded'
  | 'skill-metadata-conflict'
  | 'skill-metadata-invalid'
  | 'active-skill-metadata-missing'
  | 'active-skill-metadata-not-admitted'
  | 'requirement-limit-exceeded'
  | 'skill-requirement-invalid'
  | 'skill-requirement-unresolved'
  | 'skill-requirement-ambiguous'
  | 'tool-policy-unavailable'
  | 'definition-limit-exceeded'
  | 'definition-universe-unavailable'

export interface RunSkillToolRequirements {
  readonly skillName: string
  readonly activeAtRunStart: boolean
  readonly activatable: boolean
  readonly requiredStableTargetKeys: readonly string[]
  readonly issueCodes: readonly RunToolUniverseDegradationCode[]
}

export interface RunToolDefinitionUniverse {
  readonly status: 'resolved' | 'degraded' | 'acp-excluded'
  readonly complete: boolean
  readonly mandatoryAdmissionBlocked: boolean
  readonly definitions: readonly MCPToolDefinition[]
  readonly activeSkillNames: readonly string[]
  readonly skillRequirements: readonly RunSkillToolRequirements[]
  readonly degradationCounts: readonly {
    code: RunToolUniverseDegradationCode
    count: number
  }[]
}

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

export function resolveDeepChatToolProfileKind(
  projectDir: string | null | undefined
): DeepChatToolProfileKind {
  return projectDir?.trim() ? 'code' : 'general'
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function createEmptyRunToolDefinitionUniverse(
  status: 'degraded' | 'acp-excluded',
  degradationCode?: RunToolUniverseDegradationCode
): RunToolDefinitionUniverse {
  return freezeRunToolDefinitionUniverse({
    status,
    complete: false,
    mandatoryAdmissionBlocked: false,
    definitions: [],
    activeSkillNames: [],
    skillRequirements: [],
    degradationCounts: degradationCode ? [{ code: degradationCode, count: 1 }] : []
  })
}

function readArrayDataProperty(value: readonly unknown[], index: number): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
  if (!descriptor?.enumerable || !('value' in descriptor)) {
    throw new Error('Expected an enumerable array data property.')
  }
  return descriptor.value
}

function inspectSafeArray(
  value: unknown
):
  | { readonly ok: true; readonly value: readonly unknown[]; readonly length: number }
  | { readonly ok: false } {
  if (
    !value ||
    typeof value !== 'object' ||
    nodeTypes.isProxy(value) ||
    !Array.isArray(value) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return { ok: false }
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (
    !lengthDescriptor ||
    !('value' in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return { ok: false }
  }
  return { ok: true, value, length: lengthDescriptor.value }
}

function normalizeRunActiveSkillNames(
  value: unknown
):
  | { readonly ok: true; readonly names: string[] }
  | { readonly ok: false; readonly code: RunToolUniverseDegradationCode } {
  const inspected = inspectSafeArray(value)
  if (!inspected.ok) {
    return { ok: false, code: 'active-skill-snapshot-invalid' }
  }
  if (inspected.length > MAX_RUN_ACTIVE_SKILL_NAMES) {
    return { ok: false, code: 'active-skill-limit-exceeded' }
  }

  const names = new Set<string>()
  for (let index = 0; index < inspected.length; index += 1) {
    let item: unknown
    try {
      item = readArrayDataProperty(inspected.value, index)
    } catch {
      return { ok: false, code: 'active-skill-snapshot-invalid' }
    }
    if (typeof item !== 'string') {
      return { ok: false, code: 'active-skill-snapshot-invalid' }
    }
    const name = item.trim()
    if (!name || name.length > SKILL_NAME_MAX_LENGTH || !RUN_SKILL_NAME_PATTERN.test(name)) {
      return { ok: false, code: 'active-skill-snapshot-invalid' }
    }
    names.add(name)
  }
  return { ok: true, names: [...names].sort(compareCodePoints) }
}

function normalizeRunSkillToolRequirement(name: string): string {
  const trimmedName = name.trim()
  const runAlias = RUN_SKILL_TOOL_REQUIREMENT_ALIASES.get(trimmedName.toLowerCase())
  if (runAlias) return runAlias
  const normalized = normalizeSkillToolName(trimmedName).canonical
  return typeof normalized === 'string' ? normalized : trimmedName
}

function deepFreezeDetachedValue(value: unknown, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  for (const key of Reflect.ownKeys(value)) {
    deepFreezeDetachedValue(Reflect.get(value, key), seen)
  }
  Object.freeze(value)
}

function detachToolDefinitions(definitions: readonly MCPToolDefinition[]): MCPToolDefinition[] {
  const detached = structuredClone(definitions) as MCPToolDefinition[]
  deepFreezeDetachedValue(detached)
  return detached
}

function freezeRunToolDefinitionUniverse(
  universe: RunToolDefinitionUniverse
): RunToolDefinitionUniverse {
  for (const requirement of universe.skillRequirements) {
    Object.freeze(requirement.requiredStableTargetKeys)
    Object.freeze(requirement.issueCodes)
    Object.freeze(requirement)
  }
  for (const degradation of universe.degradationCounts) Object.freeze(degradation)
  Object.freeze(universe.definitions)
  Object.freeze(universe.activeSkillNames)
  Object.freeze(universe.skillRequirements)
  Object.freeze(universe.degradationCounts)
  return Object.freeze(universe)
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

  async resolveRunToolDefinitionUniverse(
    sessionId: string,
    projectDir: string | null,
    activeSkillNamesOverride?: string[],
    providedResourceInstance?: DeepChatAgentInstance,
    signal?: AbortSignal
  ): Promise<RunToolDefinitionUniverse> {
    signal?.throwIfAborted()
    const resourceInstance =
      providedResourceInstance ??
      this.dependencies.registry.getOrHydrateScope(toAppSessionId(sessionId)).instance
    this.assertCurrent(sessionId, resourceInstance)
    const providerId = resourceInstance.getRuntimeState()?.providerId?.trim()
    if (this.dependencies.identity.isAcpBackedSubagentSession(sessionId, providerId)) {
      return createEmptyRunToolDefinitionUniverse('acp-excluded')
    }

    const scopedAgentId =
      resourceInstance.getAgentId()?.trim() ||
      this.dependencies.identity.getAgentId(sessionId)?.trim() ||
      null
    const agentId = scopedAgentId ?? 'deepchat'
    const skillsEnabled = this.dependencies.skillSettings.isEnabled()
    let activeSkillSnapshot: unknown = skillsEnabled ? (activeSkillNamesOverride ?? []) : []
    if (skillsEnabled && activeSkillNamesOverride === undefined) {
      try {
        activeSkillSnapshot =
          this.dependencies.skillService.snapshotPersistedActiveSkillNames(sessionId)
      } catch {
        return createEmptyRunToolDefinitionUniverse('degraded', 'active-skill-snapshot-unavailable')
      }
    }
    const normalizedActiveSkills = normalizeRunActiveSkillNames(activeSkillSnapshot)
    if (!normalizedActiveSkills.ok) {
      return createEmptyRunToolDefinitionUniverse('degraded', normalizedActiveSkills.code)
    }
    const activeSkillNames = normalizedActiveSkills.names
    const activeSkillSet = new Set(activeSkillNames)
    const degradationCountByCode = new Map<RunToolUniverseDegradationCode, number>()
    const addDegradation = (code: RunToolUniverseDegradationCode, count = 1): void => {
      const boundedCount =
        Number.isSafeInteger(count) && count > 0 ? Math.min(count, MAX_RUN_DEGRADATION_COUNT) : 1
      degradationCountByCode.set(
        code,
        Math.min((degradationCountByCode.get(code) ?? 0) + boundedCount, MAX_RUN_DEGRADATION_COUNT)
      )
    }
    let complete = true
    let metadataCatalogAvailable = true
    let metadataCatalogOverflow = false
    let metadataList: readonly unknown[] = []

    if (skillsEnabled) {
      try {
        const metadataSnapshot = this.dependencies.skillService.snapshotCachedMetadataList(agentId, {
          maxItems: MAX_RUN_TOOL_UNIVERSE_SKILLS
        })
        if (metadataSnapshot.state === 'unavailable') {
          throw new Error('Skill metadata catalog has not been discovered.')
        }
        if (metadataSnapshot.state === 'overflow') {
          complete = false
          metadataCatalogOverflow = true
          addDegradation(
            'skill-limit-exceeded',
            metadataSnapshot.minimumItemCount - MAX_RUN_TOOL_UNIVERSE_SKILLS
          )
          metadataList = []
        } else {
          this.assertCurrent(sessionId, resourceInstance)
          const inspectedMetadata = inspectSafeArray(metadataSnapshot.skills)
          if (!inspectedMetadata.ok) {
            throw new Error('Skill metadata catalog has an invalid shape.')
          }
          metadataList = inspectedMetadata.value
        }
      } catch (error) {
        this.assertCurrent(sessionId, resourceInstance)
        if (isStaleDeepChatInstanceError(error)) throw error
        metadataCatalogAvailable = false
        complete = false
        addDegradation('skill-catalog-unavailable')
      }
    }

    if (metadataList.length > MAX_RUN_TOOL_UNIVERSE_SKILLS) {
      complete = false
      metadataCatalogOverflow = true
      addDegradation('skill-limit-exceeded', metadataList.length - MAX_RUN_TOOL_UNIVERSE_SKILLS)
      metadataList = []
    }

    const metadataByName = new Map<
      string,
      { readonly name: string; readonly declaredRequirements?: readonly unknown[] }
    >()
    const conflictingSkillNames = new Set<string>()
    let invalidSkillMetadataCount = 0
    for (let index = 0; index < metadataList.length; index += 1) {
      let metadata: unknown
      try {
        metadata = readArrayDataProperty(metadataList, index)
      } catch {
        invalidSkillMetadataCount += 1
        continue
      }
      if (
        !metadata ||
        typeof metadata !== 'object' ||
        nodeTypes.isProxy(metadata) ||
        (Object.getPrototypeOf(metadata) !== Object.prototype &&
          Object.getPrototypeOf(metadata) !== null) ||
        Object.getOwnPropertySymbols(metadata).length > 0
      ) {
        invalidSkillMetadataCount += 1
        continue
      }
      const nameDescriptor = Object.getOwnPropertyDescriptor(metadata, 'name')
      const allowedToolsDescriptor = Object.getOwnPropertyDescriptor(metadata, 'allowedTools')
      const rawName =
        nameDescriptor?.enumerable && 'value' in nameDescriptor ? nameDescriptor.value : undefined
      const rawAllowedTools =
        allowedToolsDescriptor === undefined
          ? undefined
          : allowedToolsDescriptor.enumerable && 'value' in allowedToolsDescriptor
            ? allowedToolsDescriptor.value
            : null
      const inspectedAllowedTools =
        rawAllowedTools === undefined ? undefined : inspectSafeArray(rawAllowedTools)
      const skillName = typeof rawName === 'string' ? rawName.trim() : ''
      if (
        !skillName ||
        skillName.length > SKILL_NAME_MAX_LENGTH ||
        !RUN_SKILL_NAME_PATTERN.test(skillName) ||
        (inspectedAllowedTools !== undefined && !inspectedAllowedTools.ok)
      ) {
        invalidSkillMetadataCount += 1
        continue
      }
      if (metadataByName.has(skillName)) {
        conflictingSkillNames.add(skillName)
        continue
      }
      metadataByName.set(skillName, {
        name: skillName,
        ...(inspectedAllowedTools === undefined
          ? {}
          : { declaredRequirements: inspectedAllowedTools.value })
      })
    }
    if (invalidSkillMetadataCount > 0) {
      complete = false
      addDegradation('skill-metadata-invalid', invalidSkillMetadataCount)
    }
    if (conflictingSkillNames.size > 0) {
      complete = false
      addDegradation('skill-metadata-conflict', conflictingSkillNames.size)
    }

    const orderedMetadata = [...metadataByName.values()].sort((left, right) => {
      const activeDelta =
        Number(activeSkillSet.has(right.name)) - Number(activeSkillSet.has(left.name))
      return activeDelta || compareCodePoints(left.name, right.name)
    })
    const selectedMetadataNames = new Set(orderedMetadata.map((metadata) => metadata.name))
    const missingActiveSkillNames = activeSkillNames.filter(
      (skillName) => !selectedMetadataNames.has(skillName)
    )
    if (metadataCatalogAvailable && missingActiveSkillNames.length > 0) {
      complete = false
      addDegradation(
        metadataCatalogOverflow
          ? 'active-skill-metadata-not-admitted'
          : 'active-skill-metadata-missing',
        missingActiveSkillNames.length
      )
    }

    let totalRequirements = 0
    const boundedMetadata = orderedMetadata.map((metadata) => {
      const issueCodes = new Set<RunToolUniverseDegradationCode>()
      const normalizedRequirements: string[] = []
      const seenRequirements = new Set<string>()
      const declaredRequirements = metadata.declaredRequirements ?? []
      if (declaredRequirements.length > MAX_SKILL_TOOL_REQUIREMENTS) {
        issueCodes.add('requirement-limit-exceeded')
      } else {
        for (let index = 0; index < declaredRequirements.length; index += 1) {
          let declaredRequirement: unknown
          try {
            declaredRequirement = readArrayDataProperty(declaredRequirements, index)
          } catch {
            issueCodes.add('skill-requirement-invalid')
            break
          }
          if (
            typeof declaredRequirement !== 'string' ||
            !declaredRequirement.trim() ||
            declaredRequirement.includes('\0') ||
            Buffer.byteLength(declaredRequirement, 'utf8') > MAX_RUN_TOOL_REQUIREMENT_NAME_BYTES
          ) {
            issueCodes.add('skill-requirement-invalid')
            break
          }
          const normalizedRequirement = normalizeRunSkillToolRequirement(declaredRequirement)
          if (
            !normalizedRequirement ||
            Buffer.byteLength(normalizedRequirement, 'utf8') > MAX_RUN_TOOL_REQUIREMENT_NAME_BYTES
          ) {
            issueCodes.add('skill-requirement-invalid')
            break
          }
          if (seenRequirements.has(normalizedRequirement)) continue
          if (totalRequirements + normalizedRequirements.length >= MAX_RUN_TOOL_REQUIREMENTS) {
            issueCodes.add('requirement-limit-exceeded')
            break
          }
          seenRequirements.add(normalizedRequirement)
          normalizedRequirements.push(normalizedRequirement)
        }
      }
      if (issueCodes.size === 0) {
        totalRequirements += normalizedRequirements.length
      }
      return {
        name: metadata.name,
        normalizedRequirements: issueCodes.size === 0 ? normalizedRequirements : [],
        initialIssueCodes: [...issueCodes]
      }
    })

    const universeSkillNames = boundedMetadata.map((metadata) => metadata.name)
    let toolPolicy
    try {
      toolPolicy = await this.resolveAgentToolPolicy(sessionId, resourceInstance, {
        reportDiagnostics: false,
        requireComplete: true,
        signal
      })
      this.assertCurrent(sessionId, resourceInstance)
    } catch (error) {
      signal?.throwIfAborted()
      this.assertCurrent(sessionId, resourceInstance)
      if (isStaleDeepChatInstanceError(error)) throw error
      return createEmptyRunToolDefinitionUniverse('degraded', 'tool-policy-unavailable')
    }
    const enabledMcpServerIds = this.toToolDefinitionMcpServerIds(
      toolPolicy.extensionPolicy.enabledMcpServerIds
    )
    let definitions: MCPToolDefinition[] = []
    let definitionUniverseComplete = false
    let definitionUniverse:
      | Awaited<ReturnType<ToolServicePort['getToolDefinitionUniverse']>>
      | undefined
    try {
      const universeContext = {
        agentId,
        disabledAgentTools: toolPolicy.disabledAgentTools,
        chatMode: 'agent' as const,
        conversationId: sessionId,
        sessionKind: toolPolicy.sessionKind,
        agentWorkspacePath: projectDir,
        activeSkillNames: universeSkillNames,
        subagentCapability: toolPolicy.subagentCapability,
        ...(enabledMcpServerIds === undefined ? {} : { enabledMcpServerIds })
      }
      definitionUniverse = await awaitWithAbort(
        signal
          ? this.dependencies.toolService.getToolDefinitionUniverse(universeContext, { signal })
          : this.dependencies.toolService.getToolDefinitionUniverse(universeContext),
        signal
      )
      this.assertCurrent(sessionId, resourceInstance)
    } catch (error) {
      signal?.throwIfAborted()
      this.assertCurrent(sessionId, resourceInstance)
      if (isStaleDeepChatInstanceError(error)) throw error
      complete = false
      addDegradation('definition-universe-unavailable')
    }

    if (definitionUniverse) {
      const sourceCount = definitionUniverse.unavailableSourceCount
      const hasValidSourceCount =
        Number.isSafeInteger(sourceCount) &&
        sourceCount >= 0 &&
        sourceCount <= MAX_UNAVAILABLE_TOOL_DEFINITION_SOURCES
      const definitionSourceComplete =
        definitionUniverse.complete === true && hasValidSourceCount && sourceCount === 0
      if (!Array.isArray(definitionUniverse.definitions)) {
        complete = false
        addDegradation('definition-universe-unavailable')
      } else if (definitionUniverse.definitions.length > MAX_RUN_TOOL_UNIVERSE_DEFINITIONS) {
        complete = false
        addDegradation(
          'definition-limit-exceeded',
          definitionUniverse.definitions.length - MAX_RUN_TOOL_UNIVERSE_DEFINITIONS
        )
      } else {
        try {
          buildCanonicalToolCatalog(definitionUniverse.definitions)
          definitions = detachToolDefinitions(definitionUniverse.definitions)
          definitionUniverseComplete = definitionSourceComplete
        } catch {
          complete = false
          addDegradation('definition-universe-unavailable')
        }
      }
      if (!definitionSourceComplete) {
        complete = false
        const unavailableSourceCount = hasValidSourceCount && sourceCount > 0 ? sourceCount : 1
        addDegradation('definition-universe-unavailable', unavailableSourceCount)
      }
    }

    const targetKeysByRequirementName = new Map<string, Set<string>>()
    const addRequirementCandidate = (name: string, stableTargetKey: string): void => {
      const normalizedName = name.trim()
      if (!normalizedName) return
      const candidates = targetKeysByRequirementName.get(normalizedName) ?? new Set<string>()
      candidates.add(stableTargetKey)
      targetKeysByRequirementName.set(normalizedName, candidates)
    }
    try {
      for (const definition of definitions) {
        const stableTargetKey = buildExecutionToolTargetKey(
          buildExecutionToolCeiling(definition).target
        )
        addRequirementCandidate(definition.function.name, stableTargetKey)
        const originalName = definition.source === 'mcp' ? definition.raw?.name : undefined
        if (typeof originalName === 'string') {
          addRequirementCandidate(originalName, stableTargetKey)
          addRequirementCandidate(
            normalizeRunSkillToolRequirement(originalName) || originalName,
            stableTargetKey
          )
        }
      }
    } catch {
      complete = false
      definitionUniverseComplete = false
      definitions = []
      targetKeysByRequirementName.clear()
      addDegradation('definition-universe-unavailable')
    }

    const skillRequirements: RunSkillToolRequirements[] = []
    for (const metadata of boundedMetadata) {
      const issueCodes = new Set<RunToolUniverseDegradationCode>(metadata.initialIssueCodes)
      const requiredStableTargetKeys = new Set<string>()
      if (!definitionUniverseComplete && metadata.normalizedRequirements.length > 0) {
        issueCodes.add('definition-universe-unavailable')
      } else if (issueCodes.size === 0) {
        for (const requirementName of metadata.normalizedRequirements) {
          const candidates = targetKeysByRequirementName.get(requirementName)
          if (!candidates || candidates.size === 0) {
            issueCodes.add('skill-requirement-unresolved')
          } else if (candidates.size > 1) {
            issueCodes.add('skill-requirement-ambiguous')
          } else {
            requiredStableTargetKeys.add(candidates.values().next().value as string)
          }
        }
      }
      if (conflictingSkillNames.has(metadata.name)) {
        issueCodes.add('skill-metadata-conflict')
      }
      for (const code of issueCodes) {
        if (code !== 'definition-universe-unavailable') addDegradation(code)
      }
      skillRequirements.push({
        skillName: metadata.name,
        activeAtRunStart: activeSkillSet.has(metadata.name),
        activatable: issueCodes.size === 0,
        requiredStableTargetKeys: [...requiredStableTargetKeys].sort(compareCodePoints),
        issueCodes: [...issueCodes].sort(compareCodePoints)
      })
    }

    for (const skillName of missingActiveSkillNames) {
      const code: RunToolUniverseDegradationCode = !metadataCatalogAvailable
        ? 'skill-catalog-unavailable'
        : metadataCatalogOverflow
          ? 'active-skill-metadata-not-admitted'
          : 'active-skill-metadata-missing'
      skillRequirements.push({
        skillName,
        activeAtRunStart: true,
        activatable: false,
        requiredStableTargetKeys: [],
        issueCodes: [code]
      })
    }
    skillRequirements.sort((left, right) => compareCodePoints(left.skillName, right.skillName))

    const mandatoryAdmissionBlocked = skillRequirements.some(
      (requirement) => requirement.activeAtRunStart && !requirement.activatable
    )
    const degradationCounts = [...degradationCountByCode.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((left, right) => compareCodePoints(left.code, right.code))
    return freezeRunToolDefinitionUniverse({
      status: complete && degradationCounts.length === 0 ? 'resolved' : 'degraded',
      complete,
      mandatoryAdmissionBlocked,
      definitions,
      activeSkillNames,
      skillRequirements,
      degradationCounts
    })
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
          { requireComplete: failClosed }
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
      resourceInstance?.getRuntimeState() ??
      this.dependencies.registry.getHydratedScope(toAppSessionId(sessionId))?.state()
    const agentId =
      resourceInstance?.getAgentId()?.trim() ||
      this.dependencies.identity.getAgentId(sessionId) ||
      'deepchat'
    const kind = resolveDeepChatToolProfileKind(normalizedProjectDir)

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
    options: {
      reportDiagnostics?: boolean
      requireComplete?: boolean
      signal?: AbortSignal
    } = {}
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

    const [agentTypeResult, configResult] = await awaitWithAbort(
      Promise.allSettled([
        this.dependencies.agentSettings.getAgentType(agentId),
        this.dependencies.agentSettings.resolveDeepChatAgentConfig(agentId)
      ]),
      options.signal
    )
    const agentType = agentTypeResult.status === 'fulfilled' ? agentTypeResult.value : null

    if (agentTypeResult.status === 'rejected') {
      if (options.reportDiagnostics !== false) {
        console.warn(
          `[DeepChatAgent] Failed to resolve Agent type for tool policy ${agentId}:`,
          agentTypeResult.reason
        )
      }
      if (options.requireComplete) throw agentTypeResult.reason
    }
    if (configResult.status === 'rejected') {
      if (options.reportDiagnostics !== false) {
        console.warn(
          `[DeepChatAgent] Failed to resolve tool policy for agent ${agentId}:`,
          configResult.reason
        )
      }
      if (options.requireComplete) throw configResult.reason
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
        parentConfig = await awaitWithAbort(
          this.dependencies.agentSettings.resolveDeepChatAgentConfig(parentAgentId),
          options.signal
        )
      } catch (error) {
        options.signal?.throwIfAborted()
        if (options.reportDiagnostics !== false) {
          console.warn(
            `[DeepChatAgent] Failed to resolve parent tool policy for subagent ${sessionId}:`,
            error
          )
        }
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
