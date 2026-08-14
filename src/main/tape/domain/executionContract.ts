import { createHash } from 'node:crypto'
import type { ChatMessage } from '@shared/types/core/chat-message'
import {
  stripToolExecutionContract,
  type MCPToolDefinition,
  type ToolEffect,
  type ToolExecutionContract
} from '@shared/types/core/mcp'
import type { PermissionMode } from '@shared/types/agent-interface'
import type { ModelConfig } from '@shared/types/provider'
import {
  DEEPCHAT_PROMPT_DEGRADATION_CODES,
  DEEPCHAT_PROMPT_SECTION_INCLUSIONS,
  DEEPCHAT_PROMPT_SECTION_KINDS,
  DEEPCHAT_PROMPT_SOURCE_FRESHNESS_VALUES,
  type DeepChatPromptAssembly,
  type DeepChatPromptDegradationCode,
  type DeepChatPromptSectionProvenance
} from '@shared/types/prompt-assembly'
import {
  DEEPCHAT_EXECUTION_CONTRACT_BINDING_SCHEMA_VERSION,
  DEEPCHAT_EXECUTION_CONTRACT_HASH_VERSION,
  DEEPCHAT_EXECUTION_CONTRACT_SCHEMA_VERSION,
  type DeepChatExecutionContract,
  type DeepChatExecutionContractBinding,
  type DeepChatExecutionContractRequest,
  type DeepChatExecutionDynamicControlSnapshot,
  type DeepChatExecutionToolCeiling,
  type DeepChatExecutionToolTargetIdentity,
  type DeepChatExecutionWorkspaceCeiling
} from '@shared/types/execution-contract'
import type { DeepChatTaskContractContext } from '@shared/types/task-contract'
import { canonicalJsonStringifyData, hashJsonData } from './canonicalJson'
import { isDeepChatTaskContract, isDeepChatTaskContractRef } from './taskContract'
import {
  isWorkspacePathWithin,
  normalizeAbsoluteWorkspacePath,
  workspacePathsMatch
} from './workspacePath'

export const MAX_EXECUTION_CONTRACT_BYTES = 64 * 1024
export const MAX_EXECUTION_CONTRACT_BINDING_BYTES = 4 * 1024
export const MAX_EXECUTION_CONTRACT_TOOLS = 256
export const MAX_EXECUTION_CONTRACT_PROMPT_SECTIONS = 64
export const MAX_EXECUTION_CONTRACT_SUBAGENT_DEPTH = 1

const MAX_IDENTITY_BYTES = 1_024
const MAX_SOURCE_REF_BYTES = 2_048
const MAX_WORKSPACE_PATH_BYTES = 32 * 1_024
const MAX_ASSEMBLER_VERSION_BYTES = 256
const MAX_SECTION_DEGRADATION_CODES = 16
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA_256_PATTERN = /^[0-9a-f]{64}$/
const JSON_HASH_OPTIONS = Object.freeze({ omitUndefinedProperties: true })
const PROMPT_SECTION_KINDS = new Set<string>(DEEPCHAT_PROMPT_SECTION_KINDS)
const PROMPT_SECTION_INCLUSIONS = new Set<string>(DEEPCHAT_PROMPT_SECTION_INCLUSIONS)
const PROMPT_SOURCE_FRESHNESS_VALUES = new Set<string>(DEEPCHAT_PROMPT_SOURCE_FRESHNESS_VALUES)
const PROMPT_DEGRADATION_CODES = new Set<string>(DEEPCHAT_PROMPT_DEGRADATION_CODES)
const PERMISSION_MODES = new Set<PermissionMode>(['default', 'auto_approve', 'full_access'])
const EXECUTION_CONTRACT_KEYS = [
  'schemaVersion',
  'hashVersion',
  'request',
  'ceilings',
  'dynamicControlSnapshot',
  'provenance',
  'contractHash'
] as const
const EXECUTION_REQUEST_KEYS = ['sessionId', 'messageId', 'runId', 'requestSeq'] as const
const EXECUTION_CONTRACT_BINDING_KEYS = ['schemaVersion', 'request', 'contractHash'] as const
const EXECUTION_CEILINGS_KEYS = ['tools', 'workspace', 'maxSubagentDepth'] as const
const EXECUTION_TOOL_CEILING_KEYS = ['target', 'execution'] as const
const EXECUTION_TOOL_TARGET_KEYS = [
  'providerVisibleName',
  'source',
  'serverName',
  'serverId',
  'configGeneration',
  'bindingHash',
  'originalName'
] as const
const EXECUTION_POLICY_KEYS = ['effect', 'mode'] as const
const DYNAMIC_CONTROL_KEYS = ['permissionMode', 'requestAdmitted', 'cancellationRequested'] as const
const EXECUTION_PROVENANCE_KEYS = [
  'promptSections',
  'providerId',
  'modelId',
  'promptHash',
  'effectiveGenerationConfigHash',
  'providerVisibleToolDefinitionsHash',
  'internalExecutionPolicyHash',
  'assemblerVersion',
  'taskContractRef'
] as const
const PROMPT_SECTION_KEYS = [
  'kind',
  'sourceRef',
  'inclusion',
  'contentHash',
  'freshness',
  'degradationCodes'
] as const

export interface BuildExecutionContractInput {
  request: DeepChatExecutionContractRequest
  promptAssembly: DeepChatPromptAssembly
  providerMessages: readonly ChatMessage[]
  tools: readonly MCPToolDefinition[]
  providerId: string
  modelId: string
  modelConfig: ModelConfig
  temperature: number
  maxTokens: number
  workspace: DeepChatExecutionWorkspaceCeiling
  maxSubagentDepth: number
  dynamicControlSnapshot: DeepChatExecutionDynamicControlSnapshot
  assemblerVersion: string
  taskContractContext?: DeepChatTaskContractContext | null
}

export class ExecutionContractError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid_input' | 'limit_exceeded' | 'conflicting_tool',
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ExecutionContractError'
  }
}

export type ExecutionContractDispatchErrorCode =
  | 'invalid_contract'
  | 'identity_mismatch'
  | 'tool_not_allowed'
  | 'target_mismatch'
  | 'effect_exceeds_ceiling'
  | 'execution_mode_mismatch'
  | 'workspace_mismatch'
  | 'subagent_depth_exceeded'
  | 'invalid_runtime_authority'

export class ExecutionContractDispatchError extends Error {
  constructor(
    message: string,
    readonly code: ExecutionContractDispatchErrorCode,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ExecutionContractDispatchError'
  }
}

export interface ExecutionContractDispatchInput {
  request: DeepChatExecutionContractRequest
  currentTool: MCPToolDefinition
  currentWorkspace: DeepChatExecutionWorkspaceCeiling
  currentMaxSubagentDepth: number
  requestedSubagentDepth: number
}

export function buildExecutionContractBinding(
  contract: DeepChatExecutionContract
): DeepChatExecutionContractBinding {
  if (!isDeepChatExecutionContract(contract)) {
    throw new ExecutionContractError(
      'ExecutionContract binding requires a canonical contract.',
      'invalid_input'
    )
  }
  return deepFreeze({
    schemaVersion: DEEPCHAT_EXECUTION_CONTRACT_BINDING_SCHEMA_VERSION,
    request: contract.request,
    contractHash: contract.contractHash
  })
}

export function isDeepChatExecutionContractBinding(
  value: unknown
): value is DeepChatExecutionContractBinding {
  return (
    hasExactKeys(value, EXECUTION_CONTRACT_BINDING_KEYS) &&
    value.schemaVersion === DEEPCHAT_EXECUTION_CONTRACT_BINDING_SCHEMA_VERSION &&
    isStoredExecutionContractRequest(value.request) &&
    isSha256(value.contractHash)
  )
}

export function parseExecutionContractBinding(
  value: unknown
): DeepChatExecutionContractBinding | null {
  if (typeof value !== 'string' || utf8Length(value) > MAX_EXECUTION_CONTRACT_BINDING_BYTES) {
    return null
  }
  try {
    const parsed = JSON.parse(value) as unknown
    return isDeepChatExecutionContractBinding(parsed) ? deepFreeze(parsed) : null
  } catch {
    return null
  }
}

export function executionContractMatchesBinding(
  contract: unknown,
  binding: DeepChatExecutionContractBinding
): contract is DeepChatExecutionContract {
  return (
    isDeepChatExecutionContract(contract) &&
    contract.contractHash === binding.contractHash &&
    contract.request.sessionId === binding.request.sessionId &&
    contract.request.messageId === binding.request.messageId &&
    contract.request.runId === binding.request.runId &&
    contract.request.requestSeq === binding.request.requestSeq
  )
}

export function restoreExecutionContract(value: unknown): DeepChatExecutionContract | null {
  return isDeepChatExecutionContract(value) ? deepFreeze(value) : null
}

function utf8Length(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function requireString(
  value: unknown,
  label: string,
  maxBytes: number,
  options: { preserveOuterWhitespace?: boolean } = {}
): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.includes('\0') ||
    utf8Length(value) > maxBytes
  ) {
    throw new ExecutionContractError(
      `${label} must be a non-empty UTF-8 string no longer than ${maxBytes} bytes.`,
      'invalid_input'
    )
  }
  if (!options.preserveOuterWhitespace && value !== value.trim()) {
    throw new ExecutionContractError(`${label} must not contain outer whitespace.`, 'invalid_input')
  }
  return value
}

function requireUuid(value: unknown, label: string): string {
  const uuid = requireString(value, label, MAX_IDENTITY_BYTES)
  if (!UUID_PATTERN.test(uuid)) {
    throw new ExecutionContractError(`${label} must be a UUID.`, 'invalid_input')
  }
  return uuid.toLowerCase()
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA_256_PATTERN.test(value)) {
    throw new ExecutionContractError(`${label} must be a lowercase SHA-256 hash.`, 'invalid_input')
  }
  return value
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ExecutionContractError(`${label} must be a positive safe integer.`, 'invalid_input')
  }
  return value as number
}

function requireNonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ExecutionContractError(
      `${label} must be a non-negative safe integer.`,
      'invalid_input'
    )
  }
  return value as number
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ExecutionContractError(`${label} must be a finite number.`, 'invalid_input')
  }
  return value
}

function hashData(value: unknown, label: string, omitUndefinedProperties = false): string {
  try {
    return hashJsonData(value, omitUndefinedProperties ? JSON_HASH_OPTIONS : undefined)
  } catch (error) {
    throw new ExecutionContractError(`${label} must contain only JSON data.`, 'invalid_input', {
      cause: error
    })
  }
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function hasExactKeys(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = []
): value is Record<string, unknown> {
  if (!isRecordObject(value)) return false
  const actualKeys = Object.keys(value)
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys])
  return (
    requiredKeys.every((key) => Object.hasOwn(value, key)) &&
    actualKeys.every((key) => allowedKeys.has(key)) &&
    actualKeys.length >= requiredKeys.length
  )
}

function matchesNormalizedString(
  value: unknown,
  label: string,
  maxBytes: number,
  options?: { preserveOuterWhitespace?: boolean }
): value is string {
  try {
    return requireString(value, label, maxBytes, options) === value
  } catch {
    return false
  }
}

function matchesNormalizedUuid(value: unknown, label: string): value is string {
  try {
    return requireUuid(value, label) === value
  } catch {
    return false
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA_256_PATTERN.test(value)
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizeExecution(value: ToolExecutionContract, label: string): ToolExecutionContract {
  if (value?.effect === 'read' && (value.mode === 'sequential' || value.mode === 'parallel')) {
    return { effect: 'read', mode: value.mode }
  }
  if (value?.effect === 'write' && value.mode === 'sequential') {
    return { effect: 'write', mode: 'sequential' }
  }
  throw new ExecutionContractError(`${label} is invalid.`, 'invalid_input')
}

function normalizeOptionalAgentBinding(definition: MCPToolDefinition): {
  serverId: string | null
  configGeneration: number | null
  bindingHash: string | null
} {
  const values = [
    definition.server?.id,
    definition.server?.configGeneration,
    definition.server?.bindingHash
  ]
  if (values.every((value) => value === undefined)) {
    return { serverId: null, configGeneration: null, bindingHash: null }
  }
  if (values.some((value) => value === undefined)) {
    throw new ExecutionContractError(
      `Agent tool ${definition.function?.name ?? '<unknown>'} has an incomplete stable binding.`,
      'invalid_input'
    )
  }
  return {
    serverId: requireUuid(definition.server.id, 'tool.server.id'),
    configGeneration: requirePositiveSafeInteger(
      definition.server.configGeneration,
      'tool.server.configGeneration'
    ),
    bindingHash: requireSha256(definition.server.bindingHash, 'tool.server.bindingHash')
  }
}

function normalizeToolCeiling(
  definition: MCPToolDefinition,
  index: number
): DeepChatExecutionToolCeiling {
  const label = `tools[${index}]`
  if (definition?.source !== 'agent' && definition?.source !== 'mcp') {
    throw new ExecutionContractError(`${label}.source must be agent or mcp.`, 'invalid_input')
  }
  const providerVisibleName = requireString(
    definition.function?.name,
    `${label}.function.name`,
    MAX_IDENTITY_BYTES
  )
  const serverName = requireString(
    definition.server?.name,
    `${label}.server.name`,
    MAX_IDENTITY_BYTES
  )
  const originalName = requireString(
    definition.raw?.name ?? providerVisibleName,
    `${label}.originalName`,
    MAX_IDENTITY_BYTES
  )
  const binding =
    definition.source === 'mcp'
      ? {
          serverId: requireUuid(definition.server.id, `${label}.server.id`),
          configGeneration: requirePositiveSafeInteger(
            definition.server.configGeneration,
            `${label}.server.configGeneration`
          ),
          bindingHash: requireSha256(definition.server.bindingHash, `${label}.server.bindingHash`)
        }
      : normalizeOptionalAgentBinding(definition)

  return {
    target: {
      providerVisibleName,
      source: definition.source,
      serverName,
      ...binding,
      originalName
    },
    execution: normalizeExecution(definition.execution, `${label}.execution`)
  }
}

export function buildExecutionToolCeiling(
  definition: MCPToolDefinition
): DeepChatExecutionToolCeiling {
  return normalizeToolCeiling(definition, 0)
}

export function buildExecutionToolTargetKey(target: DeepChatExecutionToolTargetIdentity): string {
  return canonicalJsonStringifyData(target)
}

function normalizeToolCeilings(
  definitions: readonly MCPToolDefinition[]
): DeepChatExecutionToolCeiling[] {
  if (definitions.length > MAX_EXECUTION_CONTRACT_TOOLS) {
    throw new ExecutionContractError(
      `Execution contract has more than ${MAX_EXECUTION_CONTRACT_TOOLS} tools.`,
      'limit_exceeded'
    )
  }

  const ceilingByTarget = new Map<
    string,
    { ceiling: DeepChatExecutionToolCeiling; providerDefinitionHash: string }
  >()
  const targetKeyByVisibleName = new Map<string, string>()
  definitions.forEach((definition, index) => {
    const ceiling = normalizeToolCeiling(definition, index)
    const targetKey = buildExecutionToolTargetKey(ceiling.target)
    const providerDefinitionHash = buildProviderVisibleToolDefinitionsHash([definition])
    const visibleName = ceiling.target.providerVisibleName
    const previousTargetKey = targetKeyByVisibleName.get(visibleName)
    if (previousTargetKey !== undefined && previousTargetKey !== targetKey) {
      throw new ExecutionContractError(
        `Provider-visible tool ${visibleName} resolves to conflicting targets.`,
        'conflicting_tool'
      )
    }
    targetKeyByVisibleName.set(visibleName, targetKey)

    const previous = ceilingByTarget.get(targetKey)
    if (!previous) {
      ceilingByTarget.set(targetKey, { ceiling, providerDefinitionHash })
      return
    }
    if (
      previous.ceiling.execution.effect !== ceiling.execution.effect ||
      previous.ceiling.execution.mode !== ceiling.execution.mode
    ) {
      throw new ExecutionContractError(
        `Tool target ${visibleName} has conflicting execution policies.`,
        'conflicting_tool'
      )
    }
    if (previous.providerDefinitionHash !== providerDefinitionHash) {
      throw new ExecutionContractError(
        `Tool target ${visibleName} has conflicting provider definitions.`,
        'conflicting_tool'
      )
    }
  })

  return [...ceilingByTarget.entries()]
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([, value]) => value.ceiling)
}

function normalizePromptSections(
  assembly: DeepChatPromptAssembly
): DeepChatPromptSectionProvenance[] {
  if (assembly.sections.length > MAX_EXECUTION_CONTRACT_PROMPT_SECTIONS) {
    throw new ExecutionContractError(
      `Execution contract has more than ${MAX_EXECUTION_CONTRACT_PROMPT_SECTIONS} prompt sections.`,
      'limit_exceeded'
    )
  }

  return assembly.sections.map((section, index) => {
    const label = `promptAssembly.sections[${index}]`
    if (!PROMPT_SECTION_KINDS.has(section.kind)) {
      throw new ExecutionContractError(`${label}.kind is invalid.`, 'invalid_input')
    }
    if (!PROMPT_SECTION_INCLUSIONS.has(section.inclusion)) {
      throw new ExecutionContractError(`${label}.inclusion is invalid.`, 'invalid_input')
    }
    const sourceRef = requireString(section.sourceRef, `${label}.sourceRef`, MAX_SOURCE_REF_BYTES)
    if (typeof section.content !== 'string') {
      throw new ExecutionContractError(`${label}.content must be a string.`, 'invalid_input')
    }
    if (section.degradationCodes !== undefined && !Array.isArray(section.degradationCodes)) {
      throw new ExecutionContractError(
        `${label}.degradationCodes must be an array.`,
        'invalid_input'
      )
    }
    if ((section.degradationCodes?.length ?? 0) > MAX_SECTION_DEGRADATION_CODES) {
      throw new ExecutionContractError(
        `${label} has more than ${MAX_SECTION_DEGRADATION_CODES} degradation codes.`,
        'limit_exceeded'
      )
    }
    const degradationCodes = [...new Set(section.degradationCodes ?? [])]
    if (degradationCodes.some((code) => !PROMPT_DEGRADATION_CODES.has(code))) {
      throw new ExecutionContractError(`${label}.degradationCodes is invalid.`, 'invalid_input')
    }
    degradationCodes.sort(compareCodePoints)
    if (section.freshness !== undefined && !PROMPT_SOURCE_FRESHNESS_VALUES.has(section.freshness)) {
      throw new ExecutionContractError(`${label}.freshness is invalid.`, 'invalid_input')
    }

    const hasContent = section.content.trim().length > 0
    const expectedInclusion = !hasContent
      ? 'omitted'
      : degradationCodes.length > 0
        ? 'degraded'
        : 'included'
    if (section.inclusion !== expectedInclusion) {
      throw new ExecutionContractError(
        `${label}.inclusion does not match its content and degradation state.`,
        'invalid_input'
      )
    }
    const contentHash = hasContent
      ? createHash('sha256').update(section.content, 'utf8').digest('hex')
      : undefined
    if (section.contentHash !== contentHash) {
      throw new ExecutionContractError(
        `${label}.contentHash does not match its content.`,
        'invalid_input'
      )
    }

    return {
      kind: section.kind,
      sourceRef,
      inclusion: section.inclusion,
      ...(contentHash ? { contentHash } : {}),
      ...(section.freshness ? { freshness: section.freshness } : {}),
      ...(degradationCodes.length > 0
        ? { degradationCodes: degradationCodes as DeepChatPromptDegradationCode[] }
        : {})
    }
  })
}

function normalizeRequest(
  request: DeepChatExecutionContractRequest
): DeepChatExecutionContractRequest {
  return {
    sessionId: requireString(request.sessionId, 'request.sessionId', MAX_IDENTITY_BYTES),
    messageId: requireString(request.messageId, 'request.messageId', MAX_IDENTITY_BYTES),
    runId: requireUuid(request.runId, 'request.runId'),
    requestSeq: requirePositiveSafeInteger(request.requestSeq, 'request.requestSeq')
  }
}

function normalizeWorkspace(
  workspace: DeepChatExecutionWorkspaceCeiling
): DeepChatExecutionWorkspaceCeiling {
  if (workspace?.kind === 'runtime_default') {
    return { kind: 'runtime_default' }
  }
  if (workspace?.kind !== 'path') {
    throw new ExecutionContractError('workspace.kind is invalid.', 'invalid_input')
  }
  const workspacePath = requireString(workspace.path, 'workspace.path', MAX_WORKSPACE_PATH_BYTES, {
    preserveOuterWhitespace: true
  })
  const normalized = normalizeAbsoluteWorkspacePath(workspacePath)
  if (normalized === null) {
    throw new ExecutionContractError('workspace.path must be absolute.', 'invalid_input')
  }
  return { kind: 'path', path: normalized.path }
}

function normalizeMaxSubagentDepth(value: unknown): number {
  const depth = requireNonNegativeSafeInteger(value, 'maxSubagentDepth')
  if (depth > MAX_EXECUTION_CONTRACT_SUBAGENT_DEPTH) {
    throw new ExecutionContractError(
      `maxSubagentDepth exceeds the V1 limit of ${MAX_EXECUTION_CONTRACT_SUBAGENT_DEPTH}.`,
      'limit_exceeded'
    )
  }
  return depth
}

function normalizeDynamicControlSnapshot(
  snapshot: DeepChatExecutionDynamicControlSnapshot
): DeepChatExecutionDynamicControlSnapshot {
  if (!PERMISSION_MODES.has(snapshot?.permissionMode)) {
    throw new ExecutionContractError(
      'dynamicControlSnapshot.permissionMode is invalid.',
      'invalid_input'
    )
  }
  if (
    typeof snapshot.requestAdmitted !== 'boolean' ||
    typeof snapshot.cancellationRequested !== 'boolean'
  ) {
    throw new ExecutionContractError(
      'dynamicControlSnapshot admission and cancellation values must be boolean.',
      'invalid_input'
    )
  }
  return {
    permissionMode: snapshot.permissionMode,
    requestAdmitted: snapshot.requestAdmitted,
    cancellationRequested: snapshot.cancellationRequested
  }
}

function resolveLeadingSystemPrompt(messages: readonly ChatMessage[]): string {
  const first = messages[0]
  return first?.role === 'system' && typeof first.content === 'string' ? first.content : ''
}

function isStoredToolTarget(value: unknown): value is DeepChatExecutionToolTargetIdentity {
  if (!hasExactKeys(value, EXECUTION_TOOL_TARGET_KEYS)) return false
  if (value.source !== 'agent' && value.source !== 'mcp') return false
  if (
    !matchesNormalizedString(
      value.providerVisibleName,
      'target.providerVisibleName',
      MAX_IDENTITY_BYTES
    ) ||
    !matchesNormalizedString(value.serverName, 'target.serverName', MAX_IDENTITY_BYTES) ||
    !matchesNormalizedString(value.originalName, 'target.originalName', MAX_IDENTITY_BYTES)
  ) {
    return false
  }

  const hasNullBinding =
    value.serverId === null && value.configGeneration === null && value.bindingHash === null
  const hasStableBinding =
    matchesNormalizedUuid(value.serverId, 'target.serverId') &&
    Number.isSafeInteger(value.configGeneration) &&
    (value.configGeneration as number) > 0 &&
    isSha256(value.bindingHash)
  return value.source === 'mcp' ? hasStableBinding : hasNullBinding || hasStableBinding
}

/** Validate a target that has already passed canonical plain-data detachment. */
export function isDetachedStoredToolTarget(
  value: unknown
): value is DeepChatExecutionToolTargetIdentity {
  return isStoredToolTarget(value)
}

function isStoredExecutionPolicy(value: unknown): value is ToolExecutionContract {
  if (!hasExactKeys(value, EXECUTION_POLICY_KEYS)) return false
  return (
    (value.effect === 'read' && (value.mode === 'sequential' || value.mode === 'parallel')) ||
    (value.effect === 'write' && value.mode === 'sequential')
  )
}

function isStoredWorkspace(value: unknown): value is DeepChatExecutionWorkspaceCeiling {
  if (!isRecordObject(value)) return false
  if (value.kind === 'runtime_default') {
    return hasExactKeys(value, ['kind'])
  }
  if (value.kind !== 'path' || !hasExactKeys(value, ['kind', 'path'])) return false
  if (
    !matchesNormalizedString(value.path, 'workspace.path', MAX_WORKSPACE_PATH_BYTES, {
      preserveOuterWhitespace: true
    })
  ) {
    return false
  }
  return normalizeAbsoluteWorkspacePath(value.path)?.path === value.path
}

function isStoredPromptSection(value: unknown): value is DeepChatPromptSectionProvenance {
  if (
    !hasExactKeys(value, PROMPT_SECTION_KEYS.slice(0, 3), PROMPT_SECTION_KEYS.slice(3)) ||
    !PROMPT_SECTION_KINDS.has(value.kind as string) ||
    !matchesNormalizedString(value.sourceRef, 'promptSection.sourceRef', MAX_SOURCE_REF_BYTES) ||
    !PROMPT_SECTION_INCLUSIONS.has(value.inclusion as string)
  ) {
    return false
  }
  if (
    value.freshness !== undefined &&
    !PROMPT_SOURCE_FRESHNESS_VALUES.has(value.freshness as string)
  ) {
    return false
  }
  if (value.contentHash !== undefined && !isSha256(value.contentHash)) return false

  const degradationCodes = value.degradationCodes
  if (degradationCodes !== undefined) {
    if (
      !Array.isArray(degradationCodes) ||
      degradationCodes.length === 0 ||
      degradationCodes.length > MAX_SECTION_DEGRADATION_CODES ||
      degradationCodes.some(
        (code, index) =>
          typeof code !== 'string' ||
          !PROMPT_DEGRADATION_CODES.has(code) ||
          (index > 0 && compareCodePoints(degradationCodes[index - 1], code) >= 0)
      )
    ) {
      return false
    }
  }

  const hasContentHash = value.contentHash !== undefined
  const hasDegradation = degradationCodes !== undefined
  return (
    (value.inclusion === 'omitted' && !hasContentHash) ||
    (value.inclusion === 'included' && hasContentHash && !hasDegradation) ||
    (value.inclusion === 'degraded' && hasContentHash && hasDegradation)
  )
}

function isStoredExecutionContractRequest(
  value: unknown
): value is DeepChatExecutionContractRequest {
  return (
    hasExactKeys(value, EXECUTION_REQUEST_KEYS) &&
    matchesNormalizedString(value.sessionId, 'request.sessionId', MAX_IDENTITY_BYTES) &&
    matchesNormalizedString(value.messageId, 'request.messageId', MAX_IDENTITY_BYTES) &&
    matchesNormalizedUuid(value.runId, 'request.runId') &&
    Number.isSafeInteger(value.requestSeq) &&
    (value.requestSeq as number) > 0
  )
}

function isStoredExecutionCeilings(value: unknown): value is DeepChatExecutionContract['ceilings'] {
  if (
    !hasExactKeys(value, EXECUTION_CEILINGS_KEYS) ||
    !Array.isArray(value.tools) ||
    value.tools.length > MAX_EXECUTION_CONTRACT_TOOLS ||
    !isStoredWorkspace(value.workspace) ||
    !Number.isSafeInteger(value.maxSubagentDepth) ||
    (value.maxSubagentDepth as number) < 0 ||
    (value.maxSubagentDepth as number) > MAX_EXECUTION_CONTRACT_SUBAGENT_DEPTH
  ) {
    return false
  }

  let previousTargetKey: string | null = null
  const targetKeyByVisibleName = new Map<string, string>()
  for (const tool of value.tools) {
    if (
      !hasExactKeys(tool, EXECUTION_TOOL_CEILING_KEYS) ||
      !isStoredToolTarget(tool.target) ||
      !isStoredExecutionPolicy(tool.execution)
    ) {
      return false
    }
    const targetKey = buildExecutionToolTargetKey(tool.target)
    if (previousTargetKey !== null && compareCodePoints(previousTargetKey, targetKey) >= 0) {
      return false
    }
    const previousVisibleTarget = targetKeyByVisibleName.get(tool.target.providerVisibleName)
    if (previousVisibleTarget !== undefined && previousVisibleTarget !== targetKey) return false
    targetKeyByVisibleName.set(tool.target.providerVisibleName, targetKey)
    previousTargetKey = targetKey
  }
  return true
}

function isStoredDynamicControlSnapshot(
  value: unknown
): value is DeepChatExecutionDynamicControlSnapshot {
  return (
    hasExactKeys(value, DYNAMIC_CONTROL_KEYS) &&
    PERMISSION_MODES.has(value.permissionMode as PermissionMode) &&
    typeof value.requestAdmitted === 'boolean' &&
    typeof value.cancellationRequested === 'boolean'
  )
}

function isStoredExecutionProvenance(
  value: unknown,
  ceilings: DeepChatExecutionContract['ceilings']
): value is DeepChatExecutionContract['provenance'] {
  return (
    hasExactKeys(value, EXECUTION_PROVENANCE_KEYS) &&
    Array.isArray(value.promptSections) &&
    value.promptSections.length <= MAX_EXECUTION_CONTRACT_PROMPT_SECTIONS &&
    value.promptSections.every(isStoredPromptSection) &&
    matchesNormalizedString(value.providerId, 'provenance.providerId', MAX_IDENTITY_BYTES) &&
    matchesNormalizedString(value.modelId, 'provenance.modelId', MAX_IDENTITY_BYTES) &&
    isSha256(value.promptHash) &&
    isSha256(value.effectiveGenerationConfigHash) &&
    isSha256(value.providerVisibleToolDefinitionsHash) &&
    isSha256(value.internalExecutionPolicyHash) &&
    value.internalExecutionPolicyHash === hashData(ceilings, 'internal execution policy') &&
    matchesNormalizedString(
      value.assemblerVersion,
      'provenance.assemblerVersion',
      MAX_ASSEMBLER_VERSION_BYTES
    ) &&
    (value.taskContractRef === null || isDeepChatTaskContractRef(value.taskContractRef))
  )
}

export function buildEffectiveGenerationConfigHash(input: {
  modelConfig: ModelConfig
  temperature: number
  maxTokens: number
}): string {
  const modelConfig = Object.fromEntries(
    Object.entries(input.modelConfig).filter(([key]) => key !== 'conversationId')
  )
  return hashData(
    {
      modelConfig,
      temperature: requireFiniteNumber(input.temperature, 'temperature'),
      maxTokens: requirePositiveSafeInteger(input.maxTokens, 'maxTokens')
    },
    'generation config',
    true
  )
}

export function buildProviderMessagesHash(messages: readonly ChatMessage[]): string {
  return hashData(messages, 'provider messages', true)
}

export function buildProviderVisibleToolDefinitionsHash(
  definitions: readonly MCPToolDefinition[]
): string {
  return hashData(
    definitions.map((definition) => stripToolExecutionContract(definition)),
    'provider-visible tool definitions',
    true
  )
}

export function isToolEffectWithinCeiling(effect: ToolEffect, ceiling: ToolEffect): boolean {
  if ((effect !== 'read' && effect !== 'write') || (ceiling !== 'read' && ceiling !== 'write')) {
    throw new ExecutionContractError('Tool effect is invalid.', 'invalid_input')
  }
  return effect === 'read' || ceiling === 'write'
}

export function meetToolEffects(left: ToolEffect, right: ToolEffect): ToolEffect {
  return isToolEffectWithinCeiling(left, right) ? left : right
}

function executionWorkspacesMatch(
  current: DeepChatExecutionWorkspaceCeiling,
  ceiling: DeepChatExecutionWorkspaceCeiling
): boolean {
  if (current.kind === 'runtime_default' || ceiling.kind === 'runtime_default') {
    return current.kind === ceiling.kind
  }
  return workspacePathsMatch(current.path, ceiling.path)
}

function isExecutionWorkspaceWithinTaskCeiling(
  execution: DeepChatExecutionWorkspaceCeiling,
  taskCeiling: DeepChatExecutionWorkspaceCeiling
): boolean {
  if (execution.kind === 'runtime_default' || taskCeiling.kind === 'runtime_default') {
    return execution.kind === taskCeiling.kind
  }

  return isWorkspacePathWithin(execution.path, taskCeiling.path)
}

function normalizeTaskContractRef(
  context: DeepChatTaskContractContext | null | undefined,
  request: DeepChatExecutionContractRequest,
  ceilings: DeepChatExecutionContract['ceilings']
): DeepChatExecutionContract['provenance']['taskContractRef'] {
  if (context == null) return null
  if (!isDeepChatTaskContract(context.contract) || !isDeepChatTaskContractRef(context.localRef)) {
    throw new ExecutionContractError('TaskContract context is not canonical.', 'invalid_input')
  }
  if (
    context.localRef.sessionId !== request.sessionId ||
    context.localRef.contractHash !== context.contract.contractHash
  ) {
    throw new ExecutionContractError(
      'TaskContract context does not belong to the provider request Session.',
      'invalid_input'
    )
  }

  const taskCeilings = context.contract.taskHarness.ceilings
  const exceedingTool = ceilings.tools.find(
    (tool) => !isToolEffectWithinCeiling(tool.execution.effect, taskCeilings.maxToolEffect)
  )
  if (exceedingTool) {
    throw new ExecutionContractError(
      `Tool '${exceedingTool.target.providerVisibleName}' exceeds the TaskContract effect ceiling.`,
      'invalid_input'
    )
  }
  if (!isExecutionWorkspaceWithinTaskCeiling(ceilings.workspace, taskCeilings.workspace)) {
    throw new ExecutionContractError(
      'Execution workspace exceeds the TaskContract workspace ceiling.',
      'invalid_input'
    )
  }
  if (ceilings.maxSubagentDepth > taskCeilings.maxSubagentDepth) {
    throw new ExecutionContractError(
      'Execution nesting exceeds the TaskContract Subagent ceiling.',
      'invalid_input'
    )
  }

  return {
    schemaVersion: context.localRef.schemaVersion,
    sessionId: context.localRef.sessionId,
    tapeIdentity: context.localRef.tapeIdentity,
    entryId: context.localRef.entryId,
    contractHash: context.localRef.contractHash
  }
}

export function assertExecutionContractAllowsDispatch(
  contract: DeepChatExecutionContract,
  input: ExecutionContractDispatchInput
): void {
  if (!isDeepChatExecutionContract(contract)) {
    throw new ExecutionContractDispatchError(
      'Tool dispatch requires a canonical ExecutionContract with a valid hash.',
      'invalid_contract'
    )
  }
  if (
    contract.request.sessionId !== input.request.sessionId ||
    contract.request.messageId !== input.request.messageId ||
    contract.request.runId !== input.request.runId ||
    contract.request.requestSeq !== input.request.requestSeq
  ) {
    throw new ExecutionContractDispatchError(
      'ExecutionContract identity does not match the active provider View.',
      'identity_mismatch'
    )
  }

  let currentTool: DeepChatExecutionToolCeiling
  try {
    currentTool = buildExecutionToolCeiling(input.currentTool)
  } catch (error) {
    throw new ExecutionContractDispatchError(
      'Current tool authority is missing a valid stable identity or execution policy.',
      'invalid_runtime_authority',
      { cause: error }
    )
  }
  const ceiling = contract.ceilings.tools.find(
    (candidate) => candidate.target.providerVisibleName === currentTool.target.providerVisibleName
  )
  if (!ceiling) {
    throw new ExecutionContractDispatchError(
      `Tool '${currentTool.target.providerVisibleName}' is outside the frozen View ceiling.`,
      'tool_not_allowed'
    )
  }
  if (
    buildExecutionToolTargetKey(ceiling.target) !== buildExecutionToolTargetKey(currentTool.target)
  ) {
    throw new ExecutionContractDispatchError(
      `Tool '${currentTool.target.providerVisibleName}' no longer resolves to the frozen target.`,
      'target_mismatch'
    )
  }
  if (!isToolEffectWithinCeiling(currentTool.execution.effect, ceiling.execution.effect)) {
    throw new ExecutionContractDispatchError(
      `Tool '${currentTool.target.providerVisibleName}' exceeds its frozen effect ceiling.`,
      'effect_exceeds_ceiling'
    )
  }
  if (currentTool.execution.mode !== ceiling.execution.mode) {
    throw new ExecutionContractDispatchError(
      `Tool '${currentTool.target.providerVisibleName}' execution mode changed after View assembly.`,
      'execution_mode_mismatch'
    )
  }

  let currentWorkspace: DeepChatExecutionWorkspaceCeiling
  let currentMaxSubagentDepth: number
  let requestedSubagentDepth: number
  try {
    currentWorkspace = normalizeWorkspace(input.currentWorkspace)
    currentMaxSubagentDepth = requireNonNegativeSafeInteger(
      input.currentMaxSubagentDepth,
      'currentMaxSubagentDepth'
    )
    requestedSubagentDepth = requireNonNegativeSafeInteger(
      input.requestedSubagentDepth,
      'requestedSubagentDepth'
    )
  } catch (error) {
    throw new ExecutionContractDispatchError(
      'Current workspace or nesting authority is invalid.',
      'invalid_runtime_authority',
      { cause: error }
    )
  }
  if (!executionWorkspacesMatch(currentWorkspace, contract.ceilings.workspace)) {
    throw new ExecutionContractDispatchError(
      'Current workspace does not match the frozen View ceiling.',
      'workspace_mismatch'
    )
  }
  if (
    requestedSubagentDepth > contract.ceilings.maxSubagentDepth ||
    requestedSubagentDepth > currentMaxSubagentDepth
  ) {
    throw new ExecutionContractDispatchError(
      'Requested Subagent nesting exceeds the effective runtime ceiling.',
      'subagent_depth_exceeded'
    )
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested)
  }
  return Object.freeze(value)
}

function buildContractHash(contract: Omit<DeepChatExecutionContract, 'contractHash'>): string {
  return hashData(contract, 'execution contract')
}

export function buildExecutionContract(
  input: BuildExecutionContractInput
): DeepChatExecutionContract {
  if (input.promptAssembly.prompt !== resolveLeadingSystemPrompt(input.providerMessages)) {
    throw new ExecutionContractError(
      'Prompt assembly does not match the provider-visible system message.',
      'invalid_input'
    )
  }

  const tools = normalizeToolCeilings(input.tools)
  const ceilings = {
    tools,
    workspace: normalizeWorkspace(input.workspace),
    maxSubagentDepth: normalizeMaxSubagentDepth(input.maxSubagentDepth)
  }
  const request = normalizeRequest(input.request)
  const taskContractRef = normalizeTaskContractRef(input.taskContractContext, request, ceilings)
  const draft: Omit<DeepChatExecutionContract, 'contractHash'> = {
    schemaVersion: DEEPCHAT_EXECUTION_CONTRACT_SCHEMA_VERSION,
    hashVersion: DEEPCHAT_EXECUTION_CONTRACT_HASH_VERSION,
    request,
    ceilings,
    dynamicControlSnapshot: normalizeDynamicControlSnapshot(input.dynamicControlSnapshot),
    provenance: {
      promptSections: normalizePromptSections(input.promptAssembly),
      providerId: requireString(input.providerId, 'providerId', MAX_IDENTITY_BYTES),
      modelId: requireString(input.modelId, 'modelId', MAX_IDENTITY_BYTES),
      promptHash: buildProviderMessagesHash(input.providerMessages),
      effectiveGenerationConfigHash: buildEffectiveGenerationConfigHash(input),
      providerVisibleToolDefinitionsHash: buildProviderVisibleToolDefinitionsHash(input.tools),
      internalExecutionPolicyHash: hashData(ceilings, 'internal execution policy'),
      assemblerVersion: requireString(
        input.assemblerVersion,
        'assemblerVersion',
        MAX_ASSEMBLER_VERSION_BYTES
      ),
      taskContractRef
    }
  }
  const contract: DeepChatExecutionContract = {
    ...draft,
    contractHash: buildContractHash(draft)
  }
  const serialized = canonicalJsonStringifyData(contract)
  if (utf8Length(serialized) > MAX_EXECUTION_CONTRACT_BYTES) {
    throw new ExecutionContractError(
      `Execution contract exceeds ${MAX_EXECUTION_CONTRACT_BYTES} UTF-8 bytes.`,
      'limit_exceeded'
    )
  }
  return deepFreeze(contract)
}

export function verifyExecutionContractHash(contract: DeepChatExecutionContract): boolean {
  if (
    contract?.schemaVersion !== DEEPCHAT_EXECUTION_CONTRACT_SCHEMA_VERSION ||
    contract?.hashVersion !== DEEPCHAT_EXECUTION_CONTRACT_HASH_VERSION ||
    typeof contract.contractHash !== 'string' ||
    !SHA_256_PATTERN.test(contract.contractHash)
  ) {
    return false
  }
  try {
    const { contractHash, ...draft } = contract
    return buildContractHash(draft) === contractHash
  } catch {
    return false
  }
}

export function isDeepChatExecutionContract(value: unknown): value is DeepChatExecutionContract {
  try {
    const serialized = canonicalJsonStringifyData(value)
    if (
      utf8Length(serialized) > MAX_EXECUTION_CONTRACT_BYTES ||
      !hasExactKeys(value, EXECUTION_CONTRACT_KEYS) ||
      value.schemaVersion !== DEEPCHAT_EXECUTION_CONTRACT_SCHEMA_VERSION ||
      value.hashVersion !== DEEPCHAT_EXECUTION_CONTRACT_HASH_VERSION ||
      !isStoredExecutionContractRequest(value.request) ||
      !isStoredExecutionCeilings(value.ceilings) ||
      !isStoredDynamicControlSnapshot(value.dynamicControlSnapshot) ||
      !isStoredExecutionProvenance(value.provenance, value.ceilings) ||
      !isSha256(value.contractHash)
    ) {
      return false
    }
    if (
      value.provenance.taskContractRef !== null &&
      value.provenance.taskContractRef.sessionId !== value.request.sessionId
    ) {
      return false
    }
    const contract = value as unknown as DeepChatExecutionContract
    const { contractHash, ...draft } = contract
    return buildContractHash(draft) === contractHash
  } catch {
    return false
  }
}
