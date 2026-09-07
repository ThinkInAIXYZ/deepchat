import {
  MEMORY_TEMPORAL_HARD_FILTER_CONFIDENCE,
  evaluateNormalizedMemoryTemporalPolicy,
  temporalMetadataFromRow
} from './temporal'
import { estimateTokens, estimateTokenWeight } from './injectionPort'
import type {
  CanonicalAgentMemoryRow,
  MemoryTemporalMetadata,
  MemoryTemporalPolicyResult,
  MemoryTemporalStatus
} from '../domain/types'

export const WORKING_PROJECTION_POLICY_VERSION = 1

export const WORKING_PROJECTION_SECTION_LABELS = {
  currentState: '[Current high-confidence states]',
  qualifiedState: '[Qualified states]',
  stableFact: '[Stable preferences and facts]',
  recentEvent: '[Recent events]',
  plan: '[Plans and recurring items]',
  reflection: '[High-level reflections]'
} as const

type WorkingProjectionSection = keyof typeof WORKING_PROJECTION_SECTION_LABELS

const SECTION_ORDER: readonly WorkingProjectionSection[] = [
  'currentState',
  'qualifiedState',
  'stableFact',
  'recentEvent',
  'plan',
  'reflection'
]

const QUALIFIED_STATE_STATUS_PRIORITY: Partial<Record<MemoryTemporalStatus, number>> = {
  current: 0,
  undated: 1,
  expired: 2,
  future: 3
}

const PLAN_STATUS_PRIORITY: Partial<Record<MemoryTemporalStatus, number>> = {
  planned: 0,
  future_event: 1,
  recurring: 2,
  future_recurrence: 3,
  previously_planned: 4,
  ended_recurrence: 5
}

const LINE_BREAK_WEIGHT = estimateTokenWeight('\n')
const SECTION_BREAK_WEIGHT = estimateTokenWeight('\n\n')
const SECTION_LABEL_WEIGHTS: Readonly<Record<WorkingProjectionSection, number>> = {
  currentState: estimateTokenWeight(WORKING_PROJECTION_SECTION_LABELS.currentState),
  qualifiedState: estimateTokenWeight(WORKING_PROJECTION_SECTION_LABELS.qualifiedState),
  stableFact: estimateTokenWeight(WORKING_PROJECTION_SECTION_LABELS.stableFact),
  recentEvent: estimateTokenWeight(WORKING_PROJECTION_SECTION_LABELS.recentEvent),
  plan: estimateTokenWeight(WORKING_PROJECTION_SECTION_LABELS.plan),
  reflection: estimateTokenWeight(WORKING_PROJECTION_SECTION_LABELS.reflection)
}

interface ProjectionCandidate {
  row: CanonicalAgentMemoryRow
  section: WorkingProjectionSection
  line: string
  temporal: MemoryTemporalMetadata
  temporalStatus: MemoryTemporalStatus
}

export interface StructuredWorkingProjection {
  policyVersion: typeof WORKING_PROJECTION_POLICY_VERSION
  content: string
  selectedIds: string[]
  droppedIds: string[]
  nextRefreshAt: number | null
  estimatedTokens: number
}

function finiteNumber(value: number | null | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareNumberAscending(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareNumberDescending(left: number, right: number): number {
  return compareNumberAscending(right, left)
}

function compareCommonPriority(left: ProjectionCandidate, right: ProjectionCandidate): number {
  const importance = compareNumberDescending(
    finiteNumber(left.row.importance),
    finiteNumber(right.row.importance)
  )
  if (importance !== 0) return importance

  const accessCount = compareNumberDescending(
    finiteNumber(left.row.access_count),
    finiteNumber(right.row.access_count)
  )
  if (accessCount !== 0) return accessCount

  const createdAt = compareNumberDescending(
    finiteNumber(left.row.created_at),
    finiteNumber(right.row.created_at)
  )
  if (createdAt !== 0) return createdAt

  return compareText(left.row.id, right.row.id)
}

function temporalReference(candidate: ProjectionCandidate): number {
  return finiteNumber(
    candidate.temporal.validFrom ?? candidate.temporal.validUntil ?? candidate.row.created_at
  )
}

function historicalTemporalReference(candidate: ProjectionCandidate): number {
  return finiteNumber(
    candidate.temporal.validUntil ?? candidate.temporal.validFrom ?? candidate.row.created_at
  )
}

function compareCandidates(left: ProjectionCandidate, right: ProjectionCandidate): number {
  if (left.section === 'recentEvent' && right.section === 'recentEvent') {
    const eventTime = compareNumberDescending(temporalReference(left), temporalReference(right))
    if (eventTime !== 0) return eventTime
  }

  if (left.section === 'qualifiedState' && right.section === 'qualifiedState') {
    const status =
      (QUALIFIED_STATE_STATUS_PRIORITY[left.temporalStatus] ?? Number.MAX_SAFE_INTEGER) -
      (QUALIFIED_STATE_STATUS_PRIORITY[right.temporalStatus] ?? Number.MAX_SAFE_INTEGER)
    if (status !== 0) return status
  }

  if (left.section === 'plan' && right.section === 'plan') {
    const leftStatus = PLAN_STATUS_PRIORITY[left.temporalStatus] ?? Number.MAX_SAFE_INTEGER
    const rightStatus = PLAN_STATUS_PRIORITY[right.temporalStatus] ?? Number.MAX_SAFE_INTEGER
    if (leftStatus !== rightStatus) return leftStatus - rightStatus

    const historical =
      left.temporalStatus === 'previously_planned' || left.temporalStatus === 'ended_recurrence'
    const leftTime = historical ? historicalTemporalReference(left) : temporalReference(left)
    const rightTime = historical ? historicalTemporalReference(right) : temporalReference(right)
    const timeOrder = historical
      ? compareNumberDescending(leftTime, rightTime)
      : compareNumberAscending(leftTime, rightTime)
    if (timeOrder !== 0) return timeOrder
  }

  return compareCommonPriority(left, right)
}

function classifyCandidate(
  row: CanonicalAgentMemoryRow,
  temporal: MemoryTemporalMetadata,
  policy: MemoryTemporalPolicyResult
): WorkingProjectionSection | null {
  if (!policy.eligible) return null
  if (row.kind === 'reflection') return 'reflection'

  switch (temporal.temporalKind) {
    case 'state':
      return policy.status === 'current' &&
        (temporal.temporalConfidence ?? 0) >= MEMORY_TEMPORAL_HARD_FILTER_CONFIDENCE
        ? 'currentState'
        : 'qualifiedState'
    case 'event':
      return policy.status === 'historical' ? 'recentEvent' : 'plan'
    case 'plan':
    case 'recurring':
      return 'plan'
    case 'atemporal':
      return 'stableFact'
  }
}

function indentContinuationLines(content: string): string {
  return content
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join('\n')
}

function toCandidate(
  row: CanonicalAgentMemoryRow,
  temporal: MemoryTemporalMetadata,
  now: number
): ProjectionCandidate | null {
  const content = row.content.trim()
  if (!content) return null
  const policy = evaluateNormalizedMemoryTemporalPolicy(temporal, now, 'current')
  const section = classifyCandidate(row, temporal, policy)
  if (!section) return null
  return {
    row,
    section,
    line: `- ${
      policy.annotation
        ? `${indentContinuationLines(content)} ${policy.annotation}`
        : indentContinuationLines(content)
    }`,
    temporal,
    temporalStatus: policy.status
  }
}

function renderSections(
  selected: Readonly<Record<WorkingProjectionSection, readonly ProjectionCandidate[]>>
): string {
  return SECTION_ORDER.flatMap((section) => {
    const candidates = selected[section]
    if (candidates.length === 0) return []
    return [
      `${WORKING_PROJECTION_SECTION_LABELS[section]}\n${candidates
        .map((candidate) => candidate.line)
        .join('\n')}`
    ]
  }).join('\n\n')
}

function resolveNextRefreshAt(
  temporalRows: readonly MemoryTemporalMetadata[],
  now: number
): number | null {
  let nextRefreshAt: number | null = null
  for (const temporal of temporalRows) {
    for (const boundary of [temporal.validFrom, temporal.validUntil]) {
      if (boundary === null || boundary <= now) continue
      nextRefreshAt = nextRefreshAt === null ? boundary : Math.min(nextRefreshAt, boundary)
    }
  }
  return nextRefreshAt
}

export function buildStructuredWorkingProjection(
  rows: readonly CanonicalAgentMemoryRow[],
  now: number,
  tokenBudget: number
): StructuredWorkingProjection {
  const normalizedNow = Number.isFinite(now) ? Math.floor(now) : 0
  const budget =
    typeof tokenBudget === 'number' && Number.isFinite(tokenBudget)
      ? Math.max(0, Math.floor(tokenBudget))
      : 0
  const candidates: Record<WorkingProjectionSection, ProjectionCandidate[]> = {
    currentState: [],
    qualifiedState: [],
    stableFact: [],
    recentEvent: [],
    plan: [],
    reflection: []
  }
  const droppedIds: string[] = []
  const temporalRows: MemoryTemporalMetadata[] = []

  for (const row of rows) {
    const temporal = temporalMetadataFromRow(row)
    temporalRows.push(temporal)
    const candidate = toCandidate(row, temporal, normalizedNow)
    if (!candidate) {
      droppedIds.push(row.id)
      continue
    }
    candidates[candidate.section].push(candidate)
  }
  for (const section of SECTION_ORDER) candidates[section].sort(compareCandidates)

  const selected: Record<WorkingProjectionSection, ProjectionCandidate[]> = {
    currentState: [],
    qualifiedState: [],
    stableFact: [],
    recentEvent: [],
    plan: [],
    reflection: []
  }
  const maxSectionLength = Math.max(
    0,
    ...SECTION_ORDER.map((section) => candidates[section].length)
  )
  let selectedWeight = 0
  let activeSectionCount = 0
  for (let index = 0; index < maxSectionLength; index += 1) {
    for (const section of SECTION_ORDER) {
      const candidate = candidates[section][index]
      if (!candidate) continue
      const sectionIsEmpty = selected[section].length === 0
      const candidateWeight =
        estimateTokenWeight(candidate.line) +
        (sectionIsEmpty
          ? SECTION_LABEL_WEIGHTS[section] +
            LINE_BREAK_WEIGHT +
            (activeSectionCount > 0 ? SECTION_BREAK_WEIGHT : 0)
          : LINE_BREAK_WEIGHT)
      if (Math.ceil(selectedWeight + candidateWeight) <= budget) {
        selected[section].push(candidate)
        selectedWeight += candidateWeight
        if (sectionIsEmpty) activeSectionCount += 1
      } else {
        droppedIds.push(candidate.row.id)
      }
    }
  }

  const content = renderSections(selected)
  return {
    policyVersion: WORKING_PROJECTION_POLICY_VERSION,
    content,
    selectedIds: SECTION_ORDER.flatMap((section) =>
      selected[section].map((candidate) => candidate.row.id)
    ),
    droppedIds: [...new Set(droppedIds)].sort(compareText),
    nextRefreshAt: resolveNextRefreshAt(temporalRows, normalizedNow),
    estimatedTokens: estimateTokens(content)
  }
}
