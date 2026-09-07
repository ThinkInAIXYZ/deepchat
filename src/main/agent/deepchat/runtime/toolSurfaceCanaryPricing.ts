import { canonicalJsonStringifyData, hashJsonData } from '@/tape/domain/canonicalJson'
import type { ToolSurfaceProviderAttemptDiagnostic } from './toolSurfaceDiagnostics'

export const TOOL_SURFACE_PROVIDER_PRICING_SCHEMA_VERSION = 1 as const

const MILLION_TOKENS = 1_000_000n
const MAX_PRICING_ENTRIES = 4_096
const MAX_PRICING_POLICY_BYTES = 1024 * 1024
const MAX_PRICING_FIELD_CODE_UNITS = 1_024
const MAX_PRICING_FIELD_BYTES = 4_096

export interface ToolSurfaceProviderPricingV1 {
  readonly providerId: string
  readonly modelId: string
  readonly inputIncludesCacheReadTokens: boolean
  readonly inputIncludesCacheWriteTokens: boolean
  readonly nanoUsdPerMillionTokens: Readonly<{
    uncachedInput: number
    output: number
    cacheRead: number
    cacheWrite: number
  }>
}

export interface ToolSurfaceProviderPricingPolicyV1 {
  readonly schemaVersion: typeof TOOL_SURFACE_PROVIDER_PRICING_SCHEMA_VERSION
  readonly pricingVersion: string
  readonly currency: 'USD'
  readonly entries: readonly ToolSurfaceProviderPricingV1[]
}

export type ToolSurfaceBilledCostResult =
  | Readonly<{ status: 'available'; billedCostNanoUsd: number }>
  | Readonly<{
      status:
        | 'missing-pricing'
        | 'incomplete-usage'
        | 'missing-cache-metrics'
        | 'invalid-accounting'
        | 'overflow'
        | 'truncated'
    }>

/**
 * Deliberately empty until exact provider/model prices have been reviewed. Missing prices remain
 * explicit evidence gaps rather than inheriting a provider-wide or generic cache discount.
 */
export const TOOL_SURFACE_PROVIDER_PRICING_POLICY_V1: ToolSurfaceProviderPricingPolicyV1 =
  Object.freeze({
    schemaVersion: TOOL_SURFACE_PROVIDER_PRICING_SCHEMA_VERSION,
    pricingVersion: 'tool-surface-provider-pricing-unconfigured-v1',
    currency: 'USD',
    entries: Object.freeze([])
  })

function isBoundedField(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_PRICING_FIELD_CODE_UNITS &&
    value === value.trim() &&
    !value.includes('\0') &&
    Buffer.byteLength(value, 'utf8') <= MAX_PRICING_FIELD_BYTES
  )
}

function isRate(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function pricingKey(providerId: string, modelId: string): string {
  return hashJsonData({ domain: 'tool-surface-provider-pricing-v1', providerId, modelId })
}

function safeTokenCount(value: number | undefined): bigint | null {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? BigInt(value)
    : null
}

/** Immutable exact-match pricing lookup. It never participates in adapter selection or dispatch. */
export class ToolSurfaceProviderPricingCatalogV1 {
  readonly pricingVersion: string
  readonly currency: 'USD'
  private readonly entries: ReadonlyMap<string, ToolSurfaceProviderPricingV1>

  constructor(policy: ToolSurfaceProviderPricingPolicyV1) {
    if (
      policy.schemaVersion !== TOOL_SURFACE_PROVIDER_PRICING_SCHEMA_VERSION ||
      policy.currency !== 'USD' ||
      !isBoundedField(policy.pricingVersion) ||
      !Array.isArray(policy.entries) ||
      policy.entries.length > MAX_PRICING_ENTRIES ||
      Buffer.byteLength(canonicalJsonStringifyData(policy), 'utf8') > MAX_PRICING_POLICY_BYTES
    ) {
      throw new Error('Tool Surface provider pricing policy is invalid.')
    }

    const entries = new Map<string, ToolSurfaceProviderPricingV1>()
    for (const entry of policy.entries) {
      if (
        !isBoundedField(entry.providerId) ||
        !isBoundedField(entry.modelId) ||
        typeof entry.inputIncludesCacheReadTokens !== 'boolean' ||
        typeof entry.inputIncludesCacheWriteTokens !== 'boolean' ||
        !isRate(entry.nanoUsdPerMillionTokens?.uncachedInput) ||
        !isRate(entry.nanoUsdPerMillionTokens?.output) ||
        !isRate(entry.nanoUsdPerMillionTokens?.cacheRead) ||
        !isRate(entry.nanoUsdPerMillionTokens?.cacheWrite)
      ) {
        throw new Error('Tool Surface provider pricing entry is invalid.')
      }
      const key = pricingKey(entry.providerId, entry.modelId)
      if (entries.has(key)) {
        throw new Error('Tool Surface provider pricing contains a duplicate model scope.')
      }
      entries.set(
        key,
        Object.freeze({
          ...entry,
          nanoUsdPerMillionTokens: Object.freeze({ ...entry.nanoUsdPerMillionTokens })
        })
      )
    }

    this.pricingVersion = policy.pricingVersion
    this.currency = policy.currency
    this.entries = entries
  }

  calculate(input: {
    readonly providerId: string
    readonly modelId: string
    readonly attempts: readonly ToolSurfaceProviderAttemptDiagnostic[]
    readonly attemptsTruncated: boolean
  }): ToolSurfaceBilledCostResult {
    if (input.attemptsTruncated) return { status: 'truncated' }
    const pricing = this.entries.get(pricingKey(input.providerId, input.modelId))
    if (!pricing) return { status: 'missing-pricing' }
    if (input.attempts.length === 0) return { status: 'incomplete-usage' }

    let weightedNanoUsd = 0n
    for (const attempt of input.attempts) {
      const inputTokens = safeTokenCount(attempt.usage?.inputTokens)
      const outputTokens = safeTokenCount(attempt.usage?.outputTokens)
      if (inputTokens === null || outputTokens === null) return { status: 'incomplete-usage' }

      const cacheReadTokens = safeTokenCount(attempt.usage?.cacheReadTokens)
      const cacheWriteTokens = safeTokenCount(attempt.usage?.cacheWriteTokens)
      if (cacheReadTokens === null || cacheWriteTokens === null) {
        return { status: 'missing-cache-metrics' }
      }

      const uncachedInputTokens =
        inputTokens -
        (pricing.inputIncludesCacheReadTokens ? cacheReadTokens : 0n) -
        (pricing.inputIncludesCacheWriteTokens ? cacheWriteTokens : 0n)
      if (uncachedInputTokens < 0n) return { status: 'invalid-accounting' }

      weightedNanoUsd +=
        uncachedInputTokens * BigInt(pricing.nanoUsdPerMillionTokens.uncachedInput) +
        outputTokens * BigInt(pricing.nanoUsdPerMillionTokens.output) +
        cacheReadTokens * BigInt(pricing.nanoUsdPerMillionTokens.cacheRead) +
        cacheWriteTokens * BigInt(pricing.nanoUsdPerMillionTokens.cacheWrite)
    }

    const roundedNanoUsd = (weightedNanoUsd + MILLION_TOKENS / 2n) / MILLION_TOKENS
    if (roundedNanoUsd > BigInt(Number.MAX_SAFE_INTEGER)) return { status: 'overflow' }
    return { status: 'available', billedCostNanoUsd: Number(roundedNanoUsd) }
  }
}
