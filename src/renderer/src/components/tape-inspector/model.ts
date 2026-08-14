import type {
  TapeInspectorEvidenceRecord,
  TapeInspectorFactRecord,
  TapeInspectorRecordDetail
} from '@shared/types/tape-inspector'
import type { MessageTraceRecord } from '@shared/types/agent-interface'

export type TapeInspectorGroupKind = 'run' | 'request' | 'attempt' | 'tool'

export interface TapeInspectorGroupDescriptor {
  key: string
  kind: TapeInspectorGroupKind
  runId?: string
  messageId?: string
  requestSeq?: number
  physicalAttempt?: number
  providerToolCallId?: string
  childOrdinal?: number
}

interface TapeInspectorRowBase {
  key: string
  depth: number
  status: string | null
  durationMs: number | null
  sequenceEntryId: number | null
  sequenceStart: number
  actualStartAt: number | null
  actualEndAt: number | null
  actualStart: number
  actualWidth: number
}

export interface TapeInspectorGroupRow extends TapeInspectorRowBase {
  recordType: 'group'
  group: TapeInspectorGroupDescriptor
  collapsed: boolean
}

export interface TapeInspectorFactRow extends TapeInspectorRowBase {
  recordType: 'fact'
  record: TapeInspectorFactRecord
}

export interface TapeInspectorEvidenceRow extends TapeInspectorRowBase {
  recordType: 'evidence'
  record: TapeInspectorEvidenceRecord
  parentGroupKey: string | null
  legacyUnattributed: boolean
}

export interface TapeInspectorEvidenceLaneRow extends TapeInspectorRowBase {
  recordType: 'evidence_lane'
  count: number
  collapsed: boolean
}

export type TapeInspectorDisplayRow =
  | TapeInspectorGroupRow
  | TapeInspectorFactRow
  | TapeInspectorEvidenceRow
  | TapeInspectorEvidenceLaneRow

export type TapeInspectorDetailState =
  | {
      source: 'tape'
      detail: TapeInspectorRecordDetail
    }
  | {
      source: 'request'
      trace: MessageTraceRecord
    }
  | {
      source: 'derived'
      group: TapeInspectorGroupDescriptor
    }
  | {
      source: 'unbound_lane'
      count: number
    }

export interface TapeInspectorDetailCapabilities {
  source: 'tape' | 'message_trace' | 'derived'
  summary: boolean
  payload: boolean
  timing: boolean
  provenance: boolean
  integrity: boolean
  raw: boolean
  transcriptNavigation: boolean
}

const UNBOUND_EVIDENCE_LANE_KEY = 'lane:unbound-evidence'

function groupKey(kind: TapeInspectorGroupKind, identity: unknown[]): string {
  return `group:${kind}:${JSON.stringify(identity)}`
}

export function getFactGroupDescriptors(
  record: TapeInspectorFactRecord
): TapeInspectorGroupDescriptor[] {
  const groups: TapeInspectorGroupDescriptor[] = []
  if (record.runId) {
    groups.push({
      key: groupKey('run', [record.runId]),
      kind: 'run',
      runId: record.runId
    })
  }
  if (record.messageId && record.requestSeq !== undefined) {
    groups.push({
      key: groupKey('request', [record.messageId, record.requestSeq]),
      kind: 'request',
      messageId: record.messageId,
      requestSeq: record.requestSeq
    })
    if (record.physicalAttempt !== undefined) {
      groups.push({
        key: groupKey('attempt', [record.messageId, record.requestSeq, record.physicalAttempt]),
        kind: 'attempt',
        messageId: record.messageId,
        requestSeq: record.requestSeq,
        physicalAttempt: record.physicalAttempt
      })
    }
  }
  if (record.runId && record.requestSeq !== undefined && record.providerToolCallId !== undefined) {
    groups.push({
      key: groupKey('tool', [
        record.runId,
        record.requestSeq,
        record.providerToolCallId,
        record.childOrdinal ?? null
      ]),
      kind: 'tool',
      runId: record.runId,
      requestSeq: record.requestSeq,
      providerToolCallId: record.providerToolCallId,
      ...(record.childOrdinal === undefined ? {} : { childOrdinal: record.childOrdinal })
    })
  }
  return groups
}

export function getEvidenceParentGroupKey(
  evidence: TapeInspectorEvidenceRecord,
  availableGroupKeys: ReadonlySet<string>
): string | null {
  const key =
    evidence.physicalAttempt === undefined
      ? groupKey('request', [evidence.messageId, evidence.requestSeq])
      : groupKey('attempt', [evidence.messageId, evidence.requestSeq, evidence.physicalAttempt])
  return availableGroupKeys.has(key) ? key : null
}

function factStatus(record: TapeInspectorFactRecord): string | null {
  if (record.facts?.isError === true) return 'error'
  return record.facts?.status ?? record.facts?.outcome ?? null
}

function stableDerivedStatus(statuses: Array<string | null>): string | null {
  const values = [...new Set(statuses.filter((status): status is string => status !== null))]
  if (values.includes('error')) return 'error'
  return values.length === 1 ? values[0] : null
}

function groupStatus(
  group: TapeInspectorGroupDescriptor,
  matching: readonly TapeInspectorFactRecord[]
): string | null {
  if (group.kind === 'run') {
    const terminal = matching.filter((record) => record.name === 'execution/run_terminal')
    return terminal.length === 1 ? factStatus(terminal[0]) : null
  }
  if (group.kind === 'tool') {
    const outcomes = matching.filter((record) => record.name === 'execution/tool_outcome')
    return outcomes.length === 1
      ? outcomes[0].facts?.isError === true
        ? 'error'
        : outcomes[0].facts?.isError === false
          ? 'success'
          : null
      : null
  }
  return stableDerivedStatus(matching.map(factStatus))
}

interface TimingPair {
  startEntryId: number
  startAt: number
  endAt: number
  durationMs: number
}

function groupTiming(
  group: TapeInspectorGroupDescriptor,
  matching: readonly TapeInspectorFactRecord[]
): TimingPair | null {
  if (group.kind !== 'run' && group.kind !== 'tool') return null
  const startName = group.kind === 'run' ? 'execution/run_started' : 'execution/dispatch_committed'
  const endName = group.kind === 'run' ? 'execution/run_terminal' : 'execution/tool_outcome'
  const starts = matching.filter((record) => record.name === startName)
  const ends = matching.filter((record) => record.name === endName)
  if (starts.length !== 1 || ends.length !== 1 || ends[0].createdAt < starts[0].createdAt) {
    return null
  }
  return {
    startEntryId: starts[0].entryId,
    startAt: starts[0].createdAt,
    endAt: ends[0].createdAt,
    durationMs: ends[0].createdAt - starts[0].createdAt
  }
}

function matchesLoadedSearch(record: TapeInspectorFactRecord, search: string): boolean {
  if (!search) return true
  const haystack = [
    record.name,
    record.kind,
    record.family,
    record.sourceType,
    record.sourceId,
    record.runId,
    record.messageId,
    record.providerToolCallId,
    factStatus(record),
    record.facts?.toolName,
    record.facts?.providerId,
    record.facts?.modelId,
    record.facts?.targetServer,
    record.facts?.errorCode
  ]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
    .toLocaleLowerCase()
  return haystack.includes(search)
}

function matchesEvidenceSearch(record: TapeInspectorEvidenceRecord, search: string): boolean {
  if (!search) return true
  return [
    record.traceId,
    record.messageId,
    record.providerId,
    record.modelId,
    String(record.requestSeq),
    record.physicalAttempt === undefined ? 'legacy unattributed' : String(record.physicalAttempt)
  ]
    .join('\n')
    .toLocaleLowerCase()
    .includes(search)
}

function normalizePosition(value: number, min: number, max: number): number {
  if (max <= min) return 0.5
  return Math.min(1, Math.max(0, (value - min) / (max - min)))
}

function evidenceComparator(
  left: TapeInspectorEvidenceRecord,
  right: TapeInspectorEvidenceRecord
): number {
  return (
    (left.physicalAttempt ?? -1) - (right.physicalAttempt ?? -1) ||
    left.createdAt - right.createdAt ||
    left.traceId.localeCompare(right.traceId)
  )
}

export function buildTapeInspectorRows(input: {
  tapeIncarnationId: string | null
  records: readonly TapeInspectorFactRecord[]
  evidence: readonly TapeInspectorEvidenceRecord[]
  collapsedKeys: ReadonlySet<string>
  search?: string
  flat?: boolean
}): TapeInspectorDisplayRow[] {
  const records = input.flat
    ? [...input.records]
    : [...input.records].sort((left, right) => left.entryId - right.entryId)
  const normalizedSearch = input.search?.trim().toLocaleLowerCase() ?? ''
  const descriptors = new Map<string, TapeInspectorGroupDescriptor>()
  const groupsByEntryId = new Map<number, TapeInspectorGroupDescriptor[]>()
  const recordsByGroup = new Map<string, TapeInspectorFactRecord[]>()
  for (const record of records) {
    const groups = getFactGroupDescriptors(record)
    groupsByEntryId.set(record.entryId, groups)
    for (const descriptor of groups) {
      descriptors.set(descriptor.key, descriptor)
      const matching = recordsByGroup.get(descriptor.key) ?? []
      matching.push(record)
      recordsByGroup.set(descriptor.key, matching)
    }
  }
  const groupKeys = new Set(descriptors.keys())
  const evidenceByParent = new Map<string, TapeInspectorEvidenceRecord[]>()
  const searchMatchingEvidenceParents = new Set<string>()
  const unboundEvidence: TapeInspectorEvidenceRecord[] = []
  for (const evidence of input.evidence) {
    const parentKey = getEvidenceParentGroupKey(evidence, groupKeys)
    if (!parentKey) {
      if (matchesEvidenceSearch(evidence, normalizedSearch)) unboundEvidence.push(evidence)
      continue
    }
    const values = evidenceByParent.get(parentKey) ?? []
    values.push(evidence)
    evidenceByParent.set(parentKey, values)
    if (matchesEvidenceSearch(evidence, normalizedSearch)) {
      searchMatchingEvidenceParents.add(parentKey)
    }
  }
  for (const values of evidenceByParent.values()) values.sort(evidenceComparator)
  unboundEvidence.sort(evidenceComparator)

  const visibleFacts = records.filter(
    (record) =>
      matchesLoadedSearch(record, normalizedSearch) ||
      (normalizedSearch.length > 0 &&
        (groupsByEntryId.get(record.entryId) ?? []).some((group) =>
          searchMatchingEvidenceParents.has(group.key)
        ))
  )
  const lastVisibleEntryByGroup = new Map<string, number>()
  for (const record of visibleFacts) {
    for (const descriptor of groupsByEntryId.get(record.entryId) ?? []) {
      lastVisibleEntryByGroup.set(descriptor.key, record.entryId)
    }
  }
  let minEntryId = Number.POSITIVE_INFINITY
  let maxEntryId = Number.NEGATIVE_INFINITY
  let minCreatedAt = Number.POSITIVE_INFINITY
  let maxCreatedAt = Number.NEGATIVE_INFINITY
  for (const record of records) {
    minEntryId = Math.min(minEntryId, record.entryId)
    maxEntryId = Math.max(maxEntryId, record.entryId)
    minCreatedAt = Math.min(minCreatedAt, record.createdAt)
    maxCreatedAt = Math.max(maxCreatedAt, record.createdAt)
  }
  for (const record of input.evidence) {
    minCreatedAt = Math.min(minCreatedAt, record.createdAt)
    maxCreatedAt = Math.max(maxCreatedAt, record.createdAt)
  }
  if (!Number.isFinite(minCreatedAt)) {
    minCreatedAt = 0
    maxCreatedAt = 0
  }
  if (!Number.isFinite(minEntryId)) {
    minEntryId = 0
    maxEntryId = 0
  }
  const timings = new Map<string, TimingPair | null>()
  for (const descriptor of descriptors.values()) {
    timings.set(descriptor.key, groupTiming(descriptor, recordsByGroup.get(descriptor.key) ?? []))
  }

  if (input.flat) {
    const flatRows: TapeInspectorDisplayRow[] = visibleFacts.map((record) => {
      const timing = (groupsByEntryId.get(record.entryId) ?? [])
        .map((group) => timings.get(group.key) ?? null)
        .find((candidate) => candidate?.startEntryId === record.entryId)
      return {
        recordType: 'fact',
        key: `fact:${input.tapeIncarnationId ?? 'unknown'}:${record.key}`,
        record,
        depth: 0,
        status: factStatus(record),
        durationMs: timing?.durationMs ?? null,
        sequenceEntryId: record.entryId,
        sequenceStart: normalizePosition(record.entryId, minEntryId, maxEntryId),
        actualStartAt: record.createdAt,
        actualEndAt: timing?.endAt ?? null,
        actualStart: normalizePosition(record.createdAt, minCreatedAt, maxCreatedAt),
        actualWidth: timing
          ? normalizePosition(timing.endAt, minCreatedAt, maxCreatedAt) -
            normalizePosition(timing.startAt, minCreatedAt, maxCreatedAt)
          : 0
      }
    })
    const visibleEvidence = input.evidence
      .filter((record) => matchesEvidenceSearch(record, normalizedSearch))
      .sort(evidenceComparator)
    if (visibleEvidence.length === 0) return flatRows
    const collapsed = input.collapsedKeys.has(UNBOUND_EVIDENCE_LANE_KEY)
    flatRows.push({
      recordType: 'evidence_lane',
      key: UNBOUND_EVIDENCE_LANE_KEY,
      count: visibleEvidence.length,
      collapsed,
      depth: 0,
      status: null,
      durationMs: null,
      sequenceEntryId: null,
      sequenceStart: 1,
      actualStartAt: null,
      actualEndAt: null,
      actualStart: 1,
      actualWidth: 0
    })
    if (!collapsed) {
      for (const evidence of visibleEvidence) {
        flatRows.push({
          recordType: 'evidence',
          key: evidence.key,
          record: evidence,
          parentGroupKey: null,
          legacyUnattributed: evidence.physicalAttempt === undefined,
          depth: 1,
          status: null,
          durationMs: null,
          sequenceEntryId: null,
          sequenceStart: 1,
          actualStartAt: evidence.createdAt,
          actualEndAt: null,
          actualStart: normalizePosition(evidence.createdAt, minCreatedAt, maxCreatedAt),
          actualWidth: 0
        })
      }
    }
    return flatRows
  }

  const result: TapeInspectorDisplayRow[] = []
  const emittedGroups = new Set<string>()
  for (const record of visibleFacts) {
    const groups = groupsByEntryId.get(record.entryId) ?? []
    let hidden = false
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index]
      const hiddenByParent = groups
        .slice(0, index)
        .some((parent) => input.collapsedKeys.has(parent.key))
      if (!emittedGroups.has(group.key) && !hiddenByParent) {
        const timing = timings.get(group.key) ?? null
        result.push({
          recordType: 'group',
          key: group.key,
          group,
          depth: index,
          collapsed: input.collapsedKeys.has(group.key),
          status: groupStatus(group, recordsByGroup.get(group.key) ?? []),
          durationMs: timing?.durationMs ?? null,
          sequenceEntryId: record.entryId,
          sequenceStart: normalizePosition(record.entryId, minEntryId, maxEntryId),
          actualStartAt: timing?.startAt ?? null,
          actualEndAt: timing?.endAt ?? null,
          actualStart: timing ? normalizePosition(timing.startAt, minCreatedAt, maxCreatedAt) : 0.5,
          actualWidth: timing
            ? normalizePosition(timing.endAt, minCreatedAt, maxCreatedAt) -
              normalizePosition(timing.startAt, minCreatedAt, maxCreatedAt)
            : 0
        })
        emittedGroups.add(group.key)
      }
      if (input.collapsedKeys.has(group.key)) hidden = true
    }
    if (!hidden) {
      const timing = groups
        .map((group) => timings.get(group.key) ?? null)
        .find((candidate) => candidate?.startEntryId === record.entryId)
      result.push({
        recordType: 'fact',
        key: `fact:${input.tapeIncarnationId ?? 'unknown'}:${record.key}`,
        record,
        depth: groups.length,
        status: factStatus(record),
        durationMs: timing?.durationMs ?? null,
        sequenceEntryId: record.entryId,
        sequenceStart: normalizePosition(record.entryId, minEntryId, maxEntryId),
        actualStartAt: record.createdAt,
        actualEndAt: timing?.endAt ?? null,
        actualStart: normalizePosition(record.createdAt, minCreatedAt, maxCreatedAt),
        actualWidth: timing
          ? normalizePosition(timing.endAt, minCreatedAt, maxCreatedAt) -
            normalizePosition(timing.startAt, minCreatedAt, maxCreatedAt)
          : 0
      })
    }

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex]
      if (lastVisibleEntryByGroup.get(group.key) !== record.entryId) continue
      if (
        groups.slice(0, groupIndex + 1).some((candidate) => input.collapsedKeys.has(candidate.key))
      ) {
        continue
      }
      for (const evidence of evidenceByParent.get(group.key) ?? []) {
        if (!matchesEvidenceSearch(evidence, normalizedSearch)) continue
        result.push({
          recordType: 'evidence',
          key: evidence.key,
          record: evidence,
          parentGroupKey: group.key,
          legacyUnattributed: evidence.physicalAttempt === undefined,
          depth: groupIndex + 1,
          status: null,
          durationMs: null,
          sequenceEntryId: null,
          sequenceStart: normalizePosition(record.entryId, minEntryId, maxEntryId),
          actualStartAt: evidence.createdAt,
          actualEndAt: null,
          actualStart: normalizePosition(evidence.createdAt, minCreatedAt, maxCreatedAt),
          actualWidth: 0
        })
      }
    }
  }

  if (unboundEvidence.length > 0) {
    const collapsed = input.collapsedKeys.has(UNBOUND_EVIDENCE_LANE_KEY)
    result.push({
      recordType: 'evidence_lane',
      key: UNBOUND_EVIDENCE_LANE_KEY,
      count: unboundEvidence.length,
      collapsed,
      depth: 0,
      status: null,
      durationMs: null,
      sequenceEntryId: null,
      sequenceStart: 1,
      actualStartAt: null,
      actualEndAt: null,
      actualStart: 1,
      actualWidth: 0
    })
    if (!collapsed) {
      for (const evidence of unboundEvidence) {
        result.push({
          recordType: 'evidence',
          key: evidence.key,
          record: evidence,
          parentGroupKey: null,
          legacyUnattributed: evidence.physicalAttempt === undefined,
          depth: 1,
          status: null,
          durationMs: null,
          sequenceEntryId: null,
          sequenceStart: 1,
          actualStartAt: evidence.createdAt,
          actualEndAt: null,
          actualStart: normalizePosition(evidence.createdAt, minCreatedAt, maxCreatedAt),
          actualWidth: 0
        })
      }
    }
  }
  return result
}

export function getTapeInspectorDetailCapabilities(
  row: TapeInspectorDisplayRow
): TapeInspectorDetailCapabilities {
  if (row.recordType === 'evidence') {
    return {
      source: 'message_trace',
      summary: true,
      payload: true,
      timing: true,
      provenance: false,
      integrity: false,
      raw: true,
      transcriptNavigation: false
    }
  }
  if (row.recordType === 'fact') {
    return {
      source: 'tape',
      summary: true,
      payload: false,
      timing: true,
      provenance: true,
      integrity: row.record.integrity !== undefined,
      raw: false,
      transcriptNavigation: row.record.family === 'message'
    }
  }
  return {
    source: 'derived',
    summary: true,
    payload: false,
    timing: true,
    provenance: false,
    integrity: false,
    raw: false,
    transcriptNavigation: false
  }
}

export function findTapeInspectorPreselection(input: {
  rows: readonly TapeInspectorDisplayRow[]
  messageId?: string
  requestSeq?: number
}): string | null {
  if (!input.messageId) return null
  const requestGroups = input.rows.filter(
    (row): row is TapeInspectorGroupRow =>
      row.recordType === 'group' &&
      row.group.kind === 'request' &&
      row.group.messageId === input.messageId &&
      (input.requestSeq === undefined || row.group.requestSeq === input.requestSeq)
  )
  requestGroups.sort((left, right) => (right.group.requestSeq ?? 0) - (left.group.requestSeq ?? 0))
  if (requestGroups[0]) return requestGroups[0].key

  const matchingRows = input.rows.filter((row) => {
    if (row.recordType === 'fact') {
      return (
        row.record.messageId === input.messageId &&
        (input.requestSeq === undefined || row.record.requestSeq === input.requestSeq)
      )
    }
    if (row.recordType === 'evidence') {
      return (
        row.record.messageId === input.messageId &&
        (input.requestSeq === undefined || row.record.requestSeq === input.requestSeq)
      )
    }
    return false
  })
  return matchingRows.at(-1)?.key ?? null
}

export { UNBOUND_EVIDENCE_LANE_KEY }
