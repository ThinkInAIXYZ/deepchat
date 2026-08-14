import { Buffer } from 'node:buffer'
import { types as nodeTypes } from 'node:util'
import type { AgentToolExposure } from '@shared/agentTools'
import {
  TOOL_SEARCH_AGENT_TOOL_MAX_CALLS_PER_BATCH,
  TOOL_SEARCH_AGENT_TOOL_MAX_RESULTS,
  TOOL_SEARCH_AGENT_TOOL_NAME,
  TOOL_SEARCH_AGENT_TOOL_SERVER_NAME
} from '@shared/agentTools'
import type { ToolExecutionContract } from '@shared/types/core/mcp'
import type { DeepChatExecutionToolTargetIdentity } from '@shared/types/execution-contract'
import type { DeepChatTaskContractRef } from '@shared/types/task-contract'
import { canonicalJsonStringifyData, hashJsonData } from './canonicalJson'
import { buildExecutionToolTargetKey, isDetachedStoredToolTarget } from './executionContract'
import { isDeepChatTaskContractRef } from './taskContract'
import { normalizeAbsoluteWorkspacePath } from './workspacePath'

export const TAPE_TOOL_CATALOG_EVENT_NAME = 'view/tool_catalog'
export const TAPE_TOOL_SURFACE_EVENT_NAME = 'view/tool_surface'
export const TAPE_PROGRAMMATIC_TOOL_SURFACE_EVENT_NAME = 'view/programmatic_tool_surface'
export const TOOL_SURFACE_TAPE_EVENT_NAMES = [
  TAPE_TOOL_CATALOG_EVENT_NAME,
  TAPE_TOOL_SURFACE_EVENT_NAME,
  TAPE_PROGRAMMATIC_TOOL_SURFACE_EVENT_NAME
] as const
export type ToolSurfaceTapeEventName = (typeof TOOL_SURFACE_TAPE_EVENT_NAMES)[number]

export function isToolSurfaceTapeReservedName(
  name: string | null | undefined
): name is ToolSurfaceTapeEventName {
  return TOOL_SURFACE_TAPE_EVENT_NAMES.some((eventName) => eventName === name)
}

export const TAPE_TOOL_CATALOG_FACT_SCHEMA_VERSION = 1
export const TAPE_TOOL_CATALOG_FACT_HASH_VERSION = 1
export const TAPE_TOOL_CATALOG_PROJECTION_HASH_VERSION = 1
export const TAPE_TOOL_SURFACE_FACT_SCHEMA_VERSION = 2
export const TAPE_TOOL_SURFACE_FACT_HASH_VERSION = 2
export const TAPE_PROGRAMMATIC_TOOL_SURFACE_FACT_SCHEMA_VERSION = 1
export const TAPE_PROGRAMMATIC_TOOL_SURFACE_FACT_HASH_VERSION = 1
export const TAPE_PROGRAMMATIC_TOOL_SURFACE_PROJECTION_HASH_VERSION = 1
export const TAPE_PROGRAMMATIC_WORKSPACE_PATH_HASH_VERSION = 1
export const TAPE_TOOL_RESULT_PAYLOAD_HASH_VERSION = 1
export const MAX_TAPE_TOOL_CATALOG_PROJECTION_ENTRIES = 256
export const MAX_TAPE_TOOL_SURFACE_ACTIVE_ENTRIES = 256
export const MAX_TAPE_TOOL_SURFACE_SEARCH_REFS = 256
export const MAX_TAPE_TOOL_SURFACE_REJECTIONS = 256
export const MAX_TAPE_TOOL_SURFACE_DEGRADATIONS = 32
export const MAX_TAPE_PROGRAMMATIC_TOOL_CHILDREN = 64
export const MAX_TAPE_PROGRAMMATIC_TOOL_BATCH_STEPS = 64
export const MAX_TAPE_PROGRAMMATIC_TOOL_INPUT_BYTES = 4 * 1024 * 1024
export const MAX_TAPE_PROGRAMMATIC_TOOL_OUTPUT_BYTES = 16 * 1024 * 1024
export const MAX_TAPE_PROGRAMMATIC_TOOL_DURATION_MS = 30 * 60_000
export const MAX_TAPE_TOOL_FACT_BYTES = 512 * 1024
export const MAX_TAPE_TOOL_FACT_SOURCE_BYTES = 4 * 1024 * 1024

const MAX_SOURCE_CATALOG_ENTRIES = 1_024
const MAX_SOURCE_ACTIVE_ENTRIES = 1_024
const MAX_SOURCE_ACTIVATION_DECISIONS = 4_096
const MAX_IDENTITY_BYTES = 1_024
const MAX_VERSION_BYTES = 256
const MAX_PROGRAMMATIC_POLICY_VERSION_BYTES = MAX_IDENTITY_BYTES
const MAX_PLAIN_DATA_DEPTH = 64
const MAX_PLAIN_DATA_NODES = 100_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SHA_256_PATTERN = /^[a-f0-9]{64}$/
const MODEL_EXPOSURES = new Set<AgentToolExposure>(['user-configurable', 'system-model'])
const TOOL_SURFACE_ADAPTER_MODES = new Set<TapeToolSurfaceAdapterMode>([
  'direct-native',
  'native-activation',
  'cli-programmatic'
])
const SELECTION_REASONS = new Set<TapeToolSurfaceSelectionReason>([
  'full-catalog',
  'policy-required',
  'core',
  'active-skill',
  'recent',
  'search-result',
  'tool-search'
])
const REJECTION_CODES = new Set<TapeToolSurfaceActivationRejectionCode>([
  'ineligible',
  'definition-drift',
  'per-batch-count-cap',
  'per-batch-token-cap',
  'per-run-batch-cap',
  'per-run-target-cap',
  'total-surface-count-cap',
  'total-surface-token-cap'
])
const CATALOG_DEGRADATIONS = new Set<TapeToolCatalogDegradationCode>([
  'catalog-projection-count-limited',
  'catalog-projection-byte-limited'
])
const SURFACE_DEGRADATIONS = new Set<TapeToolSurfaceDegradationCode>([
  'active-projection-count-limited',
  'active-projection-byte-limited',
  'search-refs-truncated',
  'candidate-rejections-truncated'
])
const PROGRAMMATIC_DEGRADATIONS = new Set<TapeProgrammaticToolSurfaceDegradationCode>([
  'programmatic-projection-count-limited',
  'programmatic-projection-byte-limited'
])

export type TapeToolCatalogDegradationCode =
  | 'catalog-projection-count-limited'
  | 'catalog-projection-byte-limited'

export type TapeToolSurfaceDegradationCode =
  | 'active-projection-count-limited'
  | 'active-projection-byte-limited'
  | 'search-refs-truncated'
  | 'candidate-rejections-truncated'

export type TapeProgrammaticToolSurfaceDegradationCode =
  | 'programmatic-projection-count-limited'
  | 'programmatic-projection-byte-limited'

export type TapeToolSurfaceAdapterMode = 'direct-native' | 'native-activation' | 'cli-programmatic'

export type TapeToolSurfaceSelectionReason =
  | 'full-catalog'
  | 'policy-required'
  | 'core'
  | 'active-skill'
  | 'recent'
  | 'search-result'
  | 'tool-search'

export type TapeToolSurfaceActivationRejectionCode =
  | 'ineligible'
  | 'definition-drift'
  | 'per-batch-count-cap'
  | 'per-batch-token-cap'
  | 'per-run-batch-cap'
  | 'per-run-target-cap'
  | 'total-surface-count-cap'
  | 'total-surface-token-cap'

export interface TapeToolCatalogSourceEntry {
  readonly target: DeepChatExecutionToolTargetIdentity
  readonly stableTargetKey: string
  readonly canonicalToolDefinitionHash: string
  readonly exposure: Extract<AgentToolExposure, 'user-configurable' | 'system-model'>
  readonly execution: ToolExecutionContract
}

export interface TapeToolCatalogFact {
  readonly schemaVersion: typeof TAPE_TOOL_CATALOG_FACT_SCHEMA_VERSION
  readonly catalogFactHashVersion: typeof TAPE_TOOL_CATALOG_FACT_HASH_VERSION
  readonly catalogSchemaVersion: 1
  readonly projectionHashVersion: typeof TAPE_TOOL_CATALOG_PROJECTION_HASH_VERSION
  readonly canonicalizationVersion: string
  readonly fullCatalogHash: string
  readonly catalogProjectionHash: string
  readonly catalogFactHash: string
  readonly totalEntryCount: number
  readonly retainedEntryCount: number
  readonly entries: readonly TapeToolCatalogSourceEntry[]
  readonly degradations: readonly TapeToolCatalogDegradationCode[]
}

export interface TapeToolSurfaceRequestIdentity {
  readonly sessionId: string
  readonly messageId: string
  readonly runId: string
  readonly requestSeq: number
}

export interface TapeToolCatalogFactReference {
  readonly sessionId: string
  readonly tapeIncarnationId: string
  readonly entryId: number
  readonly fullCatalogHash: string
  readonly catalogFactHash: string
}

export interface TapeToolSurfaceActiveEntry extends TapeToolCatalogSourceEntry {
  readonly activationOrdinal: number
  readonly reason: TapeToolSurfaceSelectionReason
}

export interface TapeToolSurfaceSearchResultRef {
  readonly originRequestSeq: number
  readonly toolCallOrdinalWithinBatch: number
  readonly resultRank: number
  readonly stableTargetKey: string
  readonly canonicalToolDefinitionHash: string
  readonly toolResult: TapeToolResultFactReference
}

export interface TapeToolResultFactReference {
  readonly sessionId: string
  readonly tapeIncarnationId: string
  readonly entryId: number
  readonly payloadHashVersion: typeof TAPE_TOOL_RESULT_PAYLOAD_HASH_VERSION
  readonly payloadHash: string
}

export interface TapeToolSurfaceCandidateRejection extends TapeToolSurfaceSearchResultRef {
  readonly rejectionCode: TapeToolSurfaceActivationRejectionCode
}

export interface TapeToolSurfaceBudgetObservation {
  readonly eligibleToolCount: number
  readonly activeToolCount: number
  readonly eligibleDefinitionTokens: number
  readonly activeDefinitionTokens: number
}

interface TapeToolSurfaceFactBase {
  readonly canonicalizationVersion: string
  readonly orderingVersion: string
  readonly surfaceHash: string
  readonly request: TapeToolSurfaceRequestIdentity
  readonly manifestHash: string
  readonly catalog: TapeToolCatalogFactReference
  readonly policyVersion: string
  readonly virtualizationTriggered: boolean
  readonly contractBearing: boolean
  readonly activeEntryCount: number
  readonly retainedActiveEntryCount: number
  readonly activeEntries: readonly TapeToolSurfaceActiveEntry[]
  readonly budget: TapeToolSurfaceBudgetObservation
  readonly searchResultRefCount: number
  readonly searchResultRefs: readonly TapeToolSurfaceSearchResultRef[]
  readonly candidateRejectionCount: number
  readonly candidateRejections: readonly TapeToolSurfaceCandidateRejection[]
  readonly degradations: readonly TapeToolSurfaceDegradationCode[]
}

export interface TapeToolSurfaceFactV1 extends TapeToolSurfaceFactBase {
  readonly schemaVersion: 1
  readonly surfaceHashVersion: 1
}

export interface TapeToolSurfaceFactV2 extends TapeToolSurfaceFactBase {
  readonly schemaVersion: typeof TAPE_TOOL_SURFACE_FACT_SCHEMA_VERSION
  readonly surfaceHashVersion: typeof TAPE_TOOL_SURFACE_FACT_HASH_VERSION
  readonly adapterMode: TapeToolSurfaceAdapterMode
}

export type TapeToolSurfaceFact = TapeToolSurfaceFactV1 | TapeToolSurfaceFactV2

export interface CreateTapeToolCatalogFactInput {
  readonly catalogSchemaVersion: 1
  readonly canonicalizationVersion: string
  readonly fullCatalogHash: string
  readonly entries: readonly TapeToolCatalogSourceEntry[]
}

export interface CreateTapeToolSurfaceFactInput {
  readonly request: TapeToolSurfaceRequestIdentity
  readonly manifestHash: string
  readonly catalog: TapeToolCatalogFactReference
  readonly canonicalizationVersion: string
  readonly orderingVersion: string
  readonly policyVersion: string
  readonly adapterMode: TapeToolSurfaceAdapterMode
  readonly virtualizationTriggered: boolean
  readonly contractBearing: boolean
  readonly activeEntries: readonly TapeToolSurfaceActiveEntry[]
  readonly budget: TapeToolSurfaceBudgetObservation
  readonly searchResultRefs?: readonly TapeToolSurfaceSearchResultRef[]
  readonly candidateRejections?: readonly TapeToolSurfaceCandidateRejection[]
}

export type TapeProgrammaticWorkspaceCeiling =
  | { readonly kind: 'runtime_default' }
  | {
      readonly kind: 'path'
      readonly pathHashVersion: typeof TAPE_PROGRAMMATIC_WORKSPACE_PATH_HASH_VERSION
      readonly pathHash: string
    }

export interface TapeProgrammaticToolSurfaceCeilings {
  readonly maxToolEffect: 'read' | 'write'
  readonly workspace: TapeProgrammaticWorkspaceCeiling
  readonly maxSubagentDepth: 0 | 1
}

export interface TapeProgrammaticToolSurfaceQuotas {
  readonly maxChildren: number
  readonly maxBatchSteps: number
  readonly maxInputBytes: number
  readonly maxOutputBytes: number
  readonly maxDurationMs: number
}

export interface TapeProgrammaticToolSurfaceFact {
  readonly schemaVersion: typeof TAPE_PROGRAMMATIC_TOOL_SURFACE_FACT_SCHEMA_VERSION
  readonly factHashVersion: typeof TAPE_PROGRAMMATIC_TOOL_SURFACE_FACT_HASH_VERSION
  readonly capabilitySchemaVersion: 1
  readonly capabilityHashVersion: 1
  readonly capabilityHash: string
  readonly programmaticSurfaceSchemaVersion: 1
  readonly programmaticSurfaceHashVersion: 1
  readonly programmaticSurfaceHash: string
  readonly projectionHashVersion: typeof TAPE_PROGRAMMATIC_TOOL_SURFACE_PROJECTION_HASH_VERSION
  readonly projectionHash: string
  readonly canonicalizationVersion: string
  readonly policyVersion: string
  readonly adapterMode: 'cli-programmatic'
  readonly request: TapeToolSurfaceRequestIdentity
  readonly manifestHash: string
  readonly catalog: TapeToolCatalogFactReference
  readonly contractBearing: boolean
  readonly totalEntryCount: number
  readonly retainedEntryCount: number
  readonly entries: readonly TapeToolCatalogSourceEntry[]
  readonly taskContractRef: DeepChatTaskContractRef | null
  readonly ceilings: TapeProgrammaticToolSurfaceCeilings
  readonly quotas: TapeProgrammaticToolSurfaceQuotas
  readonly degradations: readonly TapeProgrammaticToolSurfaceDegradationCode[]
  readonly factHash: string
}

export interface CreateTapeProgrammaticToolSurfaceFactInput {
  readonly capabilitySchemaVersion: 1
  readonly capabilityHashVersion: 1
  readonly capabilityHash: string
  readonly programmaticSurfaceSchemaVersion: 1
  readonly programmaticSurfaceHashVersion: 1
  readonly programmaticSurfaceHash: string
  readonly canonicalizationVersion: string
  readonly policyVersion: string
  readonly adapterMode: 'cli-programmatic'
  readonly request: TapeToolSurfaceRequestIdentity
  readonly manifestHash: string
  readonly catalog: TapeToolCatalogFactReference
  readonly contractBearing: boolean
  readonly entries: readonly TapeToolCatalogSourceEntry[]
  readonly taskContractRef: DeepChatTaskContractRef | null
  readonly ceilings: TapeProgrammaticToolSurfaceCeilings
  readonly quotas: TapeProgrammaticToolSurfaceQuotas
}

export interface ProgrammaticToolSurfaceHashInputV1 {
  readonly schemaVersion: 1
  readonly canonicalizationVersion: string
  readonly catalogHash: string
  readonly entries: readonly Pick<
    TapeToolCatalogSourceEntry,
    'target' | 'stableTargetKey' | 'canonicalToolDefinitionHash' | 'execution'
  >[]
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.length && keys.every((key) => actualKeys.includes(key))
}

// JavaScript has no bounded own-key enumeration primitive. These limits bound accepted detached
// data and all work after reflection; rejecting a pre-existing hostile object remains linear in the
// number of its own properties. Callers must not expose this in-process predicate as a remote parser.
function assertBoundedProxyFreePlainData(value: unknown, maxBytes: number): void {
  type Visit = { kind: 'enter'; value: unknown; depth: number } | { kind: 'exit'; value: object }

  const ancestors = new Set<object>()
  const stack: Visit[] = [{ kind: 'enter', value, depth: 0 }]
  let nodes = 0
  let minimumBytes = 0
  while (stack.length > 0) {
    const visit = stack.pop() as Visit
    if (visit.kind === 'exit') {
      ancestors.delete(visit.value)
      continue
    }
    nodes += 1
    if (nodes > MAX_PLAIN_DATA_NODES || visit.depth > MAX_PLAIN_DATA_DEPTH) {
      throw new TypeError('Tool fact input exceeds its structure limit.')
    }
    const current = visit.value
    if (current === null || typeof current === 'boolean') {
      minimumBytes += current === null ? 4 : current ? 4 : 5
      continue
    }
    if (typeof current === 'number' && Number.isFinite(current)) {
      minimumBytes += String(current).length
      continue
    }
    if (typeof current === 'string') {
      minimumBytes += Buffer.byteLength(current, 'utf8') + 2
      if (minimumBytes > maxBytes) {
        throw new TypeError('Tool fact input exceeds its canonical byte limit.')
      }
      continue
    }
    if (!current || typeof current !== 'object' || nodeTypes.isProxy(current)) {
      throw new TypeError('Tool fact input contains a non-plain JSON value.')
    }
    if (ancestors.has(current)) {
      throw new TypeError('Tool fact input contains a circular reference.')
    }
    const isArray = Array.isArray(current)
    const prototype = Object.getPrototypeOf(current)
    if (!isArray && prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Tool fact input contains a non-plain object.')
    }
    if (Object.getOwnPropertySymbols(current).length > 0) {
      throw new TypeError('Tool fact input contains a symbol property.')
    }
    const names = Object.getOwnPropertyNames(current)
    const itemNames = isArray ? names.filter((name) => name !== 'length') : names
    if (
      (isArray && itemNames.length !== current.length) ||
      nodes + itemNames.length > MAX_PLAIN_DATA_NODES
    ) {
      throw new TypeError('Tool fact input exceeds its structure limit.')
    }
    minimumBytes += 2
    ancestors.add(current)
    stack.push({ kind: 'exit', value: current })
    for (let index = itemNames.length - 1; index >= 0; index -= 1) {
      const name = itemNames[index]
      const descriptor = Object.getOwnPropertyDescriptor(current, name)
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new TypeError('Tool fact input contains a non-data property.')
      }
      if (!isArray) minimumBytes += Buffer.byteLength(name, 'utf8') + 3
      if (minimumBytes > maxBytes) {
        throw new TypeError('Tool fact input exceeds its canonical byte limit.')
      }
      stack.push({ kind: 'enter', value: descriptor.value, depth: visit.depth + 1 })
    }
  }
}

function detachBoundedPlainData<T>(value: T, maxBytes: number): T {
  assertBoundedProxyFreePlainData(value, maxBytes)
  const serialized = canonicalJsonStringifyData(value)
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new TypeError('Tool fact input exceeds its canonical byte limit.')
  }
  return JSON.parse(serialized) as T
}

function isBoundedString(value: unknown, maxBytes = MAX_IDENTITY_BYTES): value is string {
  return (
    typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= maxBytes
  )
}

function isNormalizedBoundedString(value: unknown, maxBytes = MAX_IDENTITY_BYTES): value is string {
  return isBoundedString(value, maxBytes) && value === value.trim() && !value.includes('\0')
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && SHA_256_PATTERN.test(value)
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function isToolSurfaceAdapterMode(value: unknown): value is TapeToolSurfaceAdapterMode {
  return (
    typeof value === 'string' && TOOL_SURFACE_ADAPTER_MODES.has(value as TapeToolSurfaceAdapterMode)
  )
}

function isStableTargetKey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    const target: unknown = JSON.parse(value)
    return isDetachedStoredToolTarget(target) && buildExecutionToolTargetKey(target) === value
  } catch {
    return false
  }
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isExecution(value: unknown): value is ToolExecutionContract {
  if (!isPlainRecord(value)) return false
  if (!hasExactKeys(value, ['effect', 'mode'])) return false
  return (
    (value.effect === 'read' && (value.mode === 'sequential' || value.mode === 'parallel')) ||
    (value.effect === 'write' && value.mode === 'sequential')
  )
}

function hasValidCatalogEntryFields(value: unknown): value is TapeToolCatalogSourceEntry {
  if (!isPlainRecord(value) || !isDetachedStoredToolTarget(value.target)) return false
  return (
    isStableTargetKey(value.stableTargetKey) &&
    value.stableTargetKey === buildExecutionToolTargetKey(value.target) &&
    isHash(value.canonicalToolDefinitionHash) &&
    MODEL_EXPOSURES.has(value.exposure as AgentToolExposure) &&
    isExecution(value.execution)
  )
}

function isCatalogEntry(value: unknown): value is TapeToolCatalogSourceEntry {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, [
      'target',
      'stableTargetKey',
      'canonicalToolDefinitionHash',
      'exposure',
      'execution'
    ]) &&
    hasValidCatalogEntryFields(value)
  )
}

function cloneCatalogEntryFields(entry: TapeToolCatalogSourceEntry): TapeToolCatalogSourceEntry {
  return {
    target: { ...entry.target },
    stableTargetKey: entry.stableTargetKey,
    canonicalToolDefinitionHash: entry.canonicalToolDefinitionHash,
    exposure: entry.exposure,
    execution: { ...entry.execution }
  }
}

function cloneCatalogEntry(entry: TapeToolCatalogSourceEntry): TapeToolCatalogSourceEntry {
  if (!isCatalogEntry(entry)) {
    throw new TypeError('Tool catalog fact contains an invalid entry.')
  }
  return cloneCatalogEntryFields(entry)
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function catalogProjectionHash(input: {
  fullCatalogHash: string
  totalEntryCount: number
  entries: readonly TapeToolCatalogSourceEntry[]
}): string {
  return hashJsonData({
    projectionHashVersion: TAPE_TOOL_CATALOG_PROJECTION_HASH_VERSION,
    fullCatalogHash: input.fullCatalogHash,
    totalEntryCount: input.totalEntryCount,
    entries: input.entries
  })
}

function catalogFactHash(fact: Omit<TapeToolCatalogFact, 'catalogFactHash'>): string {
  return hashJsonData(fact)
}

function fullCatalogHash(input: {
  catalogSchemaVersion: 1
  canonicalizationVersion: string
  entries: readonly TapeToolCatalogSourceEntry[]
}): string {
  return hashJsonData({
    schemaVersion: input.catalogSchemaVersion,
    canonicalizationVersion: input.canonicalizationVersion,
    entries: input.entries.map((entry) => ({
      target: entry.target,
      canonicalToolDefinitionHash: entry.canonicalToolDefinitionHash,
      exposure: entry.exposure,
      execution: entry.execution
    }))
  })
}

function catalogDegradations(
  totalEntryCount: number,
  retainedEntryCount: number
): TapeToolCatalogDegradationCode[] {
  const degradations: TapeToolCatalogDegradationCode[] = []
  if (totalEntryCount > MAX_TAPE_TOOL_CATALOG_PROJECTION_ENTRIES) {
    degradations.push('catalog-projection-count-limited')
  }
  if (retainedEntryCount < Math.min(totalEntryCount, MAX_TAPE_TOOL_CATALOG_PROJECTION_ENTRIES)) {
    degradations.push('catalog-projection-byte-limited')
  }
  return degradations
}

function buildCatalogFactDraft(input: {
  catalogSchemaVersion: 1
  canonicalizationVersion: string
  fullCatalogHash: string
  totalEntryCount: number
  entries: readonly TapeToolCatalogSourceEntry[]
  degradations: readonly TapeToolCatalogDegradationCode[]
}): TapeToolCatalogFact {
  const withoutFactHash = {
    schemaVersion: TAPE_TOOL_CATALOG_FACT_SCHEMA_VERSION,
    catalogFactHashVersion: TAPE_TOOL_CATALOG_FACT_HASH_VERSION,
    catalogSchemaVersion: input.catalogSchemaVersion,
    projectionHashVersion: TAPE_TOOL_CATALOG_PROJECTION_HASH_VERSION,
    canonicalizationVersion: input.canonicalizationVersion,
    fullCatalogHash: input.fullCatalogHash,
    catalogProjectionHash: catalogProjectionHash(input),
    totalEntryCount: input.totalEntryCount,
    retainedEntryCount: input.entries.length,
    entries: input.entries,
    degradations: input.degradations
  } satisfies Omit<TapeToolCatalogFact, 'catalogFactHash'>
  return {
    ...withoutFactHash,
    catalogFactHash: catalogFactHash(withoutFactHash)
  }
}

function canonicalBytes(value: unknown): number {
  return Buffer.byteLength(canonicalJsonStringifyData(value), 'utf8')
}

function findLargestFittingPrefix(maximum: number, build: (length: number) => unknown): number {
  let lower = 0
  let upper = maximum
  while (lower < upper) {
    const midpoint = Math.ceil((lower + upper) / 2)
    if (canonicalBytes(build(midpoint)) <= MAX_TAPE_TOOL_FACT_BYTES) {
      lower = midpoint
    } else {
      upper = midpoint - 1
    }
  }
  return lower
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  return Object.freeze(value)
}

export function createTapeToolCatalogFact(
  input: CreateTapeToolCatalogFactInput
): TapeToolCatalogFact {
  return createTapeToolCatalogFactFromData(
    detachBoundedPlainData(input, MAX_TAPE_TOOL_FACT_SOURCE_BYTES)
  )
}

function createTapeToolCatalogFactFromData(
  input: CreateTapeToolCatalogFactInput
): TapeToolCatalogFact {
  if (
    input.catalogSchemaVersion !== 1 ||
    !isBoundedString(input.canonicalizationVersion, MAX_VERSION_BYTES) ||
    !isHash(input.fullCatalogHash) ||
    !Array.isArray(input.entries) ||
    input.entries.length > MAX_SOURCE_CATALOG_ENTRIES
  ) {
    throw new TypeError('Tool catalog fact input is invalid.')
  }

  const entries = input.entries
    .map(cloneCatalogEntry)
    .sort((left, right) => compareCodePoints(left.stableTargetKey, right.stableTargetKey))
  const targetByVisibleName = new Map<string, string>()
  for (let index = 0; index < entries.length; index += 1) {
    if (index > 0 && entries[index - 1].stableTargetKey === entries[index].stableTargetKey) {
      throw new TypeError('Tool catalog fact contains a duplicate stable target.')
    }
    const entry = entries[index]
    const previousTarget = targetByVisibleName.get(entry.target.providerVisibleName)
    if (previousTarget !== undefined && previousTarget !== entry.stableTargetKey) {
      throw new TypeError('Tool catalog fact contains a conflicting provider-visible name.')
    }
    targetByVisibleName.set(entry.target.providerVisibleName, entry.stableTargetKey)
  }
  const expectedFullCatalogHash = fullCatalogHash({
    ...input,
    entries
  })
  if (expectedFullCatalogHash !== input.fullCatalogHash) {
    throw new TypeError('Tool catalog fact does not match its full catalog hash.')
  }

  const maximumRetainedCount = Math.min(entries.length, MAX_TAPE_TOOL_CATALOG_PROJECTION_ENTRIES)
  const buildWithRetainedCount = (retainedEntryCount: number): TapeToolCatalogFact =>
    buildCatalogFactDraft({
      ...input,
      totalEntryCount: entries.length,
      entries: entries.slice(0, retainedEntryCount),
      degradations: catalogDegradations(entries.length, retainedEntryCount)
    })
  const retainedEntryCount = findLargestFittingPrefix(maximumRetainedCount, buildWithRetainedCount)
  const fact = buildWithRetainedCount(retainedEntryCount)
  if (canonicalBytes(fact) > MAX_TAPE_TOOL_FACT_BYTES) {
    throw new TypeError('Tool catalog fact exceeds its canonical byte limit.')
  }
  return deepFreeze(fact)
}

function isCatalogFactShape(value: unknown): value is TapeToolCatalogFact {
  if (!isPlainRecord(value)) return false
  if (
    !hasExactKeys(value, [
      'schemaVersion',
      'catalogFactHashVersion',
      'catalogSchemaVersion',
      'projectionHashVersion',
      'canonicalizationVersion',
      'fullCatalogHash',
      'catalogProjectionHash',
      'totalEntryCount',
      'retainedEntryCount',
      'entries',
      'degradations',
      'catalogFactHash'
    ]) ||
    value.schemaVersion !== TAPE_TOOL_CATALOG_FACT_SCHEMA_VERSION ||
    value.catalogFactHashVersion !== TAPE_TOOL_CATALOG_FACT_HASH_VERSION ||
    value.catalogSchemaVersion !== 1 ||
    value.projectionHashVersion !== TAPE_TOOL_CATALOG_PROJECTION_HASH_VERSION ||
    !isBoundedString(value.canonicalizationVersion, MAX_VERSION_BYTES) ||
    !isHash(value.fullCatalogHash) ||
    !isHash(value.catalogProjectionHash) ||
    !isHash(value.catalogFactHash) ||
    !isNonNegativeSafeInteger(value.totalEntryCount) ||
    value.totalEntryCount > MAX_SOURCE_CATALOG_ENTRIES ||
    !isNonNegativeSafeInteger(value.retainedEntryCount) ||
    !Array.isArray(value.entries) ||
    value.entries.length !== value.retainedEntryCount ||
    value.retainedEntryCount > value.totalEntryCount ||
    value.retainedEntryCount > MAX_TAPE_TOOL_CATALOG_PROJECTION_ENTRIES ||
    !value.entries.every(isCatalogEntry) ||
    !Array.isArray(value.degradations) ||
    value.degradations.length > MAX_TAPE_TOOL_SURFACE_DEGRADATIONS ||
    !value.degradations.every((code) => CATALOG_DEGRADATIONS.has(code))
  ) {
    return false
  }
  const expectedDegradations = catalogDegradations(value.totalEntryCount, value.retainedEntryCount)
  if (
    canonicalJsonStringifyData(value.degradations) !==
    canonicalJsonStringifyData(expectedDegradations)
  ) {
    return false
  }
  const targetByVisibleName = new Map<string, string>()
  for (let index = 0; index < value.entries.length; index += 1) {
    if (
      index > 0 &&
      compareCodePoints(
        value.entries[index - 1].stableTargetKey,
        value.entries[index].stableTargetKey
      ) >= 0
    ) {
      return false
    }
    const entry = value.entries[index]
    const previousTarget = targetByVisibleName.get(entry.target.providerVisibleName)
    if (previousTarget !== undefined && previousTarget !== entry.stableTargetKey) return false
    targetByVisibleName.set(entry.target.providerVisibleName, entry.stableTargetKey)
  }
  return true
}

export function verifyTapeToolCatalogFact(fact: unknown): fact is TapeToolCatalogFact {
  try {
    const detached = detachBoundedPlainData(fact, MAX_TAPE_TOOL_FACT_BYTES)
    if (!isCatalogFactShape(detached)) return false
    const projectionHash = catalogProjectionHash({
      fullCatalogHash: detached.fullCatalogHash,
      totalEntryCount: detached.totalEntryCount,
      entries: detached.entries
    })
    if (projectionHash !== detached.catalogProjectionHash) return false
    if (
      detached.retainedEntryCount === detached.totalEntryCount &&
      fullCatalogHash({
        catalogSchemaVersion: detached.catalogSchemaVersion,
        canonicalizationVersion: detached.canonicalizationVersion,
        entries: detached.entries
      }) !== detached.fullCatalogHash
    ) {
      return false
    }
    const { catalogFactHash: persistedFactHash, ...withoutFactHash } = detached
    return catalogFactHash(withoutFactHash) === persistedFactHash
  } catch {
    return false
  }
}

function isRequestIdentity(value: unknown): value is TapeToolSurfaceRequestIdentity {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, ['sessionId', 'messageId', 'runId', 'requestSeq']) &&
    isNormalizedBoundedString(value.sessionId) &&
    isNormalizedBoundedString(value.messageId) &&
    isNormalizedBoundedString(value.runId) &&
    isPositiveSafeInteger(value.requestSeq)
  )
}

function isCatalogReference(value: unknown): value is TapeToolCatalogFactReference {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, [
      'sessionId',
      'tapeIncarnationId',
      'entryId',
      'fullCatalogHash',
      'catalogFactHash'
    ]) &&
    isNormalizedBoundedString(value.sessionId) &&
    isUuid(value.tapeIncarnationId) &&
    isPositiveSafeInteger(value.entryId) &&
    isHash(value.fullCatalogHash) &&
    isHash(value.catalogFactHash)
  )
}

function isToolResultFactReference(value: unknown): value is TapeToolResultFactReference {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, [
      'sessionId',
      'tapeIncarnationId',
      'entryId',
      'payloadHashVersion',
      'payloadHash'
    ]) &&
    isNormalizedBoundedString(value.sessionId) &&
    isUuid(value.tapeIncarnationId) &&
    isPositiveSafeInteger(value.entryId) &&
    value.payloadHashVersion === TAPE_TOOL_RESULT_PAYLOAD_HASH_VERSION &&
    isHash(value.payloadHash)
  )
}

export function buildTapeToolResultPayloadHash(payload: unknown): string {
  return hashJsonData({
    hashVersion: TAPE_TOOL_RESULT_PAYLOAD_HASH_VERSION,
    payload: detachBoundedPlainData(payload, MAX_TAPE_TOOL_FACT_SOURCE_BYTES)
  })
}

function isActiveEntry(value: unknown): value is TapeToolSurfaceActiveEntry {
  const entry = value as Partial<TapeToolSurfaceActiveEntry>
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, [
      'target',
      'stableTargetKey',
      'canonicalToolDefinitionHash',
      'exposure',
      'execution',
      'activationOrdinal',
      'reason'
    ]) &&
    hasValidCatalogEntryFields(value) &&
    isNonNegativeSafeInteger(entry.activationOrdinal) &&
    SELECTION_REASONS.has(entry.reason as TapeToolSurfaceSelectionReason)
  )
}

function isSearchRef(value: unknown): value is TapeToolSurfaceSearchResultRef {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, [
      'originRequestSeq',
      'toolCallOrdinalWithinBatch',
      'resultRank',
      'stableTargetKey',
      'canonicalToolDefinitionHash',
      'toolResult'
    ]) &&
    isPositiveSafeInteger(value.originRequestSeq) &&
    isNonNegativeSafeInteger(value.toolCallOrdinalWithinBatch) &&
    isNonNegativeSafeInteger(value.resultRank) &&
    isStableTargetKey(value.stableTargetKey) &&
    isHash(value.canonicalToolDefinitionHash) &&
    isToolResultFactReference(value.toolResult)
  )
}

function isCandidateRejection(value: unknown): value is TapeToolSurfaceCandidateRejection {
  const rejection = value as Partial<TapeToolSurfaceCandidateRejection>
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, [
      'originRequestSeq',
      'toolCallOrdinalWithinBatch',
      'resultRank',
      'stableTargetKey',
      'canonicalToolDefinitionHash',
      'toolResult',
      'rejectionCode'
    ]) &&
    isPositiveSafeInteger(value.originRequestSeq) &&
    isNonNegativeSafeInteger(value.toolCallOrdinalWithinBatch) &&
    isNonNegativeSafeInteger(value.resultRank) &&
    isStableTargetKey(value.stableTargetKey) &&
    isHash(value.canonicalToolDefinitionHash) &&
    isToolResultFactReference(value.toolResult) &&
    REJECTION_CODES.has(rejection.rejectionCode as TapeToolSurfaceActivationRejectionCode)
  )
}

function isBudget(value: unknown): value is TapeToolSurfaceBudgetObservation {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, [
      'eligibleToolCount',
      'activeToolCount',
      'eligibleDefinitionTokens',
      'activeDefinitionTokens'
    ]) &&
    isNonNegativeSafeInteger(value.eligibleToolCount) &&
    isNonNegativeSafeInteger(value.activeToolCount) &&
    isNonNegativeSafeInteger(value.eligibleDefinitionTokens) &&
    isNonNegativeSafeInteger(value.activeDefinitionTokens)
  )
}

function cloneActiveEntry(entry: TapeToolSurfaceActiveEntry): TapeToolSurfaceActiveEntry {
  if (!isActiveEntry(entry))
    throw new TypeError('Tool surface fact contains an invalid active entry.')
  return {
    ...cloneCatalogEntryFields(entry),
    activationOrdinal: entry.activationOrdinal,
    reason: entry.reason
  }
}

function cloneSearchRef(ref: TapeToolSurfaceSearchResultRef): TapeToolSurfaceSearchResultRef {
  if (!isSearchRef(ref)) throw new TypeError('Tool surface fact contains an invalid search ref.')
  return { ...ref, toolResult: { ...ref.toolResult } }
}

function cloneCandidateRejection(
  rejection: TapeToolSurfaceCandidateRejection
): TapeToolSurfaceCandidateRejection {
  if (!isCandidateRejection(rejection)) {
    throw new TypeError('Tool surface fact contains an invalid candidate rejection.')
  }
  return { ...rejection, toolResult: { ...rejection.toolResult } }
}

function surfaceFactHash(fact: object): string {
  return hashJsonData(fact)
}

function buildSurfaceFactDraft(input: {
  request: TapeToolSurfaceRequestIdentity
  manifestHash: string
  catalog: TapeToolCatalogFactReference
  canonicalizationVersion: string
  orderingVersion: string
  policyVersion: string
  adapterMode: TapeToolSurfaceAdapterMode
  virtualizationTriggered: boolean
  contractBearing: boolean
  activeEntryCount: number
  activeEntries: readonly TapeToolSurfaceActiveEntry[]
  budget: TapeToolSurfaceBudgetObservation
  searchResultRefCount: number
  searchResultRefs: readonly TapeToolSurfaceSearchResultRef[]
  candidateRejectionCount: number
  candidateRejections: readonly TapeToolSurfaceCandidateRejection[]
  degradations: readonly TapeToolSurfaceDegradationCode[]
}): TapeToolSurfaceFactV2 {
  const withoutSurfaceHash = {
    schemaVersion: TAPE_TOOL_SURFACE_FACT_SCHEMA_VERSION,
    surfaceHashVersion: TAPE_TOOL_SURFACE_FACT_HASH_VERSION,
    canonicalizationVersion: input.canonicalizationVersion,
    orderingVersion: input.orderingVersion,
    request: input.request,
    manifestHash: input.manifestHash,
    catalog: input.catalog,
    policyVersion: input.policyVersion,
    adapterMode: input.adapterMode,
    virtualizationTriggered: input.virtualizationTriggered,
    contractBearing: input.contractBearing,
    activeEntryCount: input.activeEntryCount,
    retainedActiveEntryCount: input.activeEntries.length,
    activeEntries: input.activeEntries,
    budget: input.budget,
    searchResultRefCount: input.searchResultRefCount,
    searchResultRefs: input.searchResultRefs,
    candidateRejectionCount: input.candidateRejectionCount,
    candidateRejections: input.candidateRejections,
    degradations: input.degradations
  } satisfies Omit<TapeToolSurfaceFactV2, 'surfaceHash'>
  return {
    ...withoutSurfaceHash,
    surfaceHash: surfaceFactHash(withoutSurfaceHash)
  }
}

function validateActiveEntryOrder(entries: readonly TapeToolSurfaceActiveEntry[]): void {
  const targets = new Set<string>()
  const targetByVisibleName = new Map<string, string>()
  let previousOrdinal = -1
  for (const entry of entries) {
    const previousTarget = targetByVisibleName.get(entry.target.providerVisibleName)
    if (targets.has(entry.stableTargetKey) || entry.activationOrdinal <= previousOrdinal) {
      throw new TypeError('Tool surface active entries are duplicated or out of order.')
    }
    if (previousTarget !== undefined && previousTarget !== entry.stableTargetKey) {
      throw new TypeError('Tool surface contains a conflicting provider-visible name.')
    }
    targets.add(entry.stableTargetKey)
    targetByVisibleName.set(entry.target.providerVisibleName, entry.stableTargetKey)
    previousOrdinal = entry.activationOrdinal
  }
}

function isToolSearchActiveEntry(entry: TapeToolSurfaceActiveEntry): boolean {
  return (
    entry.target.source === 'agent' &&
    entry.target.providerVisibleName === TOOL_SEARCH_AGENT_TOOL_NAME &&
    entry.target.serverName === TOOL_SEARCH_AGENT_TOOL_SERVER_NAME &&
    entry.target.serverId === null &&
    entry.target.configGeneration === null &&
    entry.target.bindingHash === null &&
    entry.target.originalName === TOOL_SEARCH_AGENT_TOOL_NAME &&
    entry.exposure === 'system-model' &&
    entry.execution.effect === 'read' &&
    entry.execution.mode === 'parallel' &&
    entry.reason === 'tool-search'
  )
}

export function isCanonicalAgentExecToolSurfaceEntry(
  entry: TapeToolCatalogSourceEntry | TapeToolSurfaceActiveEntry
): boolean {
  return (
    entry.target.source === 'agent' &&
    entry.target.providerVisibleName === 'exec' &&
    entry.target.serverName === 'agent-filesystem' &&
    entry.target.serverId === null &&
    entry.target.configGeneration === null &&
    entry.target.bindingHash === null &&
    entry.target.originalName === 'exec' &&
    entry.exposure === 'user-configurable' &&
    entry.execution.effect === 'write' &&
    entry.execution.mode === 'sequential'
  )
}

function validateToolSearchPresence(
  adapterMode: TapeToolSurfaceAdapterMode,
  activeEntries: readonly TapeToolSurfaceActiveEntry[]
): void {
  const reservedNameEntries = activeEntries.filter(
    (entry) =>
      entry.target.providerVisibleName === TOOL_SEARCH_AGENT_TOOL_NAME ||
      entry.reason === 'tool-search'
  )
  if (
    (adapterMode === 'native-activation' &&
      (reservedNameEntries.length !== 1 || !isToolSearchActiveEntry(reservedNameEntries[0]))) ||
    (adapterMode !== 'native-activation' && reservedNameEntries.length !== 0)
  ) {
    throw new TypeError('Tool surface ToolSearch identity or selection reason is invalid.')
  }
}

function surfaceDegradations(input: {
  activeEntryCount: number
  retainedActiveEntryCount: number
  searchResultRefCount: number
  retainedSearchResultRefCount: number
  candidateRejectionCount: number
  retainedCandidateRejectionCount: number
}): TapeToolSurfaceDegradationCode[] {
  const degradations: TapeToolSurfaceDegradationCode[] = []
  if (input.activeEntryCount > MAX_TAPE_TOOL_SURFACE_ACTIVE_ENTRIES) {
    degradations.push('active-projection-count-limited')
  }
  if (
    input.retainedActiveEntryCount <
    Math.min(input.activeEntryCount, MAX_TAPE_TOOL_SURFACE_ACTIVE_ENTRIES)
  ) {
    degradations.push('active-projection-byte-limited')
  }
  if (input.retainedSearchResultRefCount < input.searchResultRefCount) {
    degradations.push('search-refs-truncated')
  }
  if (input.retainedCandidateRejectionCount < input.candidateRejectionCount) {
    degradations.push('candidate-rejections-truncated')
  }
  return degradations
}

function compareSearchRefs(
  left: TapeToolSurfaceSearchResultRef,
  right: TapeToolSurfaceSearchResultRef
): number {
  return (
    left.originRequestSeq - right.originRequestSeq ||
    left.toolCallOrdinalWithinBatch - right.toolCallOrdinalWithinBatch ||
    left.resultRank - right.resultRank ||
    compareCodePoints(left.stableTargetKey, right.stableTargetKey)
  )
}

function validateSearchProvenance(
  request: TapeToolSurfaceRequestIdentity,
  catalog: TapeToolCatalogFactReference,
  activeEntries: readonly TapeToolSurfaceActiveEntry[],
  searchResultRefs: readonly TapeToolSurfaceSearchResultRef[],
  candidateRejections: readonly TapeToolSurfaceCandidateRejection[]
): void {
  const activeByTarget = new Map(activeEntries.map((entry) => [entry.stableTargetKey, entry]))
  const seenAcceptedTargets = new Set<string>()
  const seenResultCoordinates = new Set<string>()
  const toolResultBySearchCall = new Map<string, string>()
  const searchCallByToolResult = new Map<string, string>()
  const searchCallsByRequest = new Map<number, Set<number>>()
  const validateResultCoordinate = (ref: TapeToolSurfaceSearchResultRef): boolean => {
    const searchCallKey = `${ref.originRequestSeq}:${ref.toolCallOrdinalWithinBatch}`
    const resultCoordinate = `${searchCallKey}:${ref.resultRank}`
    const physicalRef = canonicalJsonStringifyData(ref.toolResult)
    const physicalLocation = canonicalJsonStringifyData({
      sessionId: ref.toolResult.sessionId,
      tapeIncarnationId: ref.toolResult.tapeIncarnationId,
      entryId: ref.toolResult.entryId
    })
    const priorPhysicalRef = toolResultBySearchCall.get(searchCallKey)
    const priorSearchCall = searchCallByToolResult.get(physicalLocation)
    const searchCalls = searchCallsByRequest.get(ref.originRequestSeq) ?? new Set<number>()
    if (
      ref.resultRank >= TOOL_SEARCH_AGENT_TOOL_MAX_RESULTS ||
      seenResultCoordinates.has(resultCoordinate) ||
      (priorPhysicalRef !== undefined && priorPhysicalRef !== physicalRef) ||
      (priorSearchCall !== undefined && priorSearchCall !== searchCallKey) ||
      (!searchCalls.has(ref.toolCallOrdinalWithinBatch) &&
        searchCalls.size >= TOOL_SEARCH_AGENT_TOOL_MAX_CALLS_PER_BATCH)
    ) {
      return false
    }
    seenResultCoordinates.add(resultCoordinate)
    toolResultBySearchCall.set(searchCallKey, physicalRef)
    searchCallByToolResult.set(physicalLocation, searchCallKey)
    searchCalls.add(ref.toolCallOrdinalWithinBatch)
    searchCallsByRequest.set(ref.originRequestSeq, searchCalls)
    return true
  }
  let previousAccepted: TapeToolSurfaceSearchResultRef | null = null
  let latestAcceptedRequestSeq = 0
  for (const ref of searchResultRefs) {
    const activeEntry = activeByTarget.get(ref.stableTargetKey)
    if (
      ref.originRequestSeq >= request.requestSeq ||
      ref.toolResult.sessionId !== request.sessionId ||
      ref.toolResult.tapeIncarnationId !== catalog.tapeIncarnationId ||
      !validateResultCoordinate(ref) ||
      seenAcceptedTargets.has(ref.stableTargetKey) ||
      !activeEntry ||
      activeEntry.reason !== 'search-result' ||
      activeEntry.canonicalToolDefinitionHash !== ref.canonicalToolDefinitionHash ||
      (previousAccepted !== null && compareSearchRefs(previousAccepted, ref) >= 0)
    ) {
      throw new TypeError('Tool surface accepted search provenance is invalid.')
    }
    seenAcceptedTargets.add(ref.stableTargetKey)
    latestAcceptedRequestSeq = Math.max(latestAcceptedRequestSeq, ref.originRequestSeq)
    previousAccepted = ref
  }

  const seenRejectedTargets = new Set<string>()
  let previousRejected: TapeToolSurfaceSearchResultRef | null = null
  let rejectionRequestSeq: number | null = null
  for (const rejection of candidateRejections) {
    if (
      rejection.originRequestSeq >= request.requestSeq ||
      rejection.originRequestSeq < latestAcceptedRequestSeq ||
      (rejectionRequestSeq !== null && rejection.originRequestSeq !== rejectionRequestSeq) ||
      rejection.toolResult.sessionId !== request.sessionId ||
      rejection.toolResult.tapeIncarnationId !== catalog.tapeIncarnationId ||
      !validateResultCoordinate(rejection) ||
      seenAcceptedTargets.has(rejection.stableTargetKey) ||
      seenRejectedTargets.has(rejection.stableTargetKey) ||
      activeByTarget.has(rejection.stableTargetKey) ||
      (previousRejected !== null && compareSearchRefs(previousRejected, rejection) >= 0)
    ) {
      throw new TypeError('Tool surface rejected search provenance is invalid.')
    }
    seenRejectedTargets.add(rejection.stableTargetKey)
    rejectionRequestSeq = rejection.originRequestSeq
    previousRejected = rejection
  }
}

function requireCompleteAcceptedSearchProvenance(
  activeEntries: readonly TapeToolSurfaceActiveEntry[],
  searchResultRefs: readonly TapeToolSurfaceSearchResultRef[]
): void {
  const expectedTargets = activeEntries
    .filter((entry) => entry.reason === 'search-result')
    .map((entry) => entry.stableTargetKey)
    .sort(compareCodePoints)
  const actualTargets = searchResultRefs.map((ref) => ref.stableTargetKey).sort(compareCodePoints)
  if (canonicalJsonStringifyData(expectedTargets) !== canonicalJsonStringifyData(actualTargets)) {
    throw new TypeError('Tool surface is missing accepted ToolSearch result provenance.')
  }
}

function selectActiveProjection(
  activeEntries: readonly TapeToolSurfaceActiveEntry[],
  limit: number,
  adapterMode: TapeToolSurfaceAdapterMode
): TapeToolSurfaceActiveEntry[] {
  if (limit >= activeEntries.length) return [...activeEntries]
  if (adapterMode === 'direct-native') return activeEntries.slice(0, limit)
  if (limit < 1) return []
  const requiredEntry =
    adapterMode === 'native-activation'
      ? activeEntries.find((entry) => entry.reason === 'tool-search')
      : activeEntries.find(isCanonicalAgentExecToolSurfaceEntry)
  if (!requiredEntry) return activeEntries.slice(0, limit)
  return [
    ...activeEntries.filter((entry) => entry !== requiredEntry).slice(0, limit - 1),
    requiredEntry
  ].sort((left, right) => left.activationOrdinal - right.activationOrdinal)
}

export function createTapeToolSurfaceFact(
  input: CreateTapeToolSurfaceFactInput
): TapeToolSurfaceFactV2 {
  return createTapeToolSurfaceFactFromData(
    detachBoundedPlainData(input, MAX_TAPE_TOOL_FACT_SOURCE_BYTES)
  )
}

function createTapeToolSurfaceFactFromData(
  input: CreateTapeToolSurfaceFactInput
): TapeToolSurfaceFactV2 {
  if (
    !isRequestIdentity(input.request) ||
    !isHash(input.manifestHash) ||
    !isCatalogReference(input.catalog) ||
    input.catalog.sessionId !== input.request.sessionId ||
    !isBoundedString(input.canonicalizationVersion, MAX_VERSION_BYTES) ||
    !isBoundedString(input.orderingVersion, MAX_VERSION_BYTES) ||
    !isBoundedString(input.policyVersion, MAX_VERSION_BYTES) ||
    !isToolSurfaceAdapterMode(input.adapterMode) ||
    typeof input.virtualizationTriggered !== 'boolean' ||
    input.virtualizationTriggered !== (input.adapterMode !== 'direct-native') ||
    typeof input.contractBearing !== 'boolean' ||
    (input.contractBearing && !isUuid(input.request.runId)) ||
    !Array.isArray(input.activeEntries) ||
    input.activeEntries.length > MAX_SOURCE_ACTIVE_ENTRIES ||
    !isBudget(input.budget) ||
    input.budget.activeToolCount !== input.activeEntries.length ||
    input.budget.eligibleToolCount < input.budget.activeToolCount ||
    input.budget.activeDefinitionTokens > input.budget.eligibleDefinitionTokens ||
    (input.searchResultRefs !== undefined &&
      (!Array.isArray(input.searchResultRefs) ||
        input.searchResultRefs.length > MAX_SOURCE_ACTIVATION_DECISIONS)) ||
    (input.candidateRejections !== undefined &&
      (!Array.isArray(input.candidateRejections) ||
        input.candidateRejections.length > MAX_SOURCE_ACTIVATION_DECISIONS))
  ) {
    throw new TypeError('Tool surface fact input is invalid.')
  }

  const allActiveEntries = input.activeEntries.map(cloneActiveEntry)
  validateActiveEntryOrder(allActiveEntries)
  validateToolSearchPresence(input.adapterMode, allActiveEntries)
  if (
    input.adapterMode === 'cli-programmatic' &&
    allActiveEntries.some(
      (entry) =>
        entry.target.providerVisibleName === 'exec' && !isCanonicalAgentExecToolSurfaceEntry(entry)
    )
  ) {
    throw new TypeError('A CLI Programmatic provider surface contains a non-canonical Agent exec.')
  }
  if (input.contractBearing && allActiveEntries.length > MAX_TAPE_TOOL_SURFACE_ACTIVE_ENTRIES) {
    throw new TypeError('Contract-bearing Tool surface exceeds its complete active-entry limit.')
  }
  const maximumActiveEntries = selectActiveProjection(
    allActiveEntries,
    MAX_TAPE_TOOL_SURFACE_ACTIVE_ENTRIES,
    input.adapterMode
  )
  const allSearchRefs = (input.searchResultRefs ?? []).map(cloneSearchRef)
  allSearchRefs.sort(compareSearchRefs)
  const allCandidateRejections = (input.candidateRejections ?? []).map(cloneCandidateRejection)
  allCandidateRejections.sort(compareSearchRefs)
  validateSearchProvenance(
    input.request,
    input.catalog,
    allActiveEntries,
    allSearchRefs,
    allCandidateRejections
  )
  requireCompleteAcceptedSearchProvenance(allActiveEntries, allSearchRefs)
  if (
    input.adapterMode === 'cli-programmatic' &&
    (allActiveEntries.some(
      (entry) => entry.reason === 'tool-search' || entry.reason === 'search-result'
    ) ||
      allSearchRefs.length > 0 ||
      allCandidateRejections.length > 0)
  ) {
    throw new TypeError('A CLI Programmatic provider surface cannot contain native search state.')
  }
  if (
    !input.virtualizationTriggered &&
    (allActiveEntries.some((entry) => entry.reason !== 'full-catalog') ||
      allSearchRefs.length > 0 ||
      allCandidateRejections.length > 0 ||
      input.budget.eligibleToolCount !== input.budget.activeToolCount ||
      input.budget.eligibleDefinitionTokens !== input.budget.activeDefinitionTokens)
  ) {
    throw new TypeError('A non-virtualized Tool surface cannot contain search provenance.')
  }
  const candidateRejections = allCandidateRejections.slice(0, MAX_TAPE_TOOL_SURFACE_REJECTIONS)
  const buildWithLengths = (
    activeLength: number,
    searchRefLength: number,
    rejectionLength: number
  ): TapeToolSurfaceFactV2 => {
    const retainedActiveEntries = selectActiveProjection(
      maximumActiveEntries,
      activeLength,
      input.adapterMode
    )
    const retainedActiveTargets = new Set(
      retainedActiveEntries.map((entry) => entry.stableTargetKey)
    )
    const retainedSearchRefs = allSearchRefs
      .filter((ref) => retainedActiveTargets.has(ref.stableTargetKey))
      .slice(0, MAX_TAPE_TOOL_SURFACE_SEARCH_REFS)
      .slice(0, searchRefLength)
    const retainedRejections = candidateRejections.slice(0, rejectionLength)
    return buildSurfaceFactDraft({
      request: { ...input.request },
      manifestHash: input.manifestHash,
      catalog: { ...input.catalog },
      canonicalizationVersion: input.canonicalizationVersion,
      orderingVersion: input.orderingVersion,
      policyVersion: input.policyVersion,
      adapterMode: input.adapterMode,
      virtualizationTriggered: input.virtualizationTriggered,
      contractBearing: input.contractBearing,
      activeEntryCount: allActiveEntries.length,
      activeEntries: retainedActiveEntries,
      budget: { ...input.budget },
      searchResultRefCount: allSearchRefs.length,
      searchResultRefs: retainedSearchRefs,
      candidateRejectionCount: allCandidateRejections.length,
      candidateRejections: retainedRejections,
      degradations: surfaceDegradations({
        activeEntryCount: allActiveEntries.length,
        retainedActiveEntryCount: retainedActiveEntries.length,
        searchResultRefCount: allSearchRefs.length,
        retainedSearchResultRefCount: retainedSearchRefs.length,
        candidateRejectionCount: allCandidateRejections.length,
        retainedCandidateRejectionCount: retainedRejections.length
      })
    })
  }

  let activeLength = maximumActiveEntries.length
  let searchRefLength = MAX_TAPE_TOOL_SURFACE_SEARCH_REFS
  let rejectionLength = candidateRejections.length
  let fact = buildWithLengths(activeLength, searchRefLength, rejectionLength)
  if (canonicalBytes(fact) > MAX_TAPE_TOOL_FACT_BYTES) {
    rejectionLength = findLargestFittingPrefix(rejectionLength, (length) =>
      buildWithLengths(activeLength, searchRefLength, length)
    )
    fact = buildWithLengths(activeLength, searchRefLength, rejectionLength)
  }
  if (canonicalBytes(fact) > MAX_TAPE_TOOL_FACT_BYTES && !input.contractBearing) {
    searchRefLength = findLargestFittingPrefix(searchRefLength, (length) =>
      buildWithLengths(activeLength, length, rejectionLength)
    )
    fact = buildWithLengths(activeLength, searchRefLength, rejectionLength)
  }
  if (canonicalBytes(fact) > MAX_TAPE_TOOL_FACT_BYTES && !input.contractBearing) {
    activeLength = findLargestFittingPrefix(activeLength, (length) =>
      buildWithLengths(length, searchRefLength, rejectionLength)
    )
    if (input.virtualizationTriggered) activeLength = Math.max(activeLength, 1)
    fact = buildWithLengths(activeLength, searchRefLength, rejectionLength)
  }
  if (canonicalBytes(fact) > MAX_TAPE_TOOL_FACT_BYTES) {
    throw new TypeError(
      input.contractBearing
        ? 'Contract-bearing Tool surface fact exceeds its canonical byte limit.'
        : 'Tool surface fact exceeds its canonical byte limit.'
    )
  }
  return deepFreeze(fact)
}

export function getTapeToolSurfaceAdapterMode(
  fact: TapeToolSurfaceFact
): TapeToolSurfaceAdapterMode {
  return fact.schemaVersion === 1
    ? fact.virtualizationTriggered
      ? 'native-activation'
      : 'direct-native'
    : fact.adapterMode
}

function isSurfaceFactShape(value: unknown): value is TapeToolSurfaceFact {
  if (!isPlainRecord(value)) return false
  const isV1 = value.schemaVersion === 1 && value.surfaceHashVersion === 1
  const isV2 =
    value.schemaVersion === TAPE_TOOL_SURFACE_FACT_SCHEMA_VERSION &&
    value.surfaceHashVersion === TAPE_TOOL_SURFACE_FACT_HASH_VERSION
  if (!isV1 && !isV2) return false
  const versionKeys = isV2 ? ['adapterMode'] : []
  if (
    !hasExactKeys(value, [
      'schemaVersion',
      'surfaceHashVersion',
      'canonicalizationVersion',
      'orderingVersion',
      'request',
      'manifestHash',
      'catalog',
      'policyVersion',
      'virtualizationTriggered',
      'contractBearing',
      'activeEntryCount',
      'retainedActiveEntryCount',
      'activeEntries',
      'budget',
      'searchResultRefCount',
      'searchResultRefs',
      'candidateRejectionCount',
      'candidateRejections',
      'degradations',
      'surfaceHash',
      ...versionKeys
    ]) ||
    !isBoundedString(value.canonicalizationVersion, MAX_VERSION_BYTES) ||
    !isBoundedString(value.orderingVersion, MAX_VERSION_BYTES) ||
    !isHash(value.surfaceHash) ||
    !isRequestIdentity(value.request) ||
    !isHash(value.manifestHash) ||
    !isCatalogReference(value.catalog) ||
    value.catalog.sessionId !== value.request.sessionId ||
    !isBoundedString(value.policyVersion, MAX_VERSION_BYTES) ||
    (isV2 && !isToolSurfaceAdapterMode(value.adapterMode)) ||
    typeof value.virtualizationTriggered !== 'boolean' ||
    (isV2 && value.virtualizationTriggered !== (value.adapterMode !== 'direct-native')) ||
    typeof value.contractBearing !== 'boolean' ||
    (value.contractBearing && !isUuid(value.request.runId)) ||
    !isNonNegativeSafeInteger(value.activeEntryCount) ||
    value.activeEntryCount > MAX_SOURCE_ACTIVE_ENTRIES ||
    !isNonNegativeSafeInteger(value.retainedActiveEntryCount) ||
    !Array.isArray(value.activeEntries) ||
    value.activeEntries.length !== value.retainedActiveEntryCount ||
    value.retainedActiveEntryCount > value.activeEntryCount ||
    value.retainedActiveEntryCount > MAX_TAPE_TOOL_SURFACE_ACTIVE_ENTRIES ||
    !value.activeEntries.every(isActiveEntry) ||
    !isBudget(value.budget) ||
    value.budget.activeToolCount !== value.activeEntryCount ||
    value.budget.eligibleToolCount < value.budget.activeToolCount ||
    value.budget.activeDefinitionTokens > value.budget.eligibleDefinitionTokens ||
    !isNonNegativeSafeInteger(value.searchResultRefCount) ||
    value.searchResultRefCount > MAX_SOURCE_ACTIVATION_DECISIONS ||
    !Array.isArray(value.searchResultRefs) ||
    value.searchResultRefs.length > value.searchResultRefCount ||
    value.searchResultRefs.length > MAX_TAPE_TOOL_SURFACE_SEARCH_REFS ||
    !value.searchResultRefs.every(isSearchRef) ||
    !isNonNegativeSafeInteger(value.candidateRejectionCount) ||
    value.candidateRejectionCount > MAX_SOURCE_ACTIVATION_DECISIONS ||
    !Array.isArray(value.candidateRejections) ||
    value.candidateRejections.length > value.candidateRejectionCount ||
    value.candidateRejections.length > MAX_TAPE_TOOL_SURFACE_REJECTIONS ||
    !value.candidateRejections.every(isCandidateRejection) ||
    !Array.isArray(value.degradations) ||
    value.degradations.length > MAX_TAPE_TOOL_SURFACE_DEGRADATIONS ||
    !value.degradations.every((code) => SURFACE_DEGRADATIONS.has(code)) ||
    (value.contractBearing &&
      (value.retainedActiveEntryCount !== value.activeEntryCount ||
        value.searchResultRefs.length !== value.searchResultRefCount))
  ) {
    return false
  }
  const adapterMode: TapeToolSurfaceAdapterMode = isV1
    ? value.virtualizationTriggered
      ? 'native-activation'
      : 'direct-native'
    : (value.adapterMode as TapeToolSurfaceAdapterMode)
  try {
    validateActiveEntryOrder(value.activeEntries)
    validateToolSearchPresence(adapterMode, value.activeEntries)
    validateSearchProvenance(
      value.request,
      value.catalog,
      value.activeEntries,
      value.searchResultRefs,
      value.candidateRejections
    )
    const retainedSearchResultCount = value.activeEntries.filter(
      (entry) => entry.reason === 'search-result'
    ).length
    if (value.searchResultRefCount < retainedSearchResultCount) return false
    if (value.contractBearing || value.searchResultRefs.length === value.searchResultRefCount) {
      requireCompleteAcceptedSearchProvenance(value.activeEntries, value.searchResultRefs)
    }
    if (
      adapterMode === 'cli-programmatic' &&
      (value.activeEntries.some(
        (entry) =>
          entry.target.providerVisibleName === 'exec' &&
          !isCanonicalAgentExecToolSurfaceEntry(entry)
      ) ||
        value.activeEntries.some(
          (entry) => entry.reason === 'tool-search' || entry.reason === 'search-result'
        ) ||
        value.searchResultRefCount > 0 ||
        value.candidateRejectionCount > 0)
    ) {
      return false
    }
  } catch {
    return false
  }
  const expectedDegradations = surfaceDegradations({
    activeEntryCount: value.activeEntryCount,
    retainedActiveEntryCount: value.retainedActiveEntryCount,
    searchResultRefCount: value.searchResultRefCount,
    retainedSearchResultRefCount: value.searchResultRefs.length,
    candidateRejectionCount: value.candidateRejectionCount,
    retainedCandidateRejectionCount: value.candidateRejections.length
  })
  if (
    canonicalJsonStringifyData(value.degradations) !==
      canonicalJsonStringifyData(expectedDegradations) ||
    (!value.virtualizationTriggered &&
      (value.activeEntries.some((entry) => entry.reason !== 'full-catalog') ||
        value.searchResultRefCount > 0 ||
        value.candidateRejectionCount > 0 ||
        value.budget.eligibleToolCount !== value.budget.activeToolCount ||
        value.budget.eligibleDefinitionTokens !== value.budget.activeDefinitionTokens))
  ) {
    return false
  }
  return true
}

export function verifyTapeToolSurfaceFact(fact: unknown): fact is TapeToolSurfaceFact {
  try {
    const detached = detachBoundedPlainData(fact, MAX_TAPE_TOOL_FACT_BYTES)
    if (!isSurfaceFactShape(detached)) return false
    const { surfaceHash: persistedSurfaceHash, ...withoutSurfaceHash } = detached
    return surfaceFactHash(withoutSurfaceHash) === persistedSurfaceHash
  } catch {
    return false
  }
}

export function buildTapeProgrammaticWorkspacePathHash(normalizedAbsolutePath: string): {
  readonly hashVersion: typeof TAPE_PROGRAMMATIC_WORKSPACE_PATH_HASH_VERSION
  readonly pathHash: string
} {
  if (
    !isNormalizedBoundedString(normalizedAbsolutePath, 32 * 1024) ||
    normalizeAbsoluteWorkspacePath(normalizedAbsolutePath)?.path !== normalizedAbsolutePath
  ) {
    throw new TypeError('Programmatic workspace path must already be normalized and absolute.')
  }
  return {
    hashVersion: TAPE_PROGRAMMATIC_WORKSPACE_PATH_HASH_VERSION,
    pathHash: hashJsonData({
      hashVersion: TAPE_PROGRAMMATIC_WORKSPACE_PATH_HASH_VERSION,
      path: normalizedAbsolutePath
    })
  }
}

function isProgrammaticWorkspace(value: unknown): value is TapeProgrammaticWorkspaceCeiling {
  if (!isPlainRecord(value)) return false
  if (value.kind === 'runtime_default') return hasExactKeys(value, ['kind'])
  return (
    hasExactKeys(value, ['kind', 'pathHashVersion', 'pathHash']) &&
    value.kind === 'path' &&
    value.pathHashVersion === TAPE_PROGRAMMATIC_WORKSPACE_PATH_HASH_VERSION &&
    isHash(value.pathHash)
  )
}

function isProgrammaticCeilings(value: unknown): value is TapeProgrammaticToolSurfaceCeilings {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, ['maxToolEffect', 'workspace', 'maxSubagentDepth']) &&
    (value.maxToolEffect === 'read' || value.maxToolEffect === 'write') &&
    isProgrammaticWorkspace(value.workspace) &&
    (value.maxSubagentDepth === 0 || value.maxSubagentDepth === 1)
  )
}

function isProgrammaticQuotas(value: unknown): value is TapeProgrammaticToolSurfaceQuotas {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, [
      'maxChildren',
      'maxBatchSteps',
      'maxInputBytes',
      'maxOutputBytes',
      'maxDurationMs'
    ]) &&
    isPositiveSafeInteger(value.maxChildren) &&
    value.maxChildren <= MAX_TAPE_PROGRAMMATIC_TOOL_CHILDREN &&
    isPositiveSafeInteger(value.maxBatchSteps) &&
    value.maxBatchSteps <= MAX_TAPE_PROGRAMMATIC_TOOL_BATCH_STEPS &&
    value.maxBatchSteps <= value.maxChildren &&
    isPositiveSafeInteger(value.maxInputBytes) &&
    value.maxInputBytes <= MAX_TAPE_PROGRAMMATIC_TOOL_INPUT_BYTES &&
    isPositiveSafeInteger(value.maxOutputBytes) &&
    value.maxOutputBytes <= MAX_TAPE_PROGRAMMATIC_TOOL_OUTPUT_BYTES &&
    isPositiveSafeInteger(value.maxDurationMs) &&
    value.maxDurationMs <= MAX_TAPE_PROGRAMMATIC_TOOL_DURATION_MS
  )
}

export function buildProgrammaticToolSurfaceHashV1(
  input: ProgrammaticToolSurfaceHashInputV1
): string {
  return hashJsonData({
    schemaVersion: input.schemaVersion,
    canonicalizationVersion: input.canonicalizationVersion,
    catalogHash: input.catalogHash,
    entries: input.entries.map((entry) => ({
      target: entry.target,
      stableTargetKey: entry.stableTargetKey,
      canonicalToolDefinitionHash: entry.canonicalToolDefinitionHash,
      execution: entry.execution
    }))
  })
}

function programmaticDegradations(
  total: number,
  retained: number
): TapeProgrammaticToolSurfaceDegradationCode[] {
  const result: TapeProgrammaticToolSurfaceDegradationCode[] = []
  if (total > MAX_TAPE_TOOL_CATALOG_PROJECTION_ENTRIES) {
    result.push('programmatic-projection-count-limited')
  }
  if (retained < Math.min(total, MAX_TAPE_TOOL_CATALOG_PROJECTION_ENTRIES)) {
    result.push('programmatic-projection-byte-limited')
  }
  return result
}

function programmaticProjectionHash(input: {
  capabilityHash: string
  totalEntryCount: number
  entries: readonly TapeToolCatalogSourceEntry[]
}): string {
  return hashJsonData({
    projectionHashVersion: TAPE_PROGRAMMATIC_TOOL_SURFACE_PROJECTION_HASH_VERSION,
    ...input
  })
}

function buildProgrammaticFactDraft(
  input: CreateTapeProgrammaticToolSurfaceFactInput,
  totalEntryCount: number,
  entries: readonly TapeToolCatalogSourceEntry[]
): TapeProgrammaticToolSurfaceFact {
  const withoutHash = {
    schemaVersion: TAPE_PROGRAMMATIC_TOOL_SURFACE_FACT_SCHEMA_VERSION,
    factHashVersion: TAPE_PROGRAMMATIC_TOOL_SURFACE_FACT_HASH_VERSION,
    capabilitySchemaVersion: input.capabilitySchemaVersion,
    capabilityHashVersion: input.capabilityHashVersion,
    capabilityHash: input.capabilityHash,
    programmaticSurfaceSchemaVersion: input.programmaticSurfaceSchemaVersion,
    programmaticSurfaceHashVersion: input.programmaticSurfaceHashVersion,
    programmaticSurfaceHash: input.programmaticSurfaceHash,
    projectionHashVersion: TAPE_PROGRAMMATIC_TOOL_SURFACE_PROJECTION_HASH_VERSION,
    projectionHash: programmaticProjectionHash({
      capabilityHash: input.capabilityHash,
      totalEntryCount,
      entries
    }),
    canonicalizationVersion: input.canonicalizationVersion,
    policyVersion: input.policyVersion,
    adapterMode: input.adapterMode,
    request: { ...input.request },
    manifestHash: input.manifestHash,
    catalog: { ...input.catalog },
    contractBearing: input.contractBearing,
    totalEntryCount,
    retainedEntryCount: entries.length,
    entries,
    taskContractRef: input.taskContractRef === null ? null : { ...input.taskContractRef },
    ceilings: {
      ...input.ceilings,
      workspace: { ...input.ceilings.workspace }
    },
    quotas: { ...input.quotas },
    degradations: programmaticDegradations(totalEntryCount, entries.length)
  } satisfies Omit<TapeProgrammaticToolSurfaceFact, 'factHash'>
  return { ...withoutHash, factHash: hashJsonData(withoutHash) }
}

function validateProgrammaticEntries(entries: readonly TapeToolCatalogSourceEntry[]): void {
  const visibleNames = new Map<string, string>()
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (entry.target.source !== 'mcp' || entry.exposure !== 'user-configurable') {
      throw new TypeError(
        'Programmatic Tool Surface entries must be user-configurable MCP targets.'
      )
    }
    if (index > 0) {
      const order = compareCodePoints(entries[index - 1].stableTargetKey, entry.stableTargetKey)
      if (order === 0) {
        throw new TypeError('Programmatic Tool Surface contains a duplicate stable target.')
      }
      if (order > 0) {
        throw new TypeError('Programmatic Tool Surface entries are not in canonical order.')
      }
    }
    const prior = visibleNames.get(entry.target.providerVisibleName)
    if (prior !== undefined && prior !== entry.stableTargetKey) {
      throw new TypeError('Programmatic Tool Surface contains a conflicting provider-visible name.')
    }
    visibleNames.set(entry.target.providerVisibleName, entry.stableTargetKey)
  }
}

export function createTapeProgrammaticToolSurfaceFact(
  input: CreateTapeProgrammaticToolSurfaceFactInput
): TapeProgrammaticToolSurfaceFact {
  const data = detachBoundedPlainData(input, MAX_TAPE_TOOL_FACT_SOURCE_BYTES)
  if (
    !isPlainRecord(data) ||
    !hasExactKeys(data, [
      'capabilitySchemaVersion',
      'capabilityHashVersion',
      'capabilityHash',
      'programmaticSurfaceSchemaVersion',
      'programmaticSurfaceHashVersion',
      'programmaticSurfaceHash',
      'canonicalizationVersion',
      'policyVersion',
      'adapterMode',
      'request',
      'manifestHash',
      'catalog',
      'contractBearing',
      'entries',
      'taskContractRef',
      'ceilings',
      'quotas'
    ]) ||
    data.capabilitySchemaVersion !== 1 ||
    data.capabilityHashVersion !== 1 ||
    !isHash(data.capabilityHash) ||
    data.programmaticSurfaceSchemaVersion !== 1 ||
    data.programmaticSurfaceHashVersion !== 1 ||
    !isHash(data.programmaticSurfaceHash) ||
    !isNormalizedBoundedString(data.canonicalizationVersion, MAX_VERSION_BYTES) ||
    !isNormalizedBoundedString(data.policyVersion, MAX_PROGRAMMATIC_POLICY_VERSION_BYTES) ||
    data.adapterMode !== 'cli-programmatic' ||
    !isRequestIdentity(data.request) ||
    !isHash(data.manifestHash) ||
    !isCatalogReference(data.catalog) ||
    data.catalog.sessionId !== data.request.sessionId ||
    typeof data.contractBearing !== 'boolean' ||
    (data.contractBearing && !isUuid(data.request.runId)) ||
    !Array.isArray(data.entries) ||
    data.entries.length > MAX_SOURCE_CATALOG_ENTRIES ||
    (data.taskContractRef !== null && !isDeepChatTaskContractRef(data.taskContractRef)) ||
    (data.taskContractRef?.sessionId !== undefined &&
      data.taskContractRef.sessionId !== data.request.sessionId) ||
    !isProgrammaticCeilings(data.ceilings) ||
    !isProgrammaticQuotas(data.quotas)
  ) {
    throw new TypeError('Programmatic Tool Surface fact input is invalid.')
  }
  const entries = data.entries
    .map(cloneCatalogEntry)
    .sort((left, right) => compareCodePoints(left.stableTargetKey, right.stableTargetKey))
  validateProgrammaticEntries(entries)
  if (
    buildProgrammaticToolSurfaceHashV1({
      schemaVersion: data.programmaticSurfaceSchemaVersion,
      canonicalizationVersion: data.canonicalizationVersion,
      catalogHash: data.catalog.fullCatalogHash,
      entries
    }) !== data.programmaticSurfaceHash
  ) {
    throw new TypeError('Programmatic Tool Surface does not match its surface hash.')
  }
  if (
    data.ceilings.maxToolEffect === 'read' &&
    entries.some((entry) => entry.execution.effect === 'write')
  ) {
    throw new TypeError('Programmatic Tool Surface exceeds its effect ceiling.')
  }
  const maximum = Math.min(entries.length, MAX_TAPE_TOOL_CATALOG_PROJECTION_ENTRIES)
  const build = (length: number) =>
    buildProgrammaticFactDraft(data, entries.length, entries.slice(0, length))
  const retained = findLargestFittingPrefix(maximum, build)
  const fact = build(retained)
  if (canonicalBytes(fact) > MAX_TAPE_TOOL_FACT_BYTES) {
    throw new TypeError('Programmatic Tool Surface fact exceeds its canonical byte limit.')
  }
  return deepFreeze(fact)
}

function isProgrammaticFactShape(value: unknown): value is TapeProgrammaticToolSurfaceFact {
  if (!isPlainRecord(value)) return false
  const keys = [
    'schemaVersion',
    'factHashVersion',
    'capabilitySchemaVersion',
    'capabilityHashVersion',
    'capabilityHash',
    'programmaticSurfaceSchemaVersion',
    'programmaticSurfaceHashVersion',
    'programmaticSurfaceHash',
    'projectionHashVersion',
    'projectionHash',
    'canonicalizationVersion',
    'policyVersion',
    'adapterMode',
    'request',
    'manifestHash',
    'catalog',
    'contractBearing',
    'totalEntryCount',
    'retainedEntryCount',
    'entries',
    'taskContractRef',
    'ceilings',
    'quotas',
    'degradations',
    'factHash'
  ]
  if (
    !hasExactKeys(value, keys) ||
    value.schemaVersion !== 1 ||
    value.factHashVersion !== 1 ||
    value.capabilitySchemaVersion !== 1 ||
    value.capabilityHashVersion !== 1 ||
    !isHash(value.capabilityHash) ||
    value.programmaticSurfaceSchemaVersion !== 1 ||
    value.programmaticSurfaceHashVersion !== 1 ||
    !isHash(value.programmaticSurfaceHash) ||
    value.projectionHashVersion !== 1 ||
    !isHash(value.projectionHash) ||
    !isNormalizedBoundedString(value.canonicalizationVersion, MAX_VERSION_BYTES) ||
    !isNormalizedBoundedString(value.policyVersion, MAX_PROGRAMMATIC_POLICY_VERSION_BYTES) ||
    value.adapterMode !== 'cli-programmatic' ||
    !isRequestIdentity(value.request) ||
    !isHash(value.manifestHash) ||
    !isCatalogReference(value.catalog) ||
    value.catalog.sessionId !== value.request.sessionId ||
    typeof value.contractBearing !== 'boolean' ||
    (value.contractBearing && !isUuid(value.request.runId)) ||
    !isNonNegativeSafeInteger(value.totalEntryCount) ||
    value.totalEntryCount > MAX_SOURCE_CATALOG_ENTRIES ||
    !isNonNegativeSafeInteger(value.retainedEntryCount) ||
    !Array.isArray(value.entries) ||
    value.entries.length !== value.retainedEntryCount ||
    value.retainedEntryCount > value.totalEntryCount ||
    value.retainedEntryCount > MAX_TAPE_TOOL_CATALOG_PROJECTION_ENTRIES ||
    !value.entries.every(isCatalogEntry) ||
    (value.taskContractRef !== null && !isDeepChatTaskContractRef(value.taskContractRef)) ||
    (value.taskContractRef?.sessionId !== undefined &&
      value.taskContractRef.sessionId !== value.request.sessionId) ||
    !isProgrammaticCeilings(value.ceilings) ||
    !isProgrammaticQuotas(value.quotas) ||
    !Array.isArray(value.degradations) ||
    !value.degradations.every((code) => PROGRAMMATIC_DEGRADATIONS.has(code)) ||
    !isHash(value.factHash)
  )
    return false
  try {
    validateProgrammaticEntries(value.entries)
  } catch {
    return false
  }
  if (
    value.ceilings.maxToolEffect === 'read' &&
    value.entries.some((entry) => entry.execution.effect === 'write')
  )
    return false
  if (
    value.retainedEntryCount === value.totalEntryCount &&
    buildProgrammaticToolSurfaceHashV1({
      schemaVersion: value.programmaticSurfaceSchemaVersion,
      canonicalizationVersion: value.canonicalizationVersion,
      catalogHash: value.catalog.fullCatalogHash,
      entries: value.entries
    }) !== value.programmaticSurfaceHash
  ) {
    return false
  }
  return (
    canonicalJsonStringifyData(value.degradations) ===
    canonicalJsonStringifyData(
      programmaticDegradations(value.totalEntryCount, value.retainedEntryCount)
    )
  )
}

export function verifyTapeProgrammaticToolSurfaceFact(
  fact: unknown
): fact is TapeProgrammaticToolSurfaceFact {
  try {
    const detached = detachBoundedPlainData(fact, MAX_TAPE_TOOL_FACT_BYTES)
    if (!isProgrammaticFactShape(detached)) return false
    if (
      detached.projectionHash !==
      programmaticProjectionHash({
        capabilityHash: detached.capabilityHash,
        totalEntryCount: detached.totalEntryCount,
        entries: detached.entries
      })
    )
      return false
    const { factHash, ...withoutHash } = detached
    return hashJsonData(withoutHash) === factHash
  } catch {
    return false
  }
}
