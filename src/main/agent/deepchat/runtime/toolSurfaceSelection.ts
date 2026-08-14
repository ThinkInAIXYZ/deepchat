import { types as nodeTypes } from 'node:util'
import type {
  DeepChatAgentInstance,
  DeepChatToolProfileKind
} from '@/agent/deepchat/instance/deepChatAgentInstance'
import type { LoopRunToolSurfaceMode } from '@/agent/deepchat/loop/loopRun'
import { hashJsonData } from '@/tape/domain/canonicalJson'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type {
  CanonicalToolCatalog,
  ToolSurfaceDefinitionIdentity,
  ToolSurfaceSelectionPolicy
} from './toolSurface'

const MAX_RECENT_MESSAGES = 64
const MAX_RECENT_TOOL_NAMES = 64
const MAX_RECENT_TOOL_CALLS_INSPECTED = 256
const MAX_RECENT_TOOL_NAME_CODE_UNITS = 1_024
const MAX_RECENT_TOOL_NAME_BYTES = 1_024
const DEFAULT_ADAPTER_HISTORY_LINEAGES_PER_INSTANCE = 8
const MAX_ADAPTER_HISTORY_LINEAGES_PER_INSTANCE = 32
const MAX_ADAPTER_HISTORY_SCOPE_CODE_UNITS = 1_024
const MAX_ADAPTER_HISTORY_SCOPE_BYTES = 4_096

const TOOL_SURFACE_SELECTION_BOUNDS = Object.freeze({
  maxInitialToolCount: 32,
  maxInitialDefinitionTokens: 10_000,
  activationReserveToolCount: 8,
  activationReserveDefinitionTokens: 2_000,
  maxActivationCandidatesPerBatch: 16,
  maxActivationCandidateDefinitionTokensPerBatch: 2_000,
  maxActivationBatchesPerRun: 8,
  maxAppendedTargetsPerRun: 8,
  toolSearchPromptTokens: 128
})

const CODE_CORE_TOOL_NAMES = Object.freeze([
  'deepchat_question',
  'edit',
  'exec',
  'glob',
  'grep',
  'process',
  'read',
  'update_plan',
  'write'
])
const GENERAL_CORE_TOOL_NAMES = Object.freeze(['deepchat_question', 'update_plan'])

export interface ToolSurfacePolicySelectionInputs {
  readonly policyRequiredStableTargetKeys: readonly string[]
  readonly coreStableTargetKeys: readonly string[]
  readonly activeSkillRequiredStableTargetKeys: readonly string[]
  readonly recentHints: readonly ToolSurfaceDefinitionIdentity[]
}

export interface AutomaticToolSurfaceRunModeAssignment {
  readonly mode: 'automatic'
  /** A trusted rollout result backed by measured provider/model evidence, never an inference. */
  readonly cliProgrammaticCapability: 'proven' | 'unproven'
  /** Optional cross-process rollout hint. Process-live history fills this when absent. */
  readonly previousMode?: Exclude<LoopRunToolSurfaceMode, 'legacy'>
}

export type ToolSurfaceRunModeAssignment =
  | LoopRunToolSurfaceMode
  | AutomaticToolSurfaceRunModeAssignment

export function isAutomaticToolSurfaceRunModeAssignment(
  assignment: ToolSurfaceRunModeAssignment
): assignment is AutomaticToolSurfaceRunModeAssignment {
  return (
    typeof assignment === 'object' &&
    assignment !== null &&
    assignment.mode === 'automatic' &&
    (assignment.cliProgrammaticCapability === 'proven' ||
      assignment.cliProgrammaticCapability === 'unproven') &&
    (assignment.previousMode === undefined ||
      assignment.previousMode === 'full' ||
      assignment.previousMode === 'native-activation' ||
      assignment.previousMode === 'cli-programmatic')
  )
}

export function selectAutomaticToolSurfaceRunMode(input: {
  readonly virtualizationTriggered: boolean
  readonly cliProgrammaticCapability: 'proven' | 'unproven'
  readonly agentExecAvailable: boolean
  readonly programmaticRunCeilingFits: boolean
  readonly previousMode?: Exclude<LoopRunToolSurfaceMode, 'legacy'>
}): Exclude<LoopRunToolSurfaceMode, 'legacy'> {
  if (!input.virtualizationTriggered) return 'full'
  if (input.previousMode === 'native-activation') return 'native-activation'
  return input.cliProgrammaticCapability === 'proven' &&
    input.agentExecAvailable &&
    input.programmaticRunCeilingFits
    ? 'cli-programmatic'
    : 'native-activation'
}

export function createAutomaticToolSurfaceSelectionPolicy(
  toolSearchDefinitionTokens: number
): ToolSurfaceSelectionPolicy {
  return Object.freeze({
    policyVersion: 'automatic-adapter-v1',
    enterToolCount: 40,
    exitToolCount: 32,
    enterEstimatedInputTokens: 12_000,
    exitEstimatedInputTokens: 9_600,
    ...TOOL_SURFACE_SELECTION_BOUNDS,
    toolSearchDefinitionTokens
  })
}

export function createExplicitNativeActivationPolicy(
  toolSearchDefinitionTokens: number
): ToolSurfaceSelectionPolicy {
  return Object.freeze({
    policyVersion: 'native-activation-explicit-v1',
    enterToolCount: 1,
    exitToolCount: 0,
    enterEstimatedInputTokens: 1,
    exitEstimatedInputTokens: 0,
    ...TOOL_SURFACE_SELECTION_BOUNDS,
    toolSearchDefinitionTokens
  })
}

export interface ToolSurfaceAdapterHistoryScope {
  readonly sessionId: string
  readonly providerId: string
  readonly modelId: string
  readonly toolProfile: DeepChatToolProfileKind
}

function isBoundedAdapterHistoryScopeField(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_ADAPTER_HISTORY_SCOPE_CODE_UNITS &&
    value === value.trim() &&
    !value.includes('\0') &&
    Buffer.byteLength(value, 'utf8') <= MAX_ADAPTER_HISTORY_SCOPE_BYTES
  )
}

/** Process-live cache-stability hint. It never grants eligibility or survives an instance reset. */
export class ToolSurfaceAdapterHistory {
  private readonly entriesByInstance = new WeakMap<
    DeepChatAgentInstance,
    Map<string, Exclude<LoopRunToolSurfaceMode, 'legacy'>>
  >()
  private readonly maxLineagesPerInstance: number

  constructor(options: { readonly maxLineagesPerInstance?: number } = {}) {
    const requestedMax = options.maxLineagesPerInstance
    this.maxLineagesPerInstance =
      requestedMax !== undefined && Number.isSafeInteger(requestedMax) && requestedMax > 0
        ? Math.min(requestedMax, MAX_ADAPTER_HISTORY_LINEAGES_PER_INSTANCE)
        : DEFAULT_ADAPTER_HISTORY_LINEAGES_PER_INSTANCE
  }

  previousMode(input: {
    readonly instance: DeepChatAgentInstance
    readonly scope: ToolSurfaceAdapterHistoryScope
  }): Exclude<LoopRunToolSurfaceMode, 'legacy'> | null {
    try {
      const key = this.lineageKey(input.instance, input.scope)
      const entries = this.entriesByInstance.get(input.instance)
      const current = entries?.get(key)
      if (!entries || !current) return null
      return current
    } catch {
      return null
    }
  }

  record(input: {
    readonly instance: DeepChatAgentInstance
    readonly scope: ToolSurfaceAdapterHistoryScope
    readonly mode: Exclude<LoopRunToolSurfaceMode, 'legacy'>
  }): void {
    try {
      const key = this.lineageKey(input.instance, input.scope)
      const entries = this.entriesByInstance.get(input.instance) ?? new Map()
      entries.delete(key)
      entries.set(key, input.mode)
      while (entries.size > this.maxLineagesPerInstance) {
        const oldestKey = entries.keys().next().value
        if (typeof oldestKey !== 'string') break
        entries.delete(oldestKey)
      }
      this.entriesByInstance.set(input.instance, entries)
    } catch {}
  }

  private lineageKey(
    instance: DeepChatAgentInstance,
    scope: ToolSurfaceAdapterHistoryScope
  ): string {
    if (
      scope.sessionId !== instance.sessionId ||
      !isBoundedAdapterHistoryScopeField(scope.sessionId) ||
      !isBoundedAdapterHistoryScopeField(scope.providerId) ||
      !isBoundedAdapterHistoryScopeField(scope.modelId)
    ) {
      throw new Error('Tool Surface adapter history scope is invalid for its Session instance.')
    }
    return hashJsonData({
      sessionId: scope.sessionId,
      providerId: scope.providerId,
      modelId: scope.modelId,
      toolProfile: scope.toolProfile
    })
  }
}

function coreToolNames(profile: DeepChatToolProfileKind): readonly string[] {
  switch (profile) {
    case 'code':
      return CODE_CORE_TOOL_NAMES
    case 'research':
    case 'analysis':
    case 'general':
      return GENERAL_CORE_TOOL_NAMES
  }
}

function stableTargetKeysForVisibleNames(
  catalog: CanonicalToolCatalog,
  names: readonly string[]
): string[] {
  const entryByName = new Map(
    catalog.entries.map((entry) => [entry.target.providerVisibleName, entry.stableTargetKey])
  )
  const stableTargetKeys: string[] = []
  const seen = new Set<string>()
  for (const name of names) {
    const stableTargetKey = entryByName.get(name)
    if (!stableTargetKey || seen.has(stableTargetKey)) continue
    seen.add(stableTargetKey)
    stableTargetKeys.push(stableTargetKey)
  }
  return stableTargetKeys
}

function isSafeDataObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || nodeTypes.isProxy(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function readOwnDataProperty(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

function readSafeArrayElement(value: readonly unknown[], index: number): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

function isBoundedRecentToolName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_RECENT_TOOL_NAME_CODE_UNITS &&
    value === value.trim() &&
    !value.includes('\0') &&
    Buffer.byteLength(value, 'utf8') <= MAX_RECENT_TOOL_NAME_BYTES
  )
}

export function collectRecentToolSurfaceNames(
  messages: readonly ChatMessage[]
): readonly string[] {
  if (!Array.isArray(messages) || nodeTypes.isProxy(messages)) return Object.freeze([])
  const names: string[] = []
  const seen = new Set<string>()
  let inspectedToolCalls = 0
  const firstIndex = Math.max(0, messages.length - MAX_RECENT_MESSAGES)
  for (let messageIndex = messages.length - 1; messageIndex >= firstIndex; messageIndex -= 1) {
    const message = readSafeArrayElement(messages, messageIndex)
    if (!isSafeDataObject(message) || readOwnDataProperty(message, 'role') !== 'assistant') continue
    const toolCalls = readOwnDataProperty(message, 'tool_calls')
    if (!Array.isArray(toolCalls) || nodeTypes.isProxy(toolCalls)) continue
    for (let callIndex = toolCalls.length - 1; callIndex >= 0; callIndex -= 1) {
      inspectedToolCalls += 1
      if (inspectedToolCalls > MAX_RECENT_TOOL_CALLS_INSPECTED) return Object.freeze(names)
      const call = readSafeArrayElement(toolCalls, callIndex)
      if (!isSafeDataObject(call)) continue
      const functionCall = readOwnDataProperty(call, 'function')
      if (!isSafeDataObject(functionCall)) continue
      const name = readOwnDataProperty(functionCall, 'name')
      if (!isBoundedRecentToolName(name) || seen.has(name)) continue
      seen.add(name)
      names.push(name)
      if (names.length >= MAX_RECENT_TOOL_NAMES) return Object.freeze(names)
    }
  }
  return Object.freeze(names)
}

export function prepareToolSurfacePolicySelectionInputs(input: {
  readonly eligibleCatalog: CanonicalToolCatalog
  readonly toolProfile: DeepChatToolProfileKind
  readonly activeSkillRequiredStableTargetKeys: readonly string[]
  readonly recentToolNames: readonly string[]
}): ToolSurfacePolicySelectionInputs {
  const policyRequiredStableTargetKeys = input.eligibleCatalog.entries
    .filter((entry) => entry.exposure === 'system-model')
    .map((entry) => entry.stableTargetKey)
  const coreStableTargetKeys = stableTargetKeysForVisibleNames(
    input.eligibleCatalog,
    coreToolNames(input.toolProfile)
  )
  const recentStableTargetKeys = stableTargetKeysForVisibleNames(
    input.eligibleCatalog,
    input.recentToolNames
  )
  const eligibleIdentityByTarget = new Map(
    input.eligibleCatalog.entries.map((entry) => [
      entry.stableTargetKey,
      {
        stableTargetKey: entry.stableTargetKey,
        canonicalToolDefinitionHash: entry.canonicalToolDefinitionHash
      }
    ])
  )
  return Object.freeze({
    policyRequiredStableTargetKeys: Object.freeze(policyRequiredStableTargetKeys),
    coreStableTargetKeys: Object.freeze(coreStableTargetKeys),
    activeSkillRequiredStableTargetKeys: Object.freeze([
      ...input.activeSkillRequiredStableTargetKeys
    ]),
    recentHints: Object.freeze(
      recentStableTargetKeys.flatMap((stableTargetKey) => {
        const identity = eligibleIdentityByTarget.get(stableTargetKey)
        return identity ? [Object.freeze(identity)] : []
      })
    )
  })
}
