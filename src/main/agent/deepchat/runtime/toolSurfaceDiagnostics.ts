import type { ChatMessage } from '@shared/types/core/chat-message'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type {
  DeepChatAgentInstance,
  DeepChatToolProfileKind
} from '@/agent/deepchat/instance/deepChatAgentInstance'
import { hashJsonData } from '@/tape/domain/canonicalJson'
import type { RunToolDefinitionUniverse } from './toolResolver'
import {
  buildCanonicalToolCatalog,
  computeToolSurfaceShadowDecision,
  computeToolSurfaceStaticDefinitionOverlap,
  type CanonicalToolCatalog,
  ToolSurfaceError,
  type ToolSurfaceDefinitionIdentity,
  type ToolSurfaceShadowDecision,
  type ToolSurfaceShadowPolicy,
  type ToolSurfaceShadowTriggerReason,
  type ToolSurfaceStaticDefinitionOverlap
} from './toolSurface'
import {
  collectRecentToolSurfaceNames,
  createAutomaticToolSurfaceSelectionPolicy,
  prepareToolSurfacePolicySelectionInputs
} from './toolSurfaceSelection'

export const TOOL_SURFACE_SHADOW_DIAGNOSTICS_SCHEMA_VERSION = 1
export const TOOL_SURFACE_P0A_SHADOW_POLICY: ToolSurfaceShadowPolicy = Object.freeze({
  ...createAutomaticToolSurfaceSelectionPolicy(256),
  policyVersion: 'p0a-shadow-v2',
})

const DEFAULT_SAMPLE_CAPACITY = 256
const MAX_SAMPLE_CAPACITY = 4_096
const MAX_INITIAL_VIEW_PHYSICAL_ATTEMPTS = 64
const MAX_SCOPE_FIELD_CODE_UNITS = 1_024
const MAX_SCOPE_FIELD_BYTES = 4_096
const DEFAULT_MAX_LINEAGES_PER_INSTANCE = 8
const MAX_LINEAGES_PER_INSTANCE = 32
const MAX_DEFERRED_PROVIDER_ATTEMPTS = 64
const MAX_PENDING_RUNS_PER_INSTANCE = 16
const TOOL_SURFACE_SHADOW_UNIVERSE_TIMEOUT_MS = 5_000

const TRIGGER_REASONS: readonly ToolSurfaceShadowTriggerReason[] = Object.freeze([
  'none',
  'tool-count',
  'estimated-input-tokens',
  'tool-count-and-estimated-input-tokens',
  'hysteresis'
])

const SURFACE_RELATIONS = Object.freeze(['first', 'unchanged', 'changed', 'unavailable'] as const)

export type ToolSurfaceRelation = (typeof SURFACE_RELATIONS)[number]

export interface ToolSurfaceShadowDiagnosticsScope {
  readonly sessionId: string
  readonly providerId: string
  readonly modelId: string
  readonly toolProfile: DeepChatToolProfileKind
}

export interface ToolSurfaceDistribution {
  readonly samples: number
  readonly p50: number | null
  readonly p95: number | null
  readonly max: number | null
}

export interface ToolSurfaceProviderAttemptSummary {
  readonly observed: number
  readonly withUsage: number
  readonly withCacheReadMetric: number
  readonly withCacheWriteMetric: number
  readonly inputTokens: ToolSurfaceDistribution
  readonly cacheReadTokens: ToolSurfaceDistribution
  readonly cacheWriteTokens: ToolSurfaceDistribution
  readonly surfaceOverlapJaccardRatio: ToolSurfaceDistribution
}

export interface ToolSurfaceShadowDiagnosticsSnapshot {
  readonly schemaVersion: typeof TOOL_SURFACE_SHADOW_DIAGNOSTICS_SCHEMA_VERSION
  readonly policyVersion: string
  readonly runs: {
    readonly observed: number
    readonly measured: number
    readonly degraded: number
    readonly acpExcluded: number
    readonly mandatoryAdmissionBlocked: number
    readonly collectorFailures: number
    readonly surfaceInputLimitExceeded: number
    readonly virtualizationTriggered: number
    readonly triggerCounts: Readonly<Record<ToolSurfaceShadowTriggerReason, number>>
    readonly surfaceRelationCounts: Readonly<Record<ToolSurfaceRelation, number>>
  }
  readonly surface: {
    readonly ceilingToolCount: ToolSurfaceDistribution
    readonly ceilingDefinitionTokens: ToolSurfaceDistribution
    readonly eligibleToolCount: ToolSurfaceDistribution
    readonly eligibleDefinitionTokens: ToolSurfaceDistribution
    readonly hypotheticalActiveToolCount: ToolSurfaceDistribution
    readonly hypotheticalActiveDefinitionTokens: ToolSurfaceDistribution
    readonly estimatedNetInputTokenReduction: ToolSurfaceDistribution
    readonly staticOverlapJaccardRatio: ToolSurfaceDistribution
  }
  readonly initialViewAttempts: ToolSurfaceProviderAttemptSummary & {
    readonly bySurfaceRelation: Readonly<
      Record<ToolSurfaceRelation, ToolSurfaceProviderAttemptSummary>
    >
  }
}

export interface ToolSurfaceProviderAttemptDiagnostic {
  readonly requestSeq: number
  readonly physicalAttempt: number
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens?: number
    readonly cacheReadTokens?: number
    readonly cacheWriteTokens?: number
  } | null
}

export interface ToolSurfaceShadowRunRecorder {
  recordProviderAttempt(attempt: ToolSurfaceProviderAttemptDiagnostic): void
  finish(): void
}

export interface ToolSurfaceShadowDiagnosticsRegistryPort {
  scheduleDeferredRun(input: {
    readonly instance: DeepChatAgentInstance
    readonly scope: ToolSurfaceShadowDiagnosticsScope
    readonly resolveUniverse: (signal: AbortSignal) => Promise<RunToolDefinitionUniverse>
    readonly isCurrent: () => boolean
    readonly eligibleDefinitions: readonly MCPToolDefinition[]
    readonly initialViewRequestSeq: number
    readonly providerAttempts: readonly ToolSurfaceProviderAttemptDiagnostic[]
    readonly messages?: readonly ChatMessage[]
  }): void
  snapshot(input: {
    readonly instance: DeepChatAgentInstance
    readonly scope: ToolSurfaceShadowDiagnosticsScope
  }): ToolSurfaceShadowDiagnosticsSnapshot | null
  cancelPending(instance: DeepChatAgentInstance): void
  clear(instance: DeepChatAgentInstance): void
}

interface ToolSurfaceShadowRunMeasurement {
  readonly measured: boolean
  readonly universeStatus: RunToolDefinitionUniverse['status']
  readonly decision: ToolSurfaceShadowDecision | null
  readonly hypotheticalSurfaceIdentities: readonly ToolSurfaceDefinitionIdentity[]
}

interface PreparedToolSurfaceShadowRunInput {
  readonly eligibleCatalog: CanonicalToolCatalog
  readonly recentToolNames: readonly string[]
}

interface PreparedToolSurfaceShadowUniverse {
  readonly status: RunToolDefinitionUniverse['status']
  readonly complete: boolean
  readonly mandatoryAdmissionBlocked: boolean
  readonly ceilingCatalog: CanonicalToolCatalog | null
  readonly activeSkillRequiredStableTargetKeys: readonly string[]
  readonly preparationFailed: boolean
}

interface RunSurfaceRelation {
  readonly kind: ToolSurfaceRelation
  readonly overlapJaccardRatio: number | null
}

const NOOP_RUN_RECORDER: ToolSurfaceShadowRunRecorder = Object.freeze({
  recordProviderAttempt: () => undefined,
  finish: () => undefined
})

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError')
  }
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

function createDeferredUniverseResolution(
  resolveUniverse: (signal: AbortSignal) => Promise<RunToolDefinitionUniverse>
): {
  readonly promise: Promise<RunToolDefinitionUniverse | null>
  readonly start: () => void
  readonly cancel: () => void
} {
  const controller = new AbortController()
  let settled = false
  let started = false
  let timeout: ReturnType<typeof setTimeout> | null = null
  let settlePromise: (universe: RunToolDefinitionUniverse | null) => void = () => undefined
  const cleanup = (): void => {
    if (timeout) clearTimeout(timeout)
    timeout = null
  }
  const settle = (universe: RunToolDefinitionUniverse | null): void => {
    if (settled) return
    settled = true
    cleanup()
    settlePromise(universe)
  }
  const promise = new Promise<RunToolDefinitionUniverse | null>((resolve) => {
    settlePromise = resolve
  })
  return {
    promise,
    start: () => {
      if (started || settled) return
      started = true
      if (controller.signal.aborted) {
        settle(null)
        return
      }
      timeout = setTimeout(() => {
        controller.abort(createAbortError())
        settle(null)
      }, TOOL_SURFACE_SHADOW_UNIVERSE_TIMEOUT_MS)
      timeout.unref?.()
      try {
        void resolveUniverse(controller.signal).then(settle, () => settle(null))
      } catch {
        settle(null)
      }
    },
    cancel: () => {
      if (!controller.signal.aborted) controller.abort(createAbortError())
      settle(null)
    }
  }
}

class BoundedNumberRing {
  private readonly values: number[]
  private nextIndex = 0
  private size = 0

  constructor(
    private readonly capacity: number,
    private readonly allowNegative = false
  ) {
    this.values = Array<number>(capacity)
  }

  push(value: number): void {
    if (!Number.isFinite(value) || (!this.allowNegative && value < 0)) return
    this.values[this.nextIndex] = value
    this.nextIndex = (this.nextIndex + 1) % this.capacity
    this.size = Math.min(this.size + 1, this.capacity)
  }

  snapshot(): number[] {
    if (this.size < this.capacity) return this.values.slice(0, this.size)
    return [...this.values.slice(this.nextIndex), ...this.values.slice(0, this.nextIndex)]
  }

  clear(): void {
    this.nextIndex = 0
    this.size = 0
  }
}

class ProviderAttemptAccumulator {
  private observed = 0
  private withUsage = 0
  private withCacheReadMetric = 0
  private withCacheWriteMetric = 0
  private readonly inputTokens: BoundedNumberRing
  private readonly cacheReadTokens: BoundedNumberRing
  private readonly cacheWriteTokens: BoundedNumberRing
  private readonly surfaceOverlapJaccardRatio: BoundedNumberRing

  constructor(sampleCapacity: number) {
    this.inputTokens = new BoundedNumberRing(sampleCapacity)
    this.cacheReadTokens = new BoundedNumberRing(sampleCapacity)
    this.cacheWriteTokens = new BoundedNumberRing(sampleCapacity)
    this.surfaceOverlapJaccardRatio = new BoundedNumberRing(sampleCapacity)
  }

  recordObserved(overlapJaccardRatio: number | null): void {
    this.observed = increment(this.observed)
    if (overlapJaccardRatio !== null) {
      this.surfaceOverlapJaccardRatio.push(overlapJaccardRatio)
    }
  }

  recordUsage(usage: NonNullable<ToolSurfaceProviderAttemptDiagnostic['usage']>): void {
    this.withUsage = increment(this.withUsage)
    this.inputTokens.push(usage.inputTokens)
    if (usage.cacheReadTokens !== undefined) {
      this.withCacheReadMetric = increment(this.withCacheReadMetric)
      this.cacheReadTokens.push(usage.cacheReadTokens)
    }
    if (usage.cacheWriteTokens !== undefined) {
      this.withCacheWriteMetric = increment(this.withCacheWriteMetric)
      this.cacheWriteTokens.push(usage.cacheWriteTokens)
    }
  }

  snapshot(): ToolSurfaceProviderAttemptSummary {
    return {
      observed: this.observed,
      withUsage: this.withUsage,
      withCacheReadMetric: this.withCacheReadMetric,
      withCacheWriteMetric: this.withCacheWriteMetric,
      inputTokens: distribution(this.inputTokens.snapshot()),
      cacheReadTokens: distribution(this.cacheReadTokens.snapshot()),
      cacheWriteTokens: distribution(this.cacheWriteTokens.snapshot()),
      surfaceOverlapJaccardRatio: distribution(this.surfaceOverlapJaccardRatio.snapshot())
    }
  }

  clear(): void {
    this.observed = 0
    this.withUsage = 0
    this.withCacheReadMetric = 0
    this.withCacheWriteMetric = 0
    this.inputTokens.clear()
    this.cacheReadTokens.clear()
    this.cacheWriteTokens.clear()
    this.surfaceOverlapJaccardRatio.clear()
  }
}

function distribution(values: readonly number[]): ToolSurfaceDistribution {
  if (values.length === 0) return { samples: 0, p50: null, p95: null, max: null }
  const sorted = [...values].sort((left, right) => left - right)
  const nearestRank = (percentile: number): number =>
    sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)]
  return {
    samples: sorted.length,
    p50: nearestRank(0.5),
    p95: nearestRank(0.95),
    max: sorted.at(-1) ?? null
  }
}

function emptyTriggerCounts(): Record<ToolSurfaceShadowTriggerReason, number> {
  return Object.fromEntries(TRIGGER_REASONS.map((reason) => [reason, 0])) as Record<
    ToolSurfaceShadowTriggerReason,
    number
  >
}

function emptyRelationCounts(): Record<ToolSurfaceRelation, number> {
  return { first: 0, unchanged: 0, changed: 0, unavailable: 0 }
}

function createAttemptAccumulators(
  sampleCapacity: number
): Record<ToolSurfaceRelation, ProviderAttemptAccumulator> {
  return {
    first: new ProviderAttemptAccumulator(sampleCapacity),
    unchanged: new ProviderAttemptAccumulator(sampleCapacity),
    changed: new ProviderAttemptAccumulator(sampleCapacity),
    unavailable: new ProviderAttemptAccumulator(sampleCapacity)
  }
}

function increment(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, value + 1)
}

function cloneShadowPolicy(policy: ToolSurfaceShadowPolicy): ToolSurfaceShadowPolicy {
  return Object.freeze({
    policyVersion: policy.policyVersion,
    enterToolCount: policy.enterToolCount,
    exitToolCount: policy.exitToolCount,
    enterEstimatedInputTokens: policy.enterEstimatedInputTokens,
    exitEstimatedInputTokens: policy.exitEstimatedInputTokens,
    maxInitialToolCount: policy.maxInitialToolCount,
    maxInitialDefinitionTokens: policy.maxInitialDefinitionTokens,
    activationReserveToolCount: policy.activationReserveToolCount,
    activationReserveDefinitionTokens: policy.activationReserveDefinitionTokens,
    maxActivationCandidatesPerBatch: policy.maxActivationCandidatesPerBatch,
    maxActivationCandidateDefinitionTokensPerBatch:
      policy.maxActivationCandidateDefinitionTokensPerBatch,
    maxActivationBatchesPerRun: policy.maxActivationBatchesPerRun,
    maxAppendedTargetsPerRun: policy.maxAppendedTargetsPerRun,
    toolSearchDefinitionTokens: policy.toolSearchDefinitionTokens,
    toolSearchPromptTokens: policy.toolSearchPromptTokens
  })
}

function isBoundedScopeField(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_SCOPE_FIELD_CODE_UNITS &&
    value === value.trim() &&
    !value.includes('\0') &&
    Buffer.byteLength(value, 'utf8') <= MAX_SCOPE_FIELD_BYTES
  )
}

function resolveScope(input: ToolSurfaceShadowDiagnosticsScope): DeepChatToolProfileKind | null {
  if (
    !isBoundedScopeField(input.sessionId) ||
    !isBoundedScopeField(input.providerId) ||
    !isBoundedScopeField(input.modelId) ||
    !['code', 'research', 'analysis', 'general'].includes(input.toolProfile)
  ) {
    return null
  }
  return input.toolProfile
}

function prepareToolSurfaceShadowRunInput(input: {
  readonly eligibleDefinitions: readonly MCPToolDefinition[]
  readonly messages?: readonly ChatMessage[]
}): PreparedToolSurfaceShadowRunInput {
  return Object.freeze({
    eligibleCatalog: buildCanonicalToolCatalog(input.eligibleDefinitions),
    recentToolNames: collectRecentToolSurfaceNames(input.messages ?? [])
  })
}

function cloneProviderAttemptDiagnostic(
  attempt: ToolSurfaceProviderAttemptDiagnostic
): ToolSurfaceProviderAttemptDiagnostic {
  return Object.freeze({
    requestSeq: attempt.requestSeq,
    physicalAttempt: attempt.physicalAttempt,
    usage: attempt.usage
      ? Object.freeze({
          inputTokens: attempt.usage.inputTokens,
          ...(attempt.usage.outputTokens === undefined
            ? {}
            : { outputTokens: attempt.usage.outputTokens }),
          ...(attempt.usage.cacheReadTokens === undefined
            ? {}
            : { cacheReadTokens: attempt.usage.cacheReadTokens }),
          ...(attempt.usage.cacheWriteTokens === undefined
            ? {}
            : { cacheWriteTokens: attempt.usage.cacheWriteTokens })
        })
      : null
  })
}

function prepareProviderAttemptDiagnostics(
  attempts: readonly ToolSurfaceProviderAttemptDiagnostic[]
): readonly ToolSurfaceProviderAttemptDiagnostic[] {
  const prepared: ToolSurfaceProviderAttemptDiagnostic[] = []
  for (
    let index = 0;
    index < Math.min(attempts.length, MAX_DEFERRED_PROVIDER_ATTEMPTS);
    index += 1
  ) {
    prepared.push(cloneProviderAttemptDiagnostic(attempts[index]))
  }
  return Object.freeze(prepared)
}

function prepareToolSurfaceShadowUniverse(
  universe: RunToolDefinitionUniverse | null
): PreparedToolSurfaceShadowUniverse | null {
  if (!universe) return null
  try {
    if (universe.status === 'acp-excluded' || !universe.complete) {
      return Object.freeze({
        status: universe.status,
        complete: universe.complete,
        mandatoryAdmissionBlocked: universe.mandatoryAdmissionBlocked,
        ceilingCatalog: null,
        activeSkillRequiredStableTargetKeys: Object.freeze([]),
        preparationFailed: false
      })
    }
    const activeSkillRequiredStableTargetKeys = universe.skillRequirements
      .filter((requirement) => requirement.activeAtRunStart && requirement.activatable)
      .flatMap((requirement) => requirement.requiredStableTargetKeys)
    return Object.freeze({
      status: universe.status,
      complete: universe.complete,
      mandatoryAdmissionBlocked: universe.mandatoryAdmissionBlocked,
      ceilingCatalog: buildCanonicalToolCatalog(universe.definitions),
      activeSkillRequiredStableTargetKeys: Object.freeze([
        ...activeSkillRequiredStableTargetKeys
      ]),
      preparationFailed: false
    })
  } catch {
    return Object.freeze({
      status: 'degraded',
      complete: true,
      mandatoryAdmissionBlocked: false,
      ceilingCatalog: null,
      activeSkillRequiredStableTargetKeys: Object.freeze([]),
      preparationFailed: true
    })
  }
}

function hypotheticalToolSearchIdentity(
  policy: ToolSurfaceShadowPolicy
): ToolSurfaceDefinitionIdentity {
  return {
    stableTargetKey: 'p0a-shadow:tool-search',
    canonicalToolDefinitionHash: hashJsonData({
      policyVersion: policy.policyVersion,
      definitionTokens: policy.toolSearchDefinitionTokens,
      promptTokens: policy.toolSearchPromptTokens
    })
  }
}

function digestSurfaceIdentities(
  identities: readonly ToolSurfaceDefinitionIdentity[]
): readonly ToolSurfaceDefinitionIdentity[] {
  return Object.freeze(
    identities.map((identity) => {
      const digest = hashJsonData({
        domain: 'tool-surface-shadow-definition-identity-v1',
        stableTargetKey: identity.stableTargetKey,
        canonicalToolDefinitionHash: identity.canonicalToolDefinitionHash
      })
      return Object.freeze({ stableTargetKey: digest, canonicalToolDefinitionHash: digest })
    })
  )
}

function computeToolSurfaceShadowRunMeasurement(input: {
  readonly universe: PreparedToolSurfaceShadowUniverse
  readonly eligibleCatalog: CanonicalToolCatalog
  readonly toolProfile: DeepChatToolProfileKind
  readonly recentToolNames: readonly string[]
  readonly previouslyVirtualized: boolean
  readonly policy: ToolSurfaceShadowPolicy
}): ToolSurfaceShadowRunMeasurement {
  const { universe } = input
  if (
    universe.status === 'acp-excluded' ||
    !universe.complete ||
    universe.preparationFailed ||
    !universe.ceilingCatalog
  ) {
    return Object.freeze({
      measured: false,
      universeStatus: universe.status,
      decision: null,
      hypotheticalSurfaceIdentities: Object.freeze([])
    })
  }

  const ceilingCatalog = universe.ceilingCatalog
  const eligibleCatalog = input.eligibleCatalog
  const selectionInputs = prepareToolSurfacePolicySelectionInputs({
    eligibleCatalog,
    toolProfile: input.toolProfile,
    activeSkillRequiredStableTargetKeys: universe.activeSkillRequiredStableTargetKeys,
    recentToolNames: input.recentToolNames
  })
  const decision = computeToolSurfaceShadowDecision({
    ceilingCatalog,
    eligibleCatalog,
    policy: input.policy,
    previouslyVirtualized: input.previouslyVirtualized,
    ...selectionInputs
  })
  const eligibleIdentityByTarget = new Map(
    eligibleCatalog.entries.map((entry) => [
      entry.stableTargetKey,
      {
        stableTargetKey: entry.stableTargetKey,
        canonicalToolDefinitionHash: entry.canonicalToolDefinitionHash
      }
    ])
  )
  const hypotheticalSurfaceIdentities = decision.virtualizationTriggered
    ? [
        ...decision.selectedEntries.flatMap((entry) => {
          const identity = eligibleIdentityByTarget.get(entry.stableTargetKey)
          return identity ? [identity] : []
        }),
        hypotheticalToolSearchIdentity(input.policy)
      ]
    : eligibleCatalog.entries.map((entry) => ({
        stableTargetKey: entry.stableTargetKey,
        canonicalToolDefinitionHash: entry.canonicalToolDefinitionHash
      }))

  return Object.freeze({
    measured: true,
    universeStatus: universe.status,
    decision,
    hypotheticalSurfaceIdentities: digestSurfaceIdentities(hypotheticalSurfaceIdentities)
  })
}

/**
 * A collector is scoped to one Session/provider/model/profile lineage. Create another collector
 * when any scope field changes. Scope identifiers are validated but not retained.
 */
export class ToolSurfaceShadowDiagnosticsCollector {
  private readonly policy: ToolSurfaceShadowPolicy
  private readonly scopeValid: boolean
  private readonly toolProfile: DeepChatToolProfileKind
  private lifecycleToken = Symbol('tool-surface-shadow-diagnostics-lifecycle')
  private previousSurface: readonly ToolSurfaceDefinitionIdentity[] | null = null
  private previouslyVirtualized = false
  private observedRuns = 0
  private measuredRuns = 0
  private degradedRuns = 0
  private acpExcludedRuns = 0
  private mandatoryAdmissionBlockedRuns = 0
  private collectorFailures = 0
  private surfaceInputLimitExceeded = 0
  private virtualizationTriggeredRuns = 0
  private readonly triggerCounts = emptyTriggerCounts()
  private readonly surfaceRelationCounts = emptyRelationCounts()
  private readonly ceilingToolCount: BoundedNumberRing
  private readonly ceilingDefinitionTokens: BoundedNumberRing
  private readonly eligibleToolCount: BoundedNumberRing
  private readonly eligibleDefinitionTokens: BoundedNumberRing
  private readonly hypotheticalActiveToolCount: BoundedNumberRing
  private readonly hypotheticalActiveDefinitionTokens: BoundedNumberRing
  private readonly estimatedNetInputTokenReduction: BoundedNumberRing
  private readonly staticOverlapJaccardRatio: BoundedNumberRing
  private readonly initialViewAttempts: ProviderAttemptAccumulator
  private readonly initialViewAttemptsByRelation: Record<
    ToolSurfaceRelation,
    ProviderAttemptAccumulator
  >

  constructor(options: {
    scope: ToolSurfaceShadowDiagnosticsScope
    sampleCapacity?: number
    policy?: ToolSurfaceShadowPolicy
  }) {
    let policy = TOOL_SURFACE_P0A_SHADOW_POLICY
    let scope: DeepChatToolProfileKind | null = null
    let requestedCapacity: number | undefined
    try {
      policy = cloneShadowPolicy(options.policy ?? TOOL_SURFACE_P0A_SHADOW_POLICY)
      scope = resolveScope(options.scope)
      requestedCapacity = options.sampleCapacity
    } catch {}
    this.policy = policy
    this.scopeValid = scope !== null
    this.toolProfile = scope ?? 'general'
    const sampleCapacity =
      requestedCapacity !== undefined &&
      Number.isSafeInteger(requestedCapacity) &&
      requestedCapacity > 0
        ? Math.min(requestedCapacity, MAX_SAMPLE_CAPACITY)
        : DEFAULT_SAMPLE_CAPACITY
    this.ceilingToolCount = new BoundedNumberRing(sampleCapacity)
    this.ceilingDefinitionTokens = new BoundedNumberRing(sampleCapacity)
    this.eligibleToolCount = new BoundedNumberRing(sampleCapacity)
    this.eligibleDefinitionTokens = new BoundedNumberRing(sampleCapacity)
    this.hypotheticalActiveToolCount = new BoundedNumberRing(sampleCapacity)
    this.hypotheticalActiveDefinitionTokens = new BoundedNumberRing(sampleCapacity)
    this.estimatedNetInputTokenReduction = new BoundedNumberRing(sampleCapacity, true)
    this.staticOverlapJaccardRatio = new BoundedNumberRing(sampleCapacity)
    this.initialViewAttempts = new ProviderAttemptAccumulator(sampleCapacity)
    this.initialViewAttemptsByRelation = createAttemptAccumulators(sampleCapacity)
  }

  startRun(input: {
    readonly universe: RunToolDefinitionUniverse | null
    readonly eligibleDefinitions: readonly MCPToolDefinition[]
    readonly initialViewRequestSeq: number
    readonly messages?: readonly ChatMessage[]
  }): ToolSurfaceShadowRunRecorder {
    try {
      const universe = prepareToolSurfaceShadowUniverse(input.universe ?? null)
      let preparedInput: PreparedToolSurfaceShadowRunInput | null = null
      if (universe?.status !== 'acp-excluded') {
        try {
          preparedInput = prepareToolSurfaceShadowRunInput(input)
        } catch {}
      }
      return this.startPreparedRun({
        universe,
        preparedInput,
        initialViewRequestSeq: input.initialViewRequestSeq
      })
    } catch {
      this.observedRuns = increment(this.observedRuns)
      this.collectorFailures = increment(this.collectorFailures)
      this.clearPriorSurface()
      return NOOP_RUN_RECORDER
    }
  }

  startPreparedRun(input: {
    readonly universe: PreparedToolSurfaceShadowUniverse | null
    readonly preparedInput: PreparedToolSurfaceShadowRunInput | null
    readonly initialViewRequestSeq: number
  }): ToolSurfaceShadowRunRecorder {
    this.observedRuns = increment(this.observedRuns)
    let initialViewRequestSeq: number | null = null
    const lifecycleToken = this.lifecycleToken
    try {
      initialViewRequestSeq = input.initialViewRequestSeq
      if (
        !this.scopeValid ||
        !Number.isSafeInteger(initialViewRequestSeq) ||
        initialViewRequestSeq <= 0
      ) {
        this.collectorFailures = increment(this.collectorFailures)
        this.clearPriorSurface()
        return NOOP_RUN_RECORDER
      }

      const universe = input.universe
      if (!universe) {
        this.degradedRuns = increment(this.degradedRuns)
        this.clearPriorSurface()
        return this.createRunRecorder(
          { kind: 'unavailable', overlapJaccardRatio: null },
          initialViewRequestSeq,
          lifecycleToken
        )
      }
      if (universe.status === 'acp-excluded') {
        this.acpExcludedRuns = increment(this.acpExcludedRuns)
        this.clearPriorSurface()
        return NOOP_RUN_RECORDER
      }
      if (universe.preparationFailed) {
        this.collectorFailures = increment(this.collectorFailures)
        this.clearPriorSurface()
        return this.createRunRecorder(
          { kind: 'unavailable', overlapJaccardRatio: null },
          initialViewRequestSeq,
          lifecycleToken
        )
      }
      if (!input.preparedInput) {
        this.collectorFailures = increment(this.collectorFailures)
        this.clearPriorSurface()
        return this.createRunRecorder(
          { kind: 'unavailable', overlapJaccardRatio: null },
          initialViewRequestSeq,
          lifecycleToken
        )
      }
      if (universe.mandatoryAdmissionBlocked) {
        this.mandatoryAdmissionBlockedRuns = increment(this.mandatoryAdmissionBlockedRuns)
      }
      if (!universe.complete) {
        this.degradedRuns = increment(this.degradedRuns)
        this.clearPriorSurface()
        return this.createRunRecorder(
          { kind: 'unavailable', overlapJaccardRatio: null },
          initialViewRequestSeq,
          lifecycleToken
        )
      }

      const measurement = computeToolSurfaceShadowRunMeasurement({
        universe,
        eligibleCatalog: input.preparedInput.eligibleCatalog,
        toolProfile: this.toolProfile,
        recentToolNames: input.preparedInput.recentToolNames,
        previouslyVirtualized: this.previouslyVirtualized,
        policy: this.policy
      })
      if (!measurement.measured || !measurement.decision) {
        this.degradedRuns = increment(this.degradedRuns)
        this.clearPriorSurface()
        return this.createRunRecorder(
          { kind: 'unavailable', overlapJaccardRatio: null },
          initialViewRequestSeq,
          lifecycleToken
        )
      }

      const { decision } = measurement
      this.measuredRuns = increment(this.measuredRuns)
      if (measurement.universeStatus === 'degraded' || decision.degradationCodes.length > 0) {
        this.degradedRuns = increment(this.degradedRuns)
      }
      if (decision.virtualizationTriggered) {
        this.virtualizationTriggeredRuns = increment(this.virtualizationTriggeredRuns)
      }
      this.triggerCounts[decision.triggerReason] = increment(
        this.triggerCounts[decision.triggerReason]
      )
      this.recordDecision(decision)

      let relation: RunSurfaceRelation = { kind: 'first', overlapJaccardRatio: null }
      if (this.previousSurface) {
        const overlap = computeToolSurfaceStaticDefinitionOverlap(
          this.previousSurface,
          measurement.hypotheticalSurfaceIdentities
        )
        this.staticOverlapJaccardRatio.push(overlap.jaccardRatio)
        relation = {
          kind: isUnchangedSurface(overlap) ? 'unchanged' : 'changed',
          overlapJaccardRatio: overlap.jaccardRatio
        }
      }
      this.surfaceRelationCounts[relation.kind] = increment(
        this.surfaceRelationCounts[relation.kind]
      )
      this.previousSurface = measurement.hypotheticalSurfaceIdentities
      this.previouslyVirtualized = decision.virtualizationTriggered
      return this.createRunRecorder(relation, initialViewRequestSeq, lifecycleToken)
    } catch (error) {
      this.collectorFailures = increment(this.collectorFailures)
      if (error instanceof ToolSurfaceError && error.code === 'limit_exceeded') {
        this.surfaceInputLimitExceeded = increment(this.surfaceInputLimitExceeded)
      }
      this.clearPriorSurface()
      return initialViewRequestSeq !== null &&
        Number.isSafeInteger(initialViewRequestSeq) &&
        initialViewRequestSeq > 0
        ? this.createRunRecorder(
            { kind: 'unavailable', overlapJaccardRatio: null },
            initialViewRequestSeq,
            lifecycleToken
          )
        : NOOP_RUN_RECORDER
    }
  }

  snapshot(): ToolSurfaceShadowDiagnosticsSnapshot {
    return {
      schemaVersion: TOOL_SURFACE_SHADOW_DIAGNOSTICS_SCHEMA_VERSION,
      policyVersion: this.policy.policyVersion,
      runs: {
        observed: this.observedRuns,
        measured: this.measuredRuns,
        degraded: this.degradedRuns,
        acpExcluded: this.acpExcludedRuns,
        mandatoryAdmissionBlocked: this.mandatoryAdmissionBlockedRuns,
        collectorFailures: this.collectorFailures,
        surfaceInputLimitExceeded: this.surfaceInputLimitExceeded,
        virtualizationTriggered: this.virtualizationTriggeredRuns,
        triggerCounts: { ...this.triggerCounts },
        surfaceRelationCounts: { ...this.surfaceRelationCounts }
      },
      surface: {
        ceilingToolCount: distribution(this.ceilingToolCount.snapshot()),
        ceilingDefinitionTokens: distribution(this.ceilingDefinitionTokens.snapshot()),
        eligibleToolCount: distribution(this.eligibleToolCount.snapshot()),
        eligibleDefinitionTokens: distribution(this.eligibleDefinitionTokens.snapshot()),
        hypotheticalActiveToolCount: distribution(this.hypotheticalActiveToolCount.snapshot()),
        hypotheticalActiveDefinitionTokens: distribution(
          this.hypotheticalActiveDefinitionTokens.snapshot()
        ),
        estimatedNetInputTokenReduction: distribution(
          this.estimatedNetInputTokenReduction.snapshot()
        ),
        staticOverlapJaccardRatio: distribution(this.staticOverlapJaccardRatio.snapshot())
      },
      initialViewAttempts: {
        ...this.initialViewAttempts.snapshot(),
        bySurfaceRelation: Object.fromEntries(
          SURFACE_RELATIONS.map((relation) => [
            relation,
            this.initialViewAttemptsByRelation[relation].snapshot()
          ])
        ) as Record<ToolSurfaceRelation, ToolSurfaceProviderAttemptSummary>
      }
    }
  }

  clear(): void {
    this.lifecycleToken = Symbol('tool-surface-shadow-diagnostics-lifecycle')
    this.previousSurface = null
    this.previouslyVirtualized = false
    this.observedRuns = 0
    this.measuredRuns = 0
    this.degradedRuns = 0
    this.acpExcludedRuns = 0
    this.mandatoryAdmissionBlockedRuns = 0
    this.collectorFailures = 0
    this.surfaceInputLimitExceeded = 0
    this.virtualizationTriggeredRuns = 0
    for (const reason of TRIGGER_REASONS) this.triggerCounts[reason] = 0
    for (const relation of SURFACE_RELATIONS) {
      this.surfaceRelationCounts[relation] = 0
      this.initialViewAttemptsByRelation[relation].clear()
    }
    this.initialViewAttempts.clear()
    for (const ring of [
      this.ceilingToolCount,
      this.ceilingDefinitionTokens,
      this.eligibleToolCount,
      this.eligibleDefinitionTokens,
      this.hypotheticalActiveToolCount,
      this.hypotheticalActiveDefinitionTokens,
      this.estimatedNetInputTokenReduction,
      this.staticOverlapJaccardRatio
    ]) {
      ring.clear()
    }
  }

  private clearPriorSurface(): void {
    this.previousSurface = null
    this.previouslyVirtualized = false
    this.surfaceRelationCounts.unavailable = increment(this.surfaceRelationCounts.unavailable)
  }

  private recordDecision(decision: ToolSurfaceShadowDecision): void {
    this.ceilingToolCount.push(decision.ceilingToolCount)
    this.ceilingDefinitionTokens.push(decision.ceilingDefinitionTokens)
    this.eligibleToolCount.push(decision.eligibleToolCount)
    this.eligibleDefinitionTokens.push(decision.eligibleDefinitionTokens)
    this.hypotheticalActiveToolCount.push(decision.hypotheticalActiveToolCount)
    this.hypotheticalActiveDefinitionTokens.push(decision.hypotheticalActiveDefinitionTokens)
    this.estimatedNetInputTokenReduction.push(decision.estimatedNetInputTokenReduction)
  }

  private createRunRecorder(
    relation: RunSurfaceRelation,
    initialViewRequestSeq: number,
    lifecycleToken: symbol
  ): ToolSurfaceShadowRunRecorder {
    let finished = false
    const seenPhysicalAttempts = new Set<number>()
    return Object.freeze({
      recordProviderAttempt: (attempt: ToolSurfaceProviderAttemptDiagnostic): void => {
        try {
          if (finished || this.lifecycleToken !== lifecycleToken) return
          if (attempt.requestSeq !== initialViewRequestSeq) return
          if (
            !Number.isSafeInteger(attempt.physicalAttempt) ||
            attempt.physicalAttempt <= 0 ||
            attempt.physicalAttempt > MAX_INITIAL_VIEW_PHYSICAL_ATTEMPTS ||
            seenPhysicalAttempts.has(attempt.physicalAttempt)
          ) {
            return
          }
          seenPhysicalAttempts.add(attempt.physicalAttempt)
          const relationAccumulator = this.initialViewAttemptsByRelation[relation.kind]
          this.initialViewAttempts.recordObserved(relation.overlapJaccardRatio)
          relationAccumulator.recordObserved(relation.overlapJaccardRatio)
          if (!attempt.usage) return
          if (!isProviderAttemptUsage(attempt.usage)) {
            this.collectorFailures = increment(this.collectorFailures)
            return
          }
          this.initialViewAttempts.recordUsage(attempt.usage)
          relationAccumulator.recordUsage(attempt.usage)
        } catch {
          this.collectorFailures = increment(this.collectorFailures)
        }
      },
      finish: (): void => {
        finished = true
        seenPhysicalAttempts.clear()
      }
    })
  }
}

interface ToolSurfaceShadowDiagnosticsLineage {
  readonly key: string
  readonly collector: ToolSurfaceShadowDiagnosticsCollector
}

/**
 * Keeps independent bounded collectors for each Session instance and provider/model/profile lineage.
 * The WeakMap follows the runtime instance lifecycle, and lineage keys retain only a digest.
 */
export class ToolSurfaceShadowDiagnosticsRegistry
  implements ToolSurfaceShadowDiagnosticsRegistryPort
{
  private readonly lineagesByInstance = new WeakMap<
    DeepChatAgentInstance,
    Map<string, ToolSurfaceShadowDiagnosticsLineage>
  >()
  private readonly pendingCancellationsByInstance = new WeakMap<
    DeepChatAgentInstance,
    Set<() => void>
  >()
  private readonly deferredTailsByInstance = new WeakMap<
    DeepChatAgentInstance,
    Map<string, Promise<void>>
  >()
  private readonly maxLineagesPerInstance: number

  constructor(
    private readonly options: {
      readonly maxLineagesPerInstance?: number
      readonly sampleCapacity?: number
      readonly policy?: ToolSurfaceShadowPolicy
    } = {}
  ) {
    const requestedMax = options.maxLineagesPerInstance
    this.maxLineagesPerInstance =
      requestedMax !== undefined && Number.isSafeInteger(requestedMax) && requestedMax > 0
        ? Math.min(requestedMax, MAX_LINEAGES_PER_INSTANCE)
        : DEFAULT_MAX_LINEAGES_PER_INSTANCE
  }

  startRun(input: {
    readonly instance: DeepChatAgentInstance
    readonly scope: ToolSurfaceShadowDiagnosticsScope
    readonly universe: RunToolDefinitionUniverse | null
    readonly eligibleDefinitions: readonly MCPToolDefinition[]
    readonly initialViewRequestSeq: number
    readonly messages?: readonly ChatMessage[]
  }): ToolSurfaceShadowRunRecorder {
    try {
      return this.getOrCreate(input.instance, input.scope).startRun({
        universe: input.universe,
        eligibleDefinitions: input.eligibleDefinitions,
        initialViewRequestSeq: input.initialViewRequestSeq,
        ...(input.messages === undefined ? {} : { messages: input.messages })
      })
    } catch {
      return NOOP_RUN_RECORDER
    }
  }

  startDeferredRun(input: {
    readonly instance: DeepChatAgentInstance
    readonly scope: ToolSurfaceShadowDiagnosticsScope
    readonly universe: Promise<RunToolDefinitionUniverse | null>
    readonly cancelUniverse: () => void
    readonly shouldCommit?: () => boolean
    readonly eligibleDefinitions: readonly MCPToolDefinition[]
    readonly initialViewRequestSeq: number
    readonly messages?: readonly ChatMessage[]
  }): ToolSurfaceShadowRunRecorder {
    let preparedInput: PreparedToolSurfaceShadowRunInput | null = null
    try {
      preparedInput = prepareToolSurfaceShadowRunInput(input)
    } catch {}
    return this.startPreparedDeferredRun({
      instance: input.instance,
      scope: input.scope,
      universe: input.universe,
      cancelUniverse: input.cancelUniverse,
      ...(input.shouldCommit === undefined ? {} : { shouldCommit: input.shouldCommit }),
      preparedInput,
      initialViewRequestSeq: input.initialViewRequestSeq
    })
  }

  private startPreparedDeferredRun(input: {
    readonly instance: DeepChatAgentInstance
    readonly scope: ToolSurfaceShadowDiagnosticsScope
    readonly universe: Promise<RunToolDefinitionUniverse | null>
    readonly cancelUniverse: () => void
    readonly shouldCommit?: () => boolean
    readonly preparedInput: PreparedToolSurfaceShadowRunInput | null
    readonly initialViewRequestSeq: number
  }): ToolSurfaceShadowRunRecorder {
    let key: string
    try {
      key = this.lineageKey(input.instance, input.scope)
    } catch {
      try {
        input.cancelUniverse()
      } catch {}
      return NOOP_RUN_RECORDER
    }
    const instance = input.instance
    const cancelUniverse = input.cancelUniverse
    const shouldCommit = input.shouldCommit
    const preparedInput = input.preparedInput
    const universePromise = input.universe
    const pendingCancellations = this.pendingCancellationsByInstance.get(instance) ?? new Set()
    if (pendingCancellations.size >= MAX_PENDING_RUNS_PER_INSTANCE) {
      try {
        cancelUniverse()
      } catch {}
      return NOOP_RUN_RECORDER
    }
    let collector: ToolSurfaceShadowDiagnosticsCollector
    try {
      collector = this.getOrCreate(instance, input.scope)
    } catch {
      try {
        cancelUniverse()
      } catch {}
      return NOOP_RUN_RECORDER
    }
    let delegate: ToolSurfaceShadowRunRecorder | null = null
    let finished = false
    let invalidated = false
    const bufferedAttempts: ToolSurfaceProviderAttemptDiagnostic[] = []
    const initialViewRequestSeq = input.initialViewRequestSeq
    const invalidate = (): void => {
      invalidated = true
      try {
        cancelUniverse()
      } catch {}
    }
    pendingCancellations.add(invalidate)
    this.pendingCancellationsByInstance.set(instance, pendingCancellations)
    const cleanup = (): void => {
      pendingCancellations.delete(invalidate)
      if (pendingCancellations.size === 0) {
        if (this.pendingCancellationsByInstance.get(instance) === pendingCancellations) {
          this.pendingCancellationsByInstance.delete(instance)
        }
      }
    }
    let universeResult: Promise<PreparedToolSurfaceShadowUniverse | null>
    try {
      universeResult = universePromise.then(
        (universe) => prepareToolSurfaceShadowUniverse(universe),
        () => null
      )
    } catch {
      try {
        cancelUniverse()
      } catch {}
      cleanup()
      return NOOP_RUN_RECORDER
    }

    const deferredTails = this.deferredTailsByInstance.get(instance) ?? new Map()
    const previousTail = deferredTails.get(key) ?? Promise.resolve()
    const currentTail = previousTail
      .catch(() => undefined)
      .then(async () => {
        const universe = await universeResult
        let commitAllowed = true
        try {
          commitAllowed = shouldCommit?.() ?? true
        } catch {
          commitAllowed = false
        }
        if (
          invalidated ||
          !commitAllowed ||
          this.lineagesByInstance.get(instance)?.get(key)?.collector !== collector
        ) {
          bufferedAttempts.length = 0
          return
        }
        delegate = collector.startPreparedRun({
          universe,
          preparedInput,
          initialViewRequestSeq
        })
        for (const attempt of bufferedAttempts) delegate.recordProviderAttempt(attempt)
        bufferedAttempts.length = 0
        if (finished) delegate.finish()
      })
      .catch(() => undefined)
    deferredTails.set(key, currentTail)
    this.deferredTailsByInstance.set(instance, deferredTails)
    void currentTail.then(() => {
      cleanup()
      if (deferredTails.get(key) === currentTail) {
        deferredTails.delete(key)
        if (
          deferredTails.size === 0 &&
          this.deferredTailsByInstance.get(instance) === deferredTails
        ) {
          this.deferredTailsByInstance.delete(instance)
        }
      }
    })

    return Object.freeze({
      recordProviderAttempt: (attempt: ToolSurfaceProviderAttemptDiagnostic): void => {
        if (finished) return
        if (delegate) {
          delegate.recordProviderAttempt(attempt)
          return
        }
        if (bufferedAttempts.length >= MAX_DEFERRED_PROVIDER_ATTEMPTS) return
        try {
          bufferedAttempts.push(cloneProviderAttemptDiagnostic(attempt))
        } catch {}
      },
      finish: (): void => {
        if (finished) return
        finished = true
        delegate?.finish()
      }
    })
  }

  scheduleDeferredRun(input: {
    readonly instance: DeepChatAgentInstance
    readonly scope: ToolSurfaceShadowDiagnosticsScope
    readonly resolveUniverse: (signal: AbortSignal) => Promise<RunToolDefinitionUniverse>
    readonly isCurrent: () => boolean
    readonly eligibleDefinitions: readonly MCPToolDefinition[]
    readonly initialViewRequestSeq: number
    readonly providerAttempts: readonly ToolSurfaceProviderAttemptDiagnostic[]
    readonly messages?: readonly ChatMessage[]
  }): void {
    const instance = input.instance
    const scope = Object.freeze({ ...input.scope })
    try {
      this.lineageKey(instance, scope)
    } catch {
      return
    }
    const pendingCancellations = this.pendingCancellationsByInstance.get(instance) ?? new Set()
    if (pendingCancellations.size >= MAX_PENDING_RUNS_PER_INSTANCE) return
    let preparedInput: PreparedToolSurfaceShadowRunInput | null = null
    try {
      preparedInput = prepareToolSurfaceShadowRunInput(input)
    } catch {}
    let providerAttempts: readonly ToolSurfaceProviderAttemptDiagnostic[] = Object.freeze([])
    try {
      providerAttempts = prepareProviderAttemptDiagnostics(input.providerAttempts)
    } catch {}
    const resolveUniverse = input.resolveUniverse
    const isCurrent = input.isCurrent
    const initialViewRequestSeq = input.initialViewRequestSeq
    let cancelled = false
    let scheduled: ReturnType<typeof setImmediate> | null = null
    const cancelScheduled = (): void => {
      cancelled = true
      if (scheduled) clearImmediate(scheduled)
      scheduled = null
    }
    const cleanup = (): void => {
      pendingCancellations.delete(cancelScheduled)
      if (
        pendingCancellations.size === 0 &&
        this.pendingCancellationsByInstance.get(instance) === pendingCancellations
      ) {
        this.pendingCancellationsByInstance.delete(instance)
      }
    }
    pendingCancellations.add(cancelScheduled)
    this.pendingCancellationsByInstance.set(instance, pendingCancellations)
    try {
      scheduled = setImmediate(() => {
        scheduled = null
        cleanup()
        if (cancelled) return
        let universeResolution: ReturnType<typeof createDeferredUniverseResolution> | null = null
        try {
          if (!isCurrent()) return
          universeResolution = createDeferredUniverseResolution(resolveUniverse)
          const recorder = this.startPreparedDeferredRun({
            instance,
            scope,
            universe: universeResolution.promise,
            cancelUniverse: universeResolution.cancel,
            shouldCommit: isCurrent,
            preparedInput,
            initialViewRequestSeq
          })
          for (const attempt of providerAttempts) {
            recorder.recordProviderAttempt(attempt)
          }
          recorder.finish()
          universeResolution.start()
        } catch {
          universeResolution?.cancel()
        }
      })
      scheduled.unref?.()
    } catch {
      cancelScheduled()
      cleanup()
    }
  }

  snapshot(input: {
    readonly instance: DeepChatAgentInstance
    readonly scope: ToolSurfaceShadowDiagnosticsScope
  }): ToolSurfaceShadowDiagnosticsSnapshot | null {
    try {
      const key = this.lineageKey(input.instance, input.scope)
      return this.lineagesByInstance.get(input.instance)?.get(key)?.collector.snapshot() ?? null
    } catch {
      return null
    }
  }

  cancelPending(instance: DeepChatAgentInstance): void {
    const pendingCancellations = this.pendingCancellationsByInstance.get(instance)
    if (pendingCancellations) {
      for (const cancel of pendingCancellations) {
        try {
          cancel()
        } catch {}
      }
      pendingCancellations.clear()
      this.pendingCancellationsByInstance.delete(instance)
    }
    this.deferredTailsByInstance.delete(instance)
  }

  clear(instance: DeepChatAgentInstance): void {
    this.cancelPending(instance)
    const lineages = this.lineagesByInstance.get(instance)
    if (!lineages) return
    for (const lineage of lineages.values()) lineage.collector.clear()
    this.lineagesByInstance.delete(instance)
  }

  private getOrCreate(
    instance: DeepChatAgentInstance,
    scope: ToolSurfaceShadowDiagnosticsScope
  ): ToolSurfaceShadowDiagnosticsCollector {
    const key = this.lineageKey(instance, scope)
    const lineages = this.lineagesByInstance.get(instance) ?? new Map()
    const current = lineages.get(key)
    if (current) {
      lineages.delete(key)
      lineages.set(key, current)
      return current.collector
    }

    const collector = new ToolSurfaceShadowDiagnosticsCollector({
      scope,
      ...(this.options.sampleCapacity === undefined
        ? {}
        : { sampleCapacity: this.options.sampleCapacity }),
      ...(this.options.policy === undefined ? {} : { policy: this.options.policy })
    })
    lineages.set(key, { key, collector })
    while (lineages.size > this.maxLineagesPerInstance) {
      const oldestKey = lineages.keys().next().value
      if (typeof oldestKey !== 'string') break
      lineages.get(oldestKey)?.collector.clear()
      lineages.delete(oldestKey)
    }
    this.lineagesByInstance.set(instance, lineages)
    return collector
  }

  private lineageKey(
    instance: DeepChatAgentInstance,
    scope: ToolSurfaceShadowDiagnosticsScope
  ): string {
    if (resolveScope(scope) === null || scope.sessionId !== instance.sessionId) {
      throw new Error('Tool Surface diagnostics scope does not match its Session instance.')
    }
    return hashJsonData({
      sessionId: scope.sessionId,
      providerId: scope.providerId,
      modelId: scope.modelId,
      toolProfile: scope.toolProfile
    })
  }
}

function isTokenCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function isProviderAttemptUsage(
  usage: NonNullable<ToolSurfaceProviderAttemptDiagnostic['usage']>
): boolean {
  return (
    isTokenCount(usage.inputTokens) &&
    (usage.outputTokens === undefined || isTokenCount(usage.outputTokens)) &&
    (usage.cacheReadTokens === undefined || isTokenCount(usage.cacheReadTokens)) &&
    (usage.cacheWriteTokens === undefined || isTokenCount(usage.cacheWriteTokens))
  )
}

function isUnchangedSurface(overlap: ToolSurfaceStaticDefinitionOverlap): boolean {
  return (
    overlap.previousCount === overlap.currentCount &&
    overlap.previousCount === overlap.retainedCount
  )
}
