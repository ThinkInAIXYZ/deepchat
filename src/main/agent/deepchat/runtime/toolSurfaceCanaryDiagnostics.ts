import type { DeepChatToolProfileKind } from '@/agent/deepchat/instance/deepChatAgentInstance'
import type { LoopRunToolSurfaceMode } from '@/agent/deepchat/loop/loopRun'
import { hashJsonData } from '@/tape/domain/canonicalJson'
import type { ToolSurfaceProviderAttemptDiagnostic } from './toolSurfaceDiagnostics'
import type { ToolSurfaceSnapshot } from './toolSurface'
import {
  TOOL_SURFACE_PROVIDER_PRICING_POLICY_V1,
  ToolSurfaceProviderPricingCatalogV1,
  type ToolSurfaceBilledCostResult,
  type ToolSurfaceProviderPricingPolicyV1
} from './toolSurfaceCanaryPricing'

export const TOOL_SURFACE_CANARY_DIAGNOSTICS_SCHEMA_VERSION = 4
export const MAX_TOOL_SURFACE_PROVIDER_ATTEMPTS_PER_RUN = 64

const DEFAULT_SAMPLE_CAPACITY = 256
const MAX_SAMPLE_CAPACITY = 4_096
const DEFAULT_COHORT_CAPACITY = 64
const MAX_COHORT_CAPACITY = 256
const DEFAULT_LINEAGE_CAPACITY = 512
const MAX_LINEAGE_CAPACITY = 2_048
const MAX_SCOPE_FIELD_CODE_UNITS = 1_024
const MAX_SCOPE_FIELD_BYTES = 4_096
const MAX_DISCOVERY_CALLS_PER_RUN = 256
const MAX_DISCOVERY_TARGETS_PER_CALL = 64
const MAX_DISCOVERY_TARGETS_PER_RUN = 2_048
const MAX_TOOL_RESULTS_PER_RUN = 2_048
const ACTUAL_ADAPTER_MODES = Object.freeze([
  'full',
  'native-activation',
  'cli-programmatic'
] as const)

export type ToolSurfaceCatalogBand = '0-32' | '33-64' | '65-256' | '257+'
export type ToolSurfaceCanaryRunOutcome =
  | 'completed'
  | 'paused'
  | 'aborted'
  | 'error'
  | 'unsettled'

export type ToolSurfaceCanaryCostUnavailableReason = Exclude<
  ToolSurfaceBilledCostResult['status'],
  'available'
>

export interface ToolSurfaceCanaryRunEvidenceSnapshot {
  readonly truncated: boolean
  readonly discovery: Readonly<{
    searchCalls: number
    describeCalls: number
    failedCalls: number
    zeroResultCalls: number
    returnedTargetResults: number
    repeatedSearchTargetResults: number
  }>
  readonly quality: Readonly<{
    settledToolResults: number
    successfulSettledToolResults: number
    failedSettledToolResults: number
  }>
}

export interface ToolSurfaceCanaryRunEvidenceRecorder {
  recordDiscovery(input: {
    readonly kind: 'search' | 'describe'
    readonly stableTargetKeys: readonly string[]
    readonly failed?: boolean
  }): void
  recordSettledToolResult(success: boolean): void
  snapshot(): ToolSurfaceCanaryRunEvidenceSnapshot
}

export interface ToolSurfaceCanaryDiagnosticsScope {
  readonly sessionId: string
  readonly providerId: string
  readonly modelId: string
  readonly toolProfile: DeepChatToolProfileKind
}

export interface ToolSurfaceCanaryDistribution {
  readonly samples: number
  readonly p50: number | null
  readonly p95: number | null
  readonly max: number | null
}

export interface ToolSurfaceCanaryCohortSnapshot {
  readonly adapterMode: Exclude<LoopRunToolSurfaceMode, 'legacy'>
  readonly policyVersion: string
  readonly pricingVersion: string
  readonly catalogBand: ToolSurfaceCatalogBand
  readonly toolProfile: DeepChatToolProfileKind
  readonly runs: {
    readonly observed: number
    readonly outcomes: Readonly<Record<ToolSurfaceCanaryRunOutcome, number>>
    readonly catalogComparisons: number
    readonly catalogChanges: number
    readonly providerAttemptSamplesTruncated: number
    readonly evidenceTruncated: number
  }
  readonly attempts: {
    readonly observed: number
    readonly withUsage: number
    readonly withCacheReadMetric: number
    readonly withCacheWriteMetric: number
  }
  readonly discovery: {
    readonly searchCalls: number
    readonly describeCalls: number
    readonly failedCalls: number
    readonly zeroResultCalls: number
    readonly returnedTargetResults: number
    readonly repeatedSearchTargetResults: number
  }
  readonly quality: {
    readonly settledToolResults: number
    readonly successfulSettledToolResults: number
    readonly failedSettledToolResults: number
  }
  readonly cost: {
    readonly currency: 'USD'
    readonly pricedRuns: number
    readonly unavailableRuns: Readonly<Record<ToolSurfaceCanaryCostUnavailableReason, number>>
  }
  readonly metrics: {
    readonly durationMs: ToolSurfaceCanaryDistribution
    readonly ttftMs: ToolSurfaceCanaryDistribution
    readonly providerRounds: ToolSurfaceCanaryDistribution
    readonly extraProviderRounds: ToolSurfaceCanaryDistribution
    readonly requestSequences: ToolSurfaceCanaryDistribution
    readonly physicalAttempts: ToolSurfaceCanaryDistribution
    readonly inputTokens: ToolSurfaceCanaryDistribution
    readonly outputTokens: ToolSurfaceCanaryDistribution
    readonly cacheReadTokens: ToolSurfaceCanaryDistribution
    readonly cacheWriteTokens: ToolSurfaceCanaryDistribution
    readonly catalogDefinitionTokens: ToolSurfaceCanaryDistribution
    readonly billedCostNanoUsd: ToolSurfaceCanaryDistribution
    readonly discoveryCalls: ToolSurfaceCanaryDistribution
    readonly repeatedSearchTargetResults: ToolSurfaceCanaryDistribution
    readonly settledToolResults: ToolSurfaceCanaryDistribution
  }
}

export interface ToolSurfaceCanaryAssignmentSnapshot {
  readonly toolProfile: DeepChatToolProfileKind
  readonly cliProgrammaticCapability: 'proven' | 'unproven'
  readonly entered: number
  readonly selected: number
  readonly setupFailed: number
  readonly aborted: number
  readonly excluded: number
  readonly inFlight: number
  readonly selectedByAdapter: Readonly<
    Record<Exclude<LoopRunToolSurfaceMode, 'legacy'>, number>
  >
}

export interface ToolSurfaceCanaryDiagnosticsSnapshot {
  readonly schemaVersion: typeof TOOL_SURFACE_CANARY_DIAGNOSTICS_SCHEMA_VERSION
  readonly recording: Readonly<{
    globalRejectedRuns: number
  }>
  readonly assignments: readonly ToolSurfaceCanaryAssignmentSnapshot[]
  readonly cohorts: readonly ToolSurfaceCanaryCohortSnapshot[]
}

class BoundedNumberRing {
  private readonly values: number[]
  private nextIndex = 0
  private size = 0

  constructor(private readonly capacity: number) {
    this.values = Array<number>(capacity)
  }

  push(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) return
    this.values[this.nextIndex] = value
    this.nextIndex = (this.nextIndex + 1) % this.capacity
    this.size = Math.min(this.size + 1, this.capacity)
  }

  snapshot(): number[] {
    if (this.size < this.capacity) return this.values.slice(0, this.size)
    return [...this.values.slice(this.nextIndex), ...this.values.slice(0, this.nextIndex)]
  }
}

function distribution(values: readonly number[]): ToolSurfaceCanaryDistribution {
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

function increment(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, value + 1)
}

function addSafe(left: number, right: number): number {
  if (!Number.isSafeInteger(right) || right < 0) return left
  return Math.min(Number.MAX_SAFE_INTEGER, left + right)
}

const evidenceBySnapshot = new WeakMap<ToolSurfaceSnapshot, ToolSurfaceCanaryRunEvidenceRecorder>()

class BoundedToolSurfaceCanaryRunEvidence implements ToolSurfaceCanaryRunEvidenceRecorder {
  private truncated = false
  private searchCalls = 0
  private describeCalls = 0
  private failedCalls = 0
  private zeroResultCalls = 0
  private returnedTargetResults = 0
  private repeatedSearchTargetResults = 0
  private settledToolResults = 0
  private successfulSettledToolResults = 0
  private failedSettledToolResults = 0
  private readonly seenSearchTargetHashes = new Set<string>()

  recordDiscovery(input: {
    readonly kind: 'search' | 'describe'
    readonly stableTargetKeys: readonly string[]
    readonly failed?: boolean
  }): void {
    try {
      if (this.searchCalls + this.describeCalls >= MAX_DISCOVERY_CALLS_PER_RUN) {
        this.truncated = true
        return
      }
      if (input.kind === 'search') this.searchCalls = increment(this.searchCalls)
      else if (input.kind === 'describe') this.describeCalls = increment(this.describeCalls)
      else {
        this.truncated = true
        return
      }
      if (input.failed === true) {
        this.failedCalls = increment(this.failedCalls)
        return
      }
      if (!Array.isArray(input.stableTargetKeys)) {
        this.truncated = true
        return
      }
      if (input.stableTargetKeys.length === 0) {
        this.zeroResultCalls = increment(this.zeroResultCalls)
        return
      }
      if (input.stableTargetKeys.length > MAX_DISCOVERY_TARGETS_PER_CALL) {
        this.truncated = true
      }
      for (const stableTargetKey of input.stableTargetKeys.slice(
        0,
        MAX_DISCOVERY_TARGETS_PER_CALL
      )) {
        if (
          !isBoundedField(stableTargetKey) ||
          this.returnedTargetResults >= MAX_DISCOVERY_TARGETS_PER_RUN
        ) {
          this.truncated = true
          continue
        }
        this.returnedTargetResults = increment(this.returnedTargetResults)
        const targetHash = hashJsonData({
          domain: 'tool-surface-canary-discovered-target-v1',
          stableTargetKey
        })
        if (input.kind === 'search') {
          if (this.seenSearchTargetHashes.has(targetHash)) {
            this.repeatedSearchTargetResults = increment(this.repeatedSearchTargetResults)
          } else {
            this.seenSearchTargetHashes.add(targetHash)
          }
        }
      }
    } catch {
      this.truncated = true
    }
  }

  recordSettledToolResult(success: boolean): void {
    if (this.settledToolResults >= MAX_TOOL_RESULTS_PER_RUN || typeof success !== 'boolean') {
      this.truncated = true
      return
    }
    this.settledToolResults = increment(this.settledToolResults)
    if (success) {
      this.successfulSettledToolResults = increment(this.successfulSettledToolResults)
    } else {
      this.failedSettledToolResults = increment(this.failedSettledToolResults)
    }
  }

  snapshot(): ToolSurfaceCanaryRunEvidenceSnapshot {
    return Object.freeze({
      truncated: this.truncated,
      discovery: Object.freeze({
        searchCalls: this.searchCalls,
        describeCalls: this.describeCalls,
        failedCalls: this.failedCalls,
        zeroResultCalls: this.zeroResultCalls,
        returnedTargetResults: this.returnedTargetResults,
        repeatedSearchTargetResults: this.repeatedSearchTargetResults
      }),
      quality: Object.freeze({
        settledToolResults: this.settledToolResults,
        successfulSettledToolResults: this.successfulSettledToolResults,
        failedSettledToolResults: this.failedSettledToolResults
      })
    })
  }
}

export function createToolSurfaceCanaryRunEvidenceRecorder(): ToolSurfaceCanaryRunEvidenceRecorder {
  return new BoundedToolSurfaceCanaryRunEvidence()
}

/** Binds process-live diagnostics only; failure never changes View admission or dispatch. */
export function bindToolSurfaceCanaryRunEvidence(
  snapshot: ToolSurfaceSnapshot,
  recorder: ToolSurfaceCanaryRunEvidenceRecorder
): void {
  try {
    if (!snapshot || typeof snapshot !== 'object' || !recorder) return
    const existing = evidenceBySnapshot.get(snapshot)
    if (!existing) evidenceBySnapshot.set(snapshot, recorder)
  } catch {}
}

export function recordToolSurfaceCanaryDiscovery(
  snapshot: ToolSurfaceSnapshot,
  input: Parameters<ToolSurfaceCanaryRunEvidenceRecorder['recordDiscovery']>[0]
): void {
  try {
    evidenceBySnapshot.get(snapshot)?.recordDiscovery(input)
  } catch {}
}

export function recordToolSurfaceCanarySettledToolResult(
  snapshot: ToolSurfaceSnapshot,
  success: boolean
): void {
  try {
    evidenceBySnapshot.get(snapshot)?.recordSettledToolResult(success)
  } catch {}
}

function isBoundedField(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_SCOPE_FIELD_CODE_UNITS &&
    value === value.trim() &&
    !value.includes('\0') &&
    Buffer.byteLength(value, 'utf8') <= MAX_SCOPE_FIELD_BYTES
  )
}

function sessionKey(sessionId: string): string {
  return hashJsonData({ domain: 'tool-surface-canary-session-v1', sessionId })
}

function isToolProfile(value: string): value is DeepChatToolProfileKind {
  return value === 'code' || value === 'research' || value === 'analysis' || value === 'general'
}

function isTokenCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isProviderAttemptDiagnostic(value: unknown): value is ToolSurfaceProviderAttemptDiagnostic {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const attempt = value as Partial<ToolSurfaceProviderAttemptDiagnostic>
  if (
    !Number.isSafeInteger(attempt.requestSeq) ||
    (attempt.requestSeq as number) <= 0 ||
    !Number.isSafeInteger(attempt.physicalAttempt) ||
    (attempt.physicalAttempt as number) <= 0
  ) {
    return false
  }
  if (attempt.usage === null) return true
  if (!attempt.usage || typeof attempt.usage !== 'object' || Array.isArray(attempt.usage)) {
    return false
  }
  return (
    isTokenCount(attempt.usage.inputTokens) &&
    (attempt.usage.outputTokens === undefined || isTokenCount(attempt.usage.outputTokens)) &&
    (attempt.usage.cacheReadTokens === undefined ||
      isTokenCount(attempt.usage.cacheReadTokens)) &&
    (attempt.usage.cacheWriteTokens === undefined ||
      isTokenCount(attempt.usage.cacheWriteTokens))
  )
}

function catalogBand(toolCount: number): ToolSurfaceCatalogBand {
  if (toolCount <= 32) return '0-32'
  if (toolCount <= 64) return '33-64'
  if (toolCount <= 256) return '65-256'
  return '257+'
}

function emptyOutcomes(): Record<ToolSurfaceCanaryRunOutcome, number> {
  return { completed: 0, paused: 0, aborted: 0, error: 0, unsettled: 0 }
}

function emptyCostUnavailableReasons(): Record<ToolSurfaceCanaryCostUnavailableReason, number> {
  return {
    'missing-pricing': 0,
    'incomplete-usage': 0,
    'missing-cache-metrics': 0,
    'invalid-accounting': 0,
    overflow: 0,
    truncated: 0
  }
}

class ToolSurfaceCanaryCohort {
  private observedRuns = 0
  private readonly outcomes = emptyOutcomes()
  private catalogComparisons = 0
  private catalogChanges = 0
  private providerAttemptSamplesTruncated = 0
  private evidenceTruncated = 0
  private observedAttempts = 0
  private attemptsWithUsage = 0
  private attemptsWithCacheReadMetric = 0
  private attemptsWithCacheWriteMetric = 0
  private discoverySearchCalls = 0
  private discoveryDescribeCalls = 0
  private discoveryFailedCalls = 0
  private discoveryZeroResultCalls = 0
  private discoveryReturnedTargetResults = 0
  private discoveryRepeatedSearchTargetResults = 0
  private qualitySettledToolResults = 0
  private qualitySuccessfulSettledToolResults = 0
  private qualityFailedSettledToolResults = 0
  private pricedRuns = 0
  private readonly costUnavailableReasons = emptyCostUnavailableReasons()
  private readonly durationMs: BoundedNumberRing
  private readonly ttftMs: BoundedNumberRing
  private readonly providerRounds: BoundedNumberRing
  private readonly extraProviderRounds: BoundedNumberRing
  private readonly requestSequences: BoundedNumberRing
  private readonly physicalAttempts: BoundedNumberRing
  private readonly inputTokens: BoundedNumberRing
  private readonly outputTokens: BoundedNumberRing
  private readonly cacheReadTokens: BoundedNumberRing
  private readonly cacheWriteTokens: BoundedNumberRing
  private readonly catalogDefinitionTokens: BoundedNumberRing
  private readonly billedCostNanoUsd: BoundedNumberRing
  private readonly discoveryCalls: BoundedNumberRing
  private readonly repeatedSearchTargetResults: BoundedNumberRing
  private readonly settledToolResults: BoundedNumberRing

  constructor(
    private readonly identity: Omit<
      ToolSurfaceCanaryCohortSnapshot,
      'runs' | 'attempts' | 'discovery' | 'quality' | 'cost' | 'metrics'
    >,
    sampleCapacity: number
  ) {
    this.durationMs = new BoundedNumberRing(sampleCapacity)
    this.ttftMs = new BoundedNumberRing(sampleCapacity)
    this.providerRounds = new BoundedNumberRing(sampleCapacity)
    this.extraProviderRounds = new BoundedNumberRing(sampleCapacity)
    this.requestSequences = new BoundedNumberRing(sampleCapacity)
    this.physicalAttempts = new BoundedNumberRing(sampleCapacity)
    this.inputTokens = new BoundedNumberRing(sampleCapacity)
    this.outputTokens = new BoundedNumberRing(sampleCapacity)
    this.cacheReadTokens = new BoundedNumberRing(sampleCapacity)
    this.cacheWriteTokens = new BoundedNumberRing(sampleCapacity)
    this.catalogDefinitionTokens = new BoundedNumberRing(sampleCapacity)
    this.billedCostNanoUsd = new BoundedNumberRing(sampleCapacity)
    this.discoveryCalls = new BoundedNumberRing(sampleCapacity)
    this.repeatedSearchTargetResults = new BoundedNumberRing(sampleCapacity)
    this.settledToolResults = new BoundedNumberRing(sampleCapacity)
  }

  record(input: {
    readonly outcome: ToolSurfaceCanaryRunOutcome
    readonly durationMs: number
    readonly ttftMs: number | null
    readonly providerRounds: number
    readonly catalogDefinitionTokens: number
    readonly catalogRelation: 'first' | 'unchanged' | 'changed'
    readonly providerAttempts: readonly ToolSurfaceProviderAttemptDiagnostic[]
    readonly providerAttemptsTruncated: boolean
    readonly evidence: ToolSurfaceCanaryRunEvidenceSnapshot
    readonly billedCost: ToolSurfaceBilledCostResult
  }): void {
    this.observedRuns = increment(this.observedRuns)
    this.outcomes[input.outcome] = increment(this.outcomes[input.outcome])
    this.durationMs.push(input.durationMs)
    if (input.ttftMs !== null) this.ttftMs.push(input.ttftMs)
    this.providerRounds.push(input.providerRounds)
    this.extraProviderRounds.push(Math.max(0, input.providerRounds - 1))
    this.catalogDefinitionTokens.push(input.catalogDefinitionTokens)
    if (input.catalogRelation !== 'first') {
      this.catalogComparisons = increment(this.catalogComparisons)
      if (input.catalogRelation === 'changed') {
        this.catalogChanges = increment(this.catalogChanges)
      }
    }
    if (input.providerAttemptsTruncated) {
      this.providerAttemptSamplesTruncated = increment(this.providerAttemptSamplesTruncated)
    }
    if (input.evidence.truncated) this.evidenceTruncated = increment(this.evidenceTruncated)
    this.discoverySearchCalls = addSafe(
      this.discoverySearchCalls,
      input.evidence.discovery.searchCalls
    )
    this.discoveryDescribeCalls = addSafe(
      this.discoveryDescribeCalls,
      input.evidence.discovery.describeCalls
    )
    this.discoveryFailedCalls = addSafe(
      this.discoveryFailedCalls,
      input.evidence.discovery.failedCalls
    )
    this.discoveryZeroResultCalls = addSafe(
      this.discoveryZeroResultCalls,
      input.evidence.discovery.zeroResultCalls
    )
    this.discoveryReturnedTargetResults = addSafe(
      this.discoveryReturnedTargetResults,
      input.evidence.discovery.returnedTargetResults
    )
    this.discoveryRepeatedSearchTargetResults = addSafe(
      this.discoveryRepeatedSearchTargetResults,
      input.evidence.discovery.repeatedSearchTargetResults
    )
    this.qualitySettledToolResults = addSafe(
      this.qualitySettledToolResults,
      input.evidence.quality.settledToolResults
    )
    this.qualitySuccessfulSettledToolResults = addSafe(
      this.qualitySuccessfulSettledToolResults,
      input.evidence.quality.successfulSettledToolResults
    )
    this.qualityFailedSettledToolResults = addSafe(
      this.qualityFailedSettledToolResults,
      input.evidence.quality.failedSettledToolResults
    )
    this.discoveryCalls.push(
      input.evidence.discovery.searchCalls + input.evidence.discovery.describeCalls
    )
    this.repeatedSearchTargetResults.push(
      input.evidence.discovery.repeatedSearchTargetResults
    )
    this.settledToolResults.push(input.evidence.quality.settledToolResults)
    if (input.billedCost.status === 'available') {
      this.pricedRuns = increment(this.pricedRuns)
      this.billedCostNanoUsd.push(input.billedCost.billedCostNanoUsd)
    } else {
      this.costUnavailableReasons[input.billedCost.status] = increment(
        this.costUnavailableReasons[input.billedCost.status]
      )
    }

    let runInputTokens = 0
    let runOutputTokens = 0
    let runCacheReadTokens = 0
    let runCacheWriteTokens = 0
    let hasCompleteInputUsage = input.providerAttempts.length > 0
    let hasCompleteOutputUsage = input.providerAttempts.length > 0
    let hasCompleteCacheReadUsage = input.providerAttempts.length > 0
    let hasCompleteCacheWriteUsage = input.providerAttempts.length > 0
    const requestSequences = new Set<number>()
    for (const attempt of input.providerAttempts) {
      this.observedAttempts = increment(this.observedAttempts)
      if (Number.isSafeInteger(attempt.requestSeq) && attempt.requestSeq > 0) {
        requestSequences.add(attempt.requestSeq)
      }
      if (!attempt.usage) {
        hasCompleteInputUsage = false
        hasCompleteOutputUsage = false
        hasCompleteCacheReadUsage = false
        hasCompleteCacheWriteUsage = false
        continue
      }
      this.attemptsWithUsage = increment(this.attemptsWithUsage)
      runInputTokens = addSafe(runInputTokens, attempt.usage.inputTokens)
      if (attempt.usage.outputTokens !== undefined) {
        runOutputTokens = addSafe(runOutputTokens, attempt.usage.outputTokens)
      } else {
        hasCompleteOutputUsage = false
      }
      if (attempt.usage.cacheReadTokens !== undefined) {
        this.attemptsWithCacheReadMetric = increment(this.attemptsWithCacheReadMetric)
        runCacheReadTokens = addSafe(runCacheReadTokens, attempt.usage.cacheReadTokens)
      } else {
        hasCompleteCacheReadUsage = false
      }
      if (attempt.usage.cacheWriteTokens !== undefined) {
        this.attemptsWithCacheWriteMetric = increment(this.attemptsWithCacheWriteMetric)
        runCacheWriteTokens = addSafe(runCacheWriteTokens, attempt.usage.cacheWriteTokens)
      } else {
        hasCompleteCacheWriteUsage = false
      }
    }
    this.requestSequences.push(requestSequences.size)
    this.physicalAttempts.push(input.providerAttempts.length)
    if (hasCompleteInputUsage) this.inputTokens.push(runInputTokens)
    if (hasCompleteOutputUsage) this.outputTokens.push(runOutputTokens)
    if (hasCompleteCacheReadUsage) this.cacheReadTokens.push(runCacheReadTokens)
    if (hasCompleteCacheWriteUsage) this.cacheWriteTokens.push(runCacheWriteTokens)
  }

  snapshot(): ToolSurfaceCanaryCohortSnapshot {
    return {
      ...this.identity,
      runs: {
        observed: this.observedRuns,
        outcomes: { ...this.outcomes },
        catalogComparisons: this.catalogComparisons,
        catalogChanges: this.catalogChanges,
        providerAttemptSamplesTruncated: this.providerAttemptSamplesTruncated,
        evidenceTruncated: this.evidenceTruncated
      },
      attempts: {
        observed: this.observedAttempts,
        withUsage: this.attemptsWithUsage,
        withCacheReadMetric: this.attemptsWithCacheReadMetric,
        withCacheWriteMetric: this.attemptsWithCacheWriteMetric
      },
      discovery: {
        searchCalls: this.discoverySearchCalls,
        describeCalls: this.discoveryDescribeCalls,
        failedCalls: this.discoveryFailedCalls,
        zeroResultCalls: this.discoveryZeroResultCalls,
        returnedTargetResults: this.discoveryReturnedTargetResults,
        repeatedSearchTargetResults: this.discoveryRepeatedSearchTargetResults
      },
      quality: {
        settledToolResults: this.qualitySettledToolResults,
        successfulSettledToolResults: this.qualitySuccessfulSettledToolResults,
        failedSettledToolResults: this.qualityFailedSettledToolResults
      },
      cost: {
        currency: 'USD',
        pricedRuns: this.pricedRuns,
        unavailableRuns: { ...this.costUnavailableReasons }
      },
      metrics: {
        durationMs: distribution(this.durationMs.snapshot()),
        ttftMs: distribution(this.ttftMs.snapshot()),
        providerRounds: distribution(this.providerRounds.snapshot()),
        extraProviderRounds: distribution(this.extraProviderRounds.snapshot()),
        requestSequences: distribution(this.requestSequences.snapshot()),
        physicalAttempts: distribution(this.physicalAttempts.snapshot()),
        inputTokens: distribution(this.inputTokens.snapshot()),
        outputTokens: distribution(this.outputTokens.snapshot()),
        cacheReadTokens: distribution(this.cacheReadTokens.snapshot()),
        cacheWriteTokens: distribution(this.cacheWriteTokens.snapshot()),
        catalogDefinitionTokens: distribution(this.catalogDefinitionTokens.snapshot()),
        billedCostNanoUsd: distribution(this.billedCostNanoUsd.snapshot()),
        discoveryCalls: distribution(this.discoveryCalls.snapshot()),
        repeatedSearchTargetResults: distribution(this.repeatedSearchTargetResults.snapshot()),
        settledToolResults: distribution(this.settledToolResults.snapshot())
      }
    }
  }
}

type CohortEntry = {
  readonly providerModelKey: string
  readonly cohort: ToolSurfaceCanaryCohort
}

type AssignmentEntry = {
  readonly providerModelKey: string
  readonly toolProfile: DeepChatToolProfileKind
  readonly cliProgrammaticCapability: 'proven' | 'unproven'
  entered: number
  selected: number
  setupFailed: number
  aborted: number
  excluded: number
  readonly selectedByAdapter: Record<Exclude<LoopRunToolSurfaceMode, 'legacy'>, number>
}

type PriorCatalogEntry = Readonly<{
  sessionKey: string
  catalogHash: string
}>

/** Bounded process-live canary metrics. This registry never reads Tape or participates in routing. */
export class ToolSurfaceCanaryDiagnosticsRegistry {
  private readonly cohorts = new Map<string, CohortEntry>()
  private readonly assignments = new Map<string, AssignmentEntry>()
  private readonly priorCatalogs = new Map<string, PriorCatalogEntry>()
  private globalRejectedRuns = 0
  private readonly sampleCapacity: number
  private readonly cohortCapacity: number
  private readonly lineageCapacity: number
  private readonly pricing: ToolSurfaceProviderPricingCatalogV1

  constructor(options: {
    readonly sampleCapacity?: number
    readonly cohortCapacity?: number
    readonly lineageCapacity?: number
    readonly pricingPolicy?: ToolSurfaceProviderPricingPolicyV1
  } = {}) {
    this.sampleCapacity = this.boundCapacity(
      options.sampleCapacity,
      DEFAULT_SAMPLE_CAPACITY,
      MAX_SAMPLE_CAPACITY
    )
    this.cohortCapacity = this.boundCapacity(
      options.cohortCapacity,
      DEFAULT_COHORT_CAPACITY,
      MAX_COHORT_CAPACITY
    )
    this.lineageCapacity = this.boundCapacity(
      options.lineageCapacity,
      DEFAULT_LINEAGE_CAPACITY,
      MAX_LINEAGE_CAPACITY
    )
    this.pricing = new ToolSurfaceProviderPricingCatalogV1(
      options.pricingPolicy ?? TOOL_SURFACE_PROVIDER_PRICING_POLICY_V1
    )
  }

  recordAutomaticAssignment(input: {
    readonly scope: ToolSurfaceCanaryDiagnosticsScope
    readonly cliProgrammaticCapability: 'proven' | 'unproven'
    readonly phase: 'entered' | 'selected' | 'setup-failed' | 'aborted' | 'excluded'
    readonly adapterMode?: Exclude<LoopRunToolSurfaceMode, 'legacy'>
  }): void {
    try {
      if (
        !this.validScope(input.scope) ||
        (input.cliProgrammaticCapability !== 'proven' &&
          input.cliProgrammaticCapability !== 'unproven') ||
        !['entered', 'selected', 'setup-failed', 'aborted', 'excluded'].includes(input.phase) ||
        (input.phase !== 'selected' && input.adapterMode !== undefined) ||
        (input.phase === 'selected' &&
          !(ACTUAL_ADAPTER_MODES as readonly string[]).includes(input.adapterMode ?? ''))
      ) {
        return
      }
      const providerModelKey = hashJsonData({
        domain: 'tool-surface-canary-provider-model-v1',
        providerId: input.scope.providerId,
        modelId: input.scope.modelId
      })
      const assignmentKey = hashJsonData({
        domain: 'tool-surface-canary-assignment-v1',
        providerModelKey,
        toolProfile: input.scope.toolProfile,
        cliProgrammaticCapability: input.cliProgrammaticCapability
      })
      let entry = this.assignments.get(assignmentKey)
      if (!entry) {
        entry = {
          providerModelKey,
          toolProfile: input.scope.toolProfile,
          cliProgrammaticCapability: input.cliProgrammaticCapability,
          entered: 0,
          selected: 0,
          setupFailed: 0,
          aborted: 0,
          excluded: 0,
          selectedByAdapter: { full: 0, 'native-activation': 0, 'cli-programmatic': 0 }
        }
      }
      if (input.phase === 'entered') {
        entry.entered = increment(entry.entered)
      } else if (input.phase === 'selected') {
        entry.selected = increment(entry.selected)
        const adapterMode = input.adapterMode!
        entry.selectedByAdapter[adapterMode] = increment(entry.selectedByAdapter[adapterMode])
      } else if (input.phase === 'setup-failed') {
        entry.setupFailed = increment(entry.setupFailed)
      } else if (input.phase === 'aborted') {
        entry.aborted = increment(entry.aborted)
      } else {
        entry.excluded = increment(entry.excluded)
      }
      this.assignments.delete(assignmentKey)
      this.assignments.set(assignmentKey, entry)
      this.trimMap(this.assignments, this.cohortCapacity)
    } catch {}
  }

  recordRun(input: {
    readonly scope: ToolSurfaceCanaryDiagnosticsScope
    readonly adapterMode: Exclude<LoopRunToolSurfaceMode, 'legacy'>
    readonly policyVersion: string
    readonly catalogHash: string
    readonly catalogToolCount: number
    readonly catalogDefinitionTokens: number
    readonly outcome: ToolSurfaceCanaryRunOutcome
    readonly durationMs: number
    readonly ttftMs: number | null
    readonly providerRounds: number
    readonly providerAttempts: readonly ToolSurfaceProviderAttemptDiagnostic[]
    readonly providerAttemptsTruncated: boolean
    readonly evidence: ToolSurfaceCanaryRunEvidenceSnapshot
  }): void {
    try {
      if (
        !this.validScope(input.scope) ||
        !isBoundedField(input.policyVersion) ||
        !isBoundedField(input.catalogHash) ||
        !Number.isSafeInteger(input.catalogToolCount) ||
        input.catalogToolCount < 0 ||
        !Number.isSafeInteger(input.catalogDefinitionTokens) ||
        input.catalogDefinitionTokens < 0 ||
        !Number.isSafeInteger(input.durationMs) ||
        input.durationMs < 0 ||
        (input.ttftMs !== null &&
          (!Number.isSafeInteger(input.ttftMs) || input.ttftMs < 0)) ||
        !Number.isSafeInteger(input.providerRounds) ||
        input.providerRounds < 0 ||
        !(ACTUAL_ADAPTER_MODES as readonly string[]).includes(input.adapterMode) ||
        !['completed', 'paused', 'aborted', 'error', 'unsettled'].includes(input.outcome) ||
        !Array.isArray(input.providerAttempts) ||
        input.providerAttempts.length > MAX_TOOL_SURFACE_PROVIDER_ATTEMPTS_PER_RUN ||
        !input.providerAttempts.every(isProviderAttemptDiagnostic) ||
        typeof input.providerAttemptsTruncated !== 'boolean' ||
        !this.validEvidence(input.evidence)
      ) {
        this.globalRejectedRuns = increment(this.globalRejectedRuns)
        return
      }
      const providerModelKey = hashJsonData({
        domain: 'tool-surface-canary-provider-model-v1',
        providerId: input.scope.providerId,
        modelId: input.scope.modelId
      })
      const band = catalogBand(input.catalogToolCount)
      const cohortKey = hashJsonData({
        domain: 'tool-surface-canary-cohort-v1',
        providerModelKey,
        adapterMode: input.adapterMode,
        policyVersion: input.policyVersion,
        pricingVersion: this.pricing.pricingVersion,
        catalogBand: band,
        toolProfile: input.scope.toolProfile
      })
      const lineageKey = hashJsonData({
        domain: 'tool-surface-canary-lineage-v1',
        sessionId: input.scope.sessionId,
        providerModelKey,
        adapterMode: input.adapterMode,
        policyVersion: input.policyVersion,
        toolProfile: input.scope.toolProfile
      })
      const previousCatalogHash = this.priorCatalogs.get(lineageKey)?.catalogHash
      const catalogRelation =
        previousCatalogHash === undefined
          ? 'first'
          : previousCatalogHash === input.catalogHash
            ? 'unchanged'
            : 'changed'
      this.priorCatalogs.delete(lineageKey)
      this.priorCatalogs.set(
        lineageKey,
        Object.freeze({
          sessionKey: sessionKey(input.scope.sessionId),
          catalogHash: input.catalogHash
        })
      )
      this.trimMap(this.priorCatalogs, this.lineageCapacity)

      let entry = this.cohorts.get(cohortKey)
      if (!entry) {
        entry = {
          providerModelKey,
          cohort: new ToolSurfaceCanaryCohort(
            {
              adapterMode: input.adapterMode,
              policyVersion: input.policyVersion,
              pricingVersion: this.pricing.pricingVersion,
              catalogBand: band,
              toolProfile: input.scope.toolProfile
            },
            this.sampleCapacity
          )
        }
      }
      this.cohorts.delete(cohortKey)
      this.cohorts.set(cohortKey, entry)
      this.trimMap(this.cohorts, this.cohortCapacity)
      entry.cohort.record({
        outcome: input.outcome,
        durationMs: input.durationMs,
        ttftMs: input.ttftMs,
        providerRounds: input.providerRounds,
        catalogDefinitionTokens: input.catalogDefinitionTokens,
        catalogRelation,
        providerAttempts: input.providerAttempts,
        providerAttemptsTruncated: input.providerAttemptsTruncated,
        evidence: input.evidence,
        billedCost: this.pricing.calculate({
          providerId: input.scope.providerId,
          modelId: input.scope.modelId,
          attempts: input.providerAttempts,
          attemptsTruncated: input.providerAttemptsTruncated
        })
      })
    } catch {
      this.globalRejectedRuns = increment(this.globalRejectedRuns)
    }
  }

  clearSession(sessionId: string): void {
    if (!isBoundedField(sessionId)) return
    const deletedSessionKey = sessionKey(sessionId)
    for (const [lineageKey, entry] of this.priorCatalogs) {
      if (entry.sessionKey === deletedSessionKey) this.priorCatalogs.delete(lineageKey)
    }
  }

  snapshot(input: {
    readonly providerId: string
    readonly modelId: string
  }): ToolSurfaceCanaryDiagnosticsSnapshot | null {
    if (!isBoundedField(input.providerId) || !isBoundedField(input.modelId)) return null
    const providerModelKey = hashJsonData({
      domain: 'tool-surface-canary-provider-model-v1',
      providerId: input.providerId,
      modelId: input.modelId
    })
    const assignments = [...this.assignments.values()]
      .filter((entry) => entry.providerModelKey === providerModelKey)
      .map((entry) => ({
        toolProfile: entry.toolProfile,
        cliProgrammaticCapability: entry.cliProgrammaticCapability,
        entered: entry.entered,
        selected: entry.selected,
        setupFailed: entry.setupFailed,
        aborted: entry.aborted,
        excluded: entry.excluded,
        inFlight: Math.max(
          0,
          entry.entered - entry.selected - entry.setupFailed - entry.aborted - entry.excluded
        ),
        selectedByAdapter: { ...entry.selectedByAdapter }
      }))
      .sort((left, right) =>
        `${left.toolProfile}\0${left.cliProgrammaticCapability}`.localeCompare(
          `${right.toolProfile}\0${right.cliProgrammaticCapability}`
        )
      )
    const cohorts = [...this.cohorts.values()]
      .filter((entry) => entry.providerModelKey === providerModelKey)
      .map((entry) => entry.cohort.snapshot())
      .sort((left, right) =>
        `${left.adapterMode}\0${left.policyVersion}\0${left.pricingVersion}\0${left.catalogBand}\0${left.toolProfile}`.localeCompare(
          `${right.adapterMode}\0${right.policyVersion}\0${right.pricingVersion}\0${right.catalogBand}\0${right.toolProfile}`
        )
      )
    return assignments.length === 0 && cohorts.length === 0 && this.globalRejectedRuns === 0
      ? null
      : {
          schemaVersion: TOOL_SURFACE_CANARY_DIAGNOSTICS_SCHEMA_VERSION,
          recording: { globalRejectedRuns: this.globalRejectedRuns },
          assignments,
          cohorts
        }
  }

  private validScope(scope: ToolSurfaceCanaryDiagnosticsScope): boolean {
    return (
      isBoundedField(scope.sessionId) &&
      isBoundedField(scope.providerId) &&
      isBoundedField(scope.modelId) &&
      isToolProfile(scope.toolProfile)
    )
  }

  private validEvidence(evidence: ToolSurfaceCanaryRunEvidenceSnapshot): boolean {
    if (!evidence || typeof evidence !== 'object' || typeof evidence.truncated !== 'boolean') {
      return false
    }
    const discovery = evidence.discovery
    const quality = evidence.quality
    const counts = [
      discovery?.searchCalls,
      discovery?.describeCalls,
      discovery?.failedCalls,
      discovery?.zeroResultCalls,
      discovery?.returnedTargetResults,
      discovery?.repeatedSearchTargetResults,
      quality?.settledToolResults,
      quality?.successfulSettledToolResults,
      quality?.failedSettledToolResults
    ]
    return (
      counts.every((count) => Number.isSafeInteger(count) && count >= 0) &&
      discovery.searchCalls + discovery.describeCalls <= MAX_DISCOVERY_CALLS_PER_RUN &&
      discovery.failedCalls + discovery.zeroResultCalls <=
        discovery.searchCalls + discovery.describeCalls &&
      discovery.returnedTargetResults <= MAX_DISCOVERY_TARGETS_PER_RUN &&
      discovery.repeatedSearchTargetResults <= discovery.returnedTargetResults &&
      quality.settledToolResults <= MAX_TOOL_RESULTS_PER_RUN &&
      quality.successfulSettledToolResults + quality.failedSettledToolResults ===
        quality.settledToolResults
    )
  }

  private boundCapacity(value: number | undefined, fallback: number, maximum: number): number {
    return value !== undefined && Number.isSafeInteger(value) && value > 0
      ? Math.min(value, maximum)
      : fallback
  }

  private trimMap<K, V>(map: Map<K, V>, capacity: number): void {
    while (map.size > capacity) {
      const oldestKey = map.keys().next().value
      if (oldestKey === undefined) return
      map.delete(oldestKey)
    }
  }
}
