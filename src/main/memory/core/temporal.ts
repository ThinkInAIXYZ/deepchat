import {
  AGENT_MEMORY_TEMPORAL_KINDS,
  AGENT_MEMORY_TEMPORAL_PRECISIONS,
  type AgentMemoryTemporalKind,
  type AgentMemoryTemporalPrecision
} from '@shared/types/agent-memory'

import type {
  AgentMemoryRow,
  MemoryTemporalMetadata,
  MemoryTemporalPolicyMode,
  MemoryTemporalPolicyResult
} from '../domain/types'
import { canonicalizeMemoryTimeZone } from '../domain/clock'

const TEMPORAL_KIND_SET = new Set<unknown>(AGENT_MEMORY_TEMPORAL_KINDS)
const TEMPORAL_PRECISION_SET = new Set<unknown>(AGENT_MEMORY_TEMPORAL_PRECISIONS)
const ISO_TIMESTAMP_WITH_ZONE =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2})(?:\.(?<fraction>\d{1,3}))?)?(?<zone>Z|(?<offsetSign>[+-])(?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/u
const MAX_DATE_EPOCH_MS = 8_640_000_000_000_000
const TEMPORAL_FORMATTER_CACHE_LIMIT = 64
const temporalFormatterCache = new Map<string, Intl.DateTimeFormat>()

export const MEMORY_TEMPORAL_HARD_FILTER_CONFIDENCE = 0.8
export const MEMORY_TEMPORAL_UNCERTAIN_STATE_FACTOR = 0.65
export const MEMORY_TEMPORAL_UNDATED_STATE_FACTOR = 0.9
export const MEMORY_TEMPORAL_PREVIOUS_PLAN_FACTOR = 0.85
export const MEMORY_TEMPORAL_ENDED_RECURRENCE_FACTOR = 0.9

export const ATEMPORAL_MEMORY_METADATA: MemoryTemporalMetadata = Object.freeze({
  temporalKind: 'atemporal',
  validFrom: null,
  validUntil: null,
  temporalConfidence: null,
  temporalPrecision: null,
  temporalTimeZone: null
})

export interface RawMemoryTemporalMetadata {
  temporalKind?: unknown
  kind?: unknown
  validFrom?: unknown
  validUntil?: unknown
  temporalConfidence?: unknown
  confidence?: unknown
  temporalPrecision?: unknown
  precision?: unknown
  temporalTimeZone?: unknown
  timeZone?: unknown
}

function parseEpochMilliseconds(value: unknown): number | null {
  if (typeof value === 'number') {
    const epoch = Math.trunc(value)
    return Number.isFinite(value) && Math.abs(epoch) <= MAX_DATE_EPOCH_MS ? epoch : null
  }
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  const match = ISO_TIMESTAMP_WITH_ZONE.exec(normalized)
  if (!match?.groups) return null
  const year = Number(match.groups.year)
  const month = Number(match.groups.month)
  const day = Number(match.groups.day)
  const hour = Number(match.groups.hour)
  const minute = Number(match.groups.minute)
  const second = Number(match.groups.second ?? 0)
  const offsetHour = Number(match.groups.offsetHour ?? 0)
  const offsetMinute = Number(match.groups.offsetMinute ?? 0)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  if (
    year === 0 ||
    daysInMonth === undefined ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    return null
  }
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeConfidence(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN
  if (!Number.isFinite(parsed)) return 0.5
  return Math.min(1, Math.max(0, parsed))
}

function parseStrictConfidence(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null
}

export function tryNormalizeMemoryTemporalMetadata(
  input: RawMemoryTemporalMetadata | null | undefined
): MemoryTemporalMetadata | null {
  const rawKind = input?.temporalKind ?? input?.kind
  if (!TEMPORAL_KIND_SET.has(rawKind)) return null
  const temporalKind = rawKind as AgentMemoryTemporalKind
  const rawValidFrom = input?.validFrom
  const rawValidUntil = input?.validUntil
  const rawConfidence = input?.temporalConfidence ?? input?.confidence
  const rawPrecision = input?.temporalPrecision ?? input?.precision
  const rawTimeZone = input?.temporalTimeZone ?? input?.timeZone

  if (temporalKind === 'atemporal') {
    return [rawValidFrom, rawValidUntil, rawConfidence, rawPrecision, rawTimeZone].every(
      (value) => value === undefined || value === null
    )
      ? { ...ATEMPORAL_MEMORY_METADATA }
      : null
  }

  const validFrom = parseEpochMilliseconds(rawValidFrom)
  const validUntil = parseEpochMilliseconds(rawValidUntil)
  if (
    (rawValidFrom !== undefined && rawValidFrom !== null && validFrom === null) ||
    (rawValidUntil !== undefined && rawValidUntil !== null && validUntil === null) ||
    (validFrom !== null && validUntil !== null && validFrom >= validUntil)
  ) {
    return null
  }
  const temporalConfidence = parseStrictConfidence(rawConfidence)
  if (temporalConfidence === null || !TEMPORAL_PRECISION_SET.has(rawPrecision)) return null
  const temporalTimeZone = canonicalizeMemoryTimeZone(rawTimeZone)
  if (temporalTimeZone === null) return null

  return {
    temporalKind,
    validFrom,
    validUntil,
    temporalConfidence,
    temporalPrecision: rawPrecision as AgentMemoryTemporalPrecision,
    temporalTimeZone
  }
}

export function normalizeMemoryTemporalMetadata(
  input: RawMemoryTemporalMetadata | null | undefined,
  fallbackTimeZone = 'UTC'
): MemoryTemporalMetadata {
  const rawKind = input?.temporalKind ?? input?.kind
  const temporalKind: AgentMemoryTemporalKind = TEMPORAL_KIND_SET.has(rawKind)
    ? (rawKind as AgentMemoryTemporalKind)
    : 'atemporal'
  if (temporalKind === 'atemporal') return { ...ATEMPORAL_MEMORY_METADATA }

  const rawValidFrom = input?.validFrom
  const rawValidUntil = input?.validUntil
  const validFrom = parseEpochMilliseconds(rawValidFrom)
  const validUntil = parseEpochMilliseconds(rawValidUntil)
  if (
    (rawValidFrom !== undefined && rawValidFrom !== null && validFrom === null) ||
    (rawValidUntil !== undefined && rawValidUntil !== null && validUntil === null)
  ) {
    return { ...ATEMPORAL_MEMORY_METADATA }
  }
  if (validFrom !== null && validUntil !== null && validFrom >= validUntil) {
    return { ...ATEMPORAL_MEMORY_METADATA }
  }

  const rawPrecision = input?.temporalPrecision ?? input?.precision
  const temporalPrecision: AgentMemoryTemporalPrecision = TEMPORAL_PRECISION_SET.has(rawPrecision)
    ? (rawPrecision as AgentMemoryTemporalPrecision)
    : 'unknown'
  const requestedTimeZone = input?.temporalTimeZone ?? input?.timeZone
  const requestedTimeZoneValid = canonicalizeMemoryTimeZone(requestedTimeZone)
  const temporalTimeZone =
    requestedTimeZoneValid ?? canonicalizeMemoryTimeZone(fallbackTimeZone) ?? 'UTC'
  const rawConfidence = input?.temporalConfidence ?? input?.confidence
  const hasInvalidRequestedTimeZone =
    requestedTimeZone !== undefined &&
    requestedTimeZone !== null &&
    requestedTimeZone !== '' &&
    requestedTimeZoneValid === null
  const temporalConfidence = Math.min(
    normalizeConfidence(rawConfidence),
    hasInvalidRequestedTimeZone ? 0.5 : 1
  )

  return {
    temporalKind,
    validFrom,
    validUntil,
    temporalConfidence,
    temporalPrecision,
    temporalTimeZone
  }
}

export function temporalMetadataFromRow(
  row: Partial<
    Pick<
      AgentMemoryRow,
      | 'temporal_kind'
      | 'valid_from'
      | 'valid_until'
      | 'temporal_confidence'
      | 'temporal_precision'
      | 'temporal_timezone'
    >
  >
): MemoryTemporalMetadata {
  return normalizeMemoryTemporalMetadata({
    temporalKind: row.temporal_kind,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    temporalConfidence: row.temporal_confidence,
    temporalPrecision: row.temporal_precision,
    temporalTimeZone: row.temporal_timezone
  })
}

function sameTemporalInterpretation(
  left: MemoryTemporalMetadata,
  right: MemoryTemporalMetadata
): boolean {
  return (
    left.temporalKind === right.temporalKind &&
    left.validFrom === right.validFrom &&
    left.validUntil === right.validUntil &&
    left.temporalPrecision === right.temporalPrecision &&
    left.temporalTimeZone === right.temporalTimeZone
  )
}

export function memoryTemporalMetadataEquals(
  left: MemoryTemporalMetadata,
  right: MemoryTemporalMetadata
): boolean {
  return (
    sameTemporalInterpretation(left, right) && left.temporalConfidence === right.temporalConfidence
  )
}

export function reconcileEquivalentClaimTemporalMetadata(
  existing: MemoryTemporalMetadata,
  incoming: MemoryTemporalMetadata
): MemoryTemporalMetadata {
  if (incoming.temporalKind === 'atemporal') return { ...existing }
  if (existing.temporalKind === 'atemporal') return { ...incoming }
  if (!sameTemporalInterpretation(existing, incoming)) return { ...existing }
  return (incoming.temporalConfidence ?? 0) > (existing.temporalConfidence ?? 0)
    ? { ...incoming }
    : { ...existing }
}

export function resolveMergedClaimTemporalMetadata(
  existing: MemoryTemporalMetadata,
  incoming: MemoryTemporalMetadata,
  contentMatch: { existing: boolean; incoming: boolean }
): MemoryTemporalMetadata {
  if (contentMatch.existing && contentMatch.incoming) {
    return reconcileEquivalentClaimTemporalMetadata(existing, incoming)
  }
  if (contentMatch.existing) return { ...existing }
  if (contentMatch.incoming) return { ...incoming }
  if (existing.temporalKind === 'atemporal') return { ...incoming }
  if (incoming.temporalKind === 'atemporal') return { ...existing }
  if (!sameTemporalInterpretation(existing, incoming)) {
    return { ...ATEMPORAL_MEMORY_METADATA }
  }
  return (incoming.temporalConfidence ?? 0) > (existing.temporalConfidence ?? 0)
    ? { ...incoming }
    : { ...existing }
}

type TemporalIntervalRelation = 'current' | 'future' | 'expired' | 'undated'

function intervalRelation(temporal: MemoryTemporalMetadata, now: number): TemporalIntervalRelation {
  if (!Number.isFinite(now)) return 'undated'
  if (temporal.validFrom !== null && now < temporal.validFrom) return 'future'
  if (temporal.validUntil !== null && now >= temporal.validUntil) return 'expired'
  if (temporal.validFrom === null && temporal.validUntil === null) return 'undated'
  return 'current'
}

function temporalFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = temporalFormatterCache.get(timeZone)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  })
  if (temporalFormatterCache.size >= TEMPORAL_FORMATTER_CACHE_LIMIT) {
    const oldest = temporalFormatterCache.keys().next().value
    if (oldest !== undefined) temporalFormatterCache.delete(oldest)
  }
  temporalFormatterCache.set(timeZone, formatter)
  return formatter
}

function formatTemporalBound(
  epoch: number,
  precision: AgentMemoryTemporalPrecision,
  timeZone: string
): string {
  try {
    const values = new Map(
      temporalFormatter(timeZone)
        .formatToParts(new Date(epoch))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value])
    )
    const year = values.get('year')
    const month = values.get('month')
    const day = values.get('day')
    if (!year || !month || !day) return new Date(epoch).toISOString()
    if (precision === 'year') return year
    if (precision === 'quarter') return `${year}-Q${Math.ceil(Number(month) / 3)}`
    if (precision === 'month') return `${year}-${month}`
    const date = `${year}-${month}-${day}`
    if (precision !== 'exact' && precision !== 'unknown') return date
    const hour = values.get('hour')
    const minute = values.get('minute')
    const second = values.get('second')
    return hour && minute && second ? `${date} ${hour}:${minute}:${second}` : date
  } catch {
    return new Date(epoch).toISOString()
  }
}

function formatTemporalInterval(temporal: MemoryTemporalMetadata): string {
  const precision = temporal.temporalPrecision ?? 'unknown'
  const timeZone = temporal.temporalTimeZone ?? 'UTC'
  const from =
    temporal.validFrom === null
      ? null
      : formatTemporalBound(temporal.validFrom, precision, timeZone)
  const until =
    temporal.validUntil === null
      ? null
      : formatTemporalBound(temporal.validUntil, precision, timeZone)
  const interval =
    from && until
      ? `from ${from} until ${until}`
      : from
        ? `from ${from}`
        : until
          ? `until ${until}`
          : null
  return interval ? `${interval} (${timeZone})` : 'validity window unspecified'
}

function temporalAnnotation(
  label: string,
  temporal: MemoryTemporalMetadata,
  options: { includeConfidence?: boolean } = {}
): string {
  const details = [`Temporal: ${label}`, formatTemporalInterval(temporal)]
  if (temporal.temporalPrecision === 'unknown') details.push('approximate')
  if (options.includeConfidence && temporal.temporalConfidence !== null) {
    details.push(`confidence ${temporal.temporalConfidence.toFixed(2)}`)
  }
  return `[${details.join('; ')}]`
}

export function evaluateNormalizedMemoryTemporalPolicy(
  temporal: MemoryTemporalMetadata,
  now: number,
  mode: MemoryTemporalPolicyMode = 'current'
): MemoryTemporalPolicyResult {
  if (temporal.temporalKind === 'atemporal') {
    return { eligible: true, scoreFactor: 1, status: 'atemporal', annotation: null }
  }

  const relation = intervalRelation(temporal, now)
  const confidence = temporal.temporalConfidence ?? 0.5
  const trustworthy = confidence >= MEMORY_TEMPORAL_HARD_FILTER_CONFIDENCE
  const evidenceMode = mode === 'evidence'

  switch (temporal.temporalKind) {
    case 'state': {
      if (relation === 'expired' || relation === 'future') {
        const eligible = evidenceMode || !trustworthy
        const status = relation
        const label =
          relation === 'expired'
            ? trustworthy
              ? 'expired state'
              : 'possibly outdated state'
            : trustworthy
              ? 'future state'
              : 'possibly not yet effective state'
        return {
          eligible,
          scoreFactor: evidenceMode ? 1 : eligible ? MEMORY_TEMPORAL_UNCERTAIN_STATE_FACTOR : 0,
          status,
          annotation: temporalAnnotation(label, temporal, {
            includeConfidence: !trustworthy
          })
        }
      }
      if (relation === 'undated') {
        return {
          eligible: true,
          scoreFactor: evidenceMode ? 1 : MEMORY_TEMPORAL_UNDATED_STATE_FACTOR,
          status: 'undated',
          annotation: temporalAnnotation('state with unspecified validity', temporal, {
            includeConfidence: true
          })
        }
      }
      return {
        eligible: true,
        scoreFactor: 1,
        status: 'current',
        annotation: temporalAnnotation('current state', temporal)
      }
    }
    case 'event': {
      const future = relation === 'future'
      return {
        eligible: true,
        scoreFactor: 1,
        status: future ? 'future_event' : 'historical',
        annotation: temporalAnnotation(future ? 'future-dated event' : 'historical event', temporal)
      }
    }
    case 'plan': {
      const previous = relation === 'expired'
      return {
        eligible: true,
        scoreFactor: evidenceMode || !previous ? 1 : MEMORY_TEMPORAL_PREVIOUS_PLAN_FACTOR,
        status: previous ? 'previously_planned' : 'planned',
        annotation: temporalAnnotation(previous ? 'previously planned' : 'plan', temporal)
      }
    }
    case 'recurring': {
      const ended = relation === 'expired'
      const future = relation === 'future'
      return {
        eligible: true,
        scoreFactor: evidenceMode || !ended ? 1 : MEMORY_TEMPORAL_ENDED_RECURRENCE_FACTOR,
        status: ended ? 'ended_recurrence' : future ? 'future_recurrence' : 'recurring',
        annotation: temporalAnnotation(
          ended
            ? 'recurring; known window ended'
            : future
              ? 'recurring; known window starts in the future'
              : 'recurring',
          temporal
        )
      }
    }
  }
}

export function evaluateMemoryTemporalPolicy(
  input: MemoryTemporalMetadata,
  now: number,
  mode: MemoryTemporalPolicyMode = 'current'
): MemoryTemporalPolicyResult {
  return evaluateNormalizedMemoryTemporalPolicy(normalizeMemoryTemporalMetadata(input), now, mode)
}
