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

export interface TapeInspectorGroupSummary {
  factCount: number
  toolName?: string
  targetServer?: string
  providerId?: string
  modelId?: string
  outcome?: string
  stopReason?: string
  retryDecision?: string
  errorCode?: string
}

export type TapeInspectorStatusState = 'explicit' | 'not_applicable' | 'unresolved'
export type TapeInspectorTimingState = 'span' | 'point' | 'not_applicable' | 'unresolved'
export type TapeInspectorIncompleteReason =
  | 'earlier_history'
  | 'filtered'
  | 'awaiting_live'
  | 'not_recorded'
  | 'inconsistent'
export type TapeInspectorEvidenceAssociation =
  | 'attempt'
  | 'request'
  | 'diagnostic'
  | 'earlier'
  | 'filtered'
  | 'newer'
  | 'not_recorded'
  | 'unresolved'
export type TapeInspectorEvidenceLaneKind = 'earlier' | 'request' | 'diagnostic'

interface TapeInspectorRowBase {
  key: string
  depth: number
  status: string | null
  statusState: TapeInspectorStatusState
  durationMs: number | null
  timingState: TapeInspectorTimingState
  sequenceEntryId: number | null
  sequenceStart: number
  actualStartAt: number | null
  actualEndAt: number | null
  actualStart: number
  actualWidth: number
  incompleteReason?: TapeInspectorIncompleteReason
}

export interface TapeInspectorGroupRow extends TapeInspectorRowBase {
  recordType: 'group'
  group: TapeInspectorGroupDescriptor
  summary: TapeInspectorGroupSummary
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
  association: TapeInspectorEvidenceAssociation
}

export interface TapeInspectorEvidenceLaneRow extends TapeInspectorRowBase {
  recordType: 'evidence_lane'
  laneKind: TapeInspectorEvidenceLaneKind
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
      source: 'evidence_lane'
      laneKind: TapeInspectorEvidenceLaneKind
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
  messageDiagnostics: boolean
}

export interface TapeInspectorMessageDiagnosticsTarget {
  messageId: string
  requestSeq?: number
}

const REQUEST_EVIDENCE_LANE_KEY = 'lane:request-evidence'
const EARLIER_EVIDENCE_LANE_KEY = 'lane:earlier-evidence'
const DIAGNOSTIC_EVIDENCE_LANE_KEY = 'lane:diagnostic-evidence'

function groupKey(
  kind: TapeInspectorGroupKind,
  identity: unknown[],
  tapeIncarnationId: string
): string {
  return `group:${kind}:${tapeIncarnationId}:${JSON.stringify(identity)}`
}

export function getTapeInspectorRowDomId(key: string): string {
  return `tape-inspector-row-${encodeURIComponent(key)}`
}

export function getTapeInspectorEvidenceEntryIdentityKey(
  evidence: Pick<TapeInspectorEvidenceRecord, 'messageId' | 'requestSeq' | 'physicalAttempt'>
): string | null {
  if (evidence.requestSeq === 0 || evidence.physicalAttempt === undefined) return null
  return JSON.stringify([evidence.messageId, evidence.requestSeq, evidence.physicalAttempt])
}

export function getFactGroupDescriptors(
  record: TapeInspectorFactRecord,
  tapeIncarnationId: string
): TapeInspectorGroupDescriptor[] {
  const groups: TapeInspectorGroupDescriptor[] = []
  if (record.runId) {
    groups.push({
      key: groupKey('run', [record.runId], tapeIncarnationId),
      kind: 'run',
      runId: record.runId
    })
  }
  if (record.messageId && record.requestSeq !== undefined) {
    groups.push({
      key: groupKey('request', [record.messageId, record.requestSeq], tapeIncarnationId),
      kind: 'request',
      messageId: record.messageId,
      requestSeq: record.requestSeq
    })
    if (record.physicalAttempt !== undefined) {
      groups.push({
        key: groupKey(
          'attempt',
          [record.messageId, record.requestSeq, record.physicalAttempt],
          tapeIncarnationId
        ),
        kind: 'attempt',
        messageId: record.messageId,
        requestSeq: record.requestSeq,
        physicalAttempt: record.physicalAttempt
      })
    }
  }
  if (record.runId && record.requestSeq !== undefined && record.providerToolCallId !== undefined) {
    groups.push({
      key: groupKey(
        'tool',
        [record.runId, record.requestSeq, record.providerToolCallId, record.childOrdinal ?? null],
        tapeIncarnationId
      ),
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
  availableGroupKeys: ReadonlySet<string>,
  tapeIncarnationId: string
): string | null {
  if (evidence.requestSeq === 0) return null
  const key =
    evidence.physicalAttempt === undefined
      ? groupKey('request', [evidence.messageId, evidence.requestSeq], tapeIncarnationId)
      : groupKey(
          'attempt',
          [evidence.messageId, evidence.requestSeq, evidence.physicalAttempt],
          tapeIncarnationId
        )
  return availableGroupKeys.has(key) ? key : null
}

const GROUP_PARENT_PRIORITY: Record<TapeInspectorGroupKind, number> = {
  run: 0,
  request: 1,
  attempt: 2,
  tool: 3
}

function resolveGroupParents(
  candidates: ReadonlyMap<string, ReadonlyMap<string, TapeInspectorGroupDescriptor>>
): Map<string, TapeInspectorGroupDescriptor> {
  const parents = new Map<string, TapeInspectorGroupDescriptor>()
  for (const [childKey, values] of candidates) {
    const highestPriority = Math.max(
      ...[...values.values()].map((candidate) => GROUP_PARENT_PRIORITY[candidate.kind])
    )
    const strongest = [...values.values()].filter(
      (candidate) => GROUP_PARENT_PRIORITY[candidate.kind] === highestPriority
    )
    if (strongest.length === 1) parents.set(childKey, strongest[0])
  }
  return parents
}

function expandGroupAncestors(
  leaf: TapeInspectorGroupDescriptor | undefined,
  parents: ReadonlyMap<string, TapeInspectorGroupDescriptor>
): TapeInspectorGroupDescriptor[] {
  if (!leaf) return []
  const path: TapeInspectorGroupDescriptor[] = []
  const seen = new Set<string>()
  let current: TapeInspectorGroupDescriptor | undefined = leaf
  while (current && !seen.has(current.key)) {
    path.push(current)
    seen.add(current.key)
    current = parents.get(current.key)
  }
  return path.reverse()
}

function factStatus(record: TapeInspectorFactRecord): string | null {
  if (record.facts?.isError === true) return 'error'
  if (record.facts?.isError === false) return 'success'
  return record.facts?.status ?? record.facts?.outcome ?? null
}

function uniqueStatus(statuses: Array<string | null>): string | null {
  const values = [...new Set(statuses.filter((status): status is string => status !== null))]
  return values.length === 1 ? values[0] : null
}

function providerAttemptGroupStatus(
  group: TapeInspectorGroupDescriptor,
  matching: readonly TapeInspectorFactRecord[]
): string | null {
  const attempts = matching.filter((record) => record.name === 'provider/attempt_completed')
  if (group.kind === 'attempt') return uniqueStatus(attempts.map(factStatus))
  const numberedAttempts = attempts.filter(
    (record): record is TapeInspectorFactRecord & { physicalAttempt: number } =>
      record.physicalAttempt !== undefined
  )
  if (numberedAttempts.length === 0) return uniqueStatus(attempts.map(factStatus))
  const latestAttempt = Math.max(...numberedAttempts.map((record) => record.physicalAttempt))
  return uniqueStatus(
    numberedAttempts.filter((record) => record.physicalAttempt === latestAttempt).map(factStatus)
  )
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
  return providerAttemptGroupStatus(group, matching)
}

function groupSummary(matching: readonly TapeInspectorFactRecord[]): TapeInspectorGroupSummary {
  const values = {
    toolName: new Set<string>(),
    targetServer: new Set<string>(),
    providerId: new Set<string>(),
    modelId: new Set<string>(),
    outcome: new Set<string>(),
    stopReason: new Set<string>(),
    retryDecision: new Set<string>(),
    errorCode: new Set<string>()
  }
  for (const record of matching) {
    for (const key of Object.keys(values) as Array<keyof typeof values>) {
      const value = record.facts?.[key]
      if (value) values[key].add(value)
    }
  }
  const unique = (set: ReadonlySet<string>): string | undefined =>
    set.size === 1 ? [...set][0] : undefined
  return {
    factCount: matching.length,
    toolName: unique(values.toolName),
    targetServer: unique(values.targetServer),
    providerId: unique(values.providerId),
    modelId: unique(values.modelId),
    outcome: unique(values.outcome),
    stopReason: unique(values.stopReason),
    retryDecision: unique(values.retryDecision),
    errorCode: unique(values.errorCode)
  }
}

interface TimingPair {
  startEntryId: number
  startAt: number
  endAt: number
  durationMs: number
}

function groupStartAt(
  group: TapeInspectorGroupDescriptor,
  matching: readonly TapeInspectorFactRecord[]
): number | null {
  if (group.kind !== 'run' && group.kind !== 'tool') return null
  const startName = group.kind === 'run' ? 'execution/run_started' : 'execution/dispatch_committed'
  const starts = matching.filter((record) => record.name === startName)
  return starts.length === 1 ? starts[0].createdAt : null
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

function groupIncompleteReason(input: {
  group: TapeInspectorGroupDescriptor
  matching: readonly TapeInspectorFactRecord[]
  hasOlder: boolean
  filtersActive: boolean
  loadingNewer: boolean
}): TapeInspectorIncompleteReason {
  if (input.group.kind !== 'run' && input.group.kind !== 'tool') return 'not_recorded'
  const startName =
    input.group.kind === 'run' ? 'execution/run_started' : 'execution/dispatch_committed'
  const endName = input.group.kind === 'run' ? 'execution/run_terminal' : 'execution/tool_outcome'
  const starts = input.matching.filter((record) => record.name === startName)
  const ends = input.matching.filter((record) => record.name === endName)
  if (
    starts.length > 1 ||
    ends.length > 1 ||
    (starts.length === 1 && ends.length === 1 && ends[0].createdAt < starts[0].createdAt)
  ) {
    return 'inconsistent'
  }
  if (input.filtersActive) return 'filtered'
  if (starts.length === 0 && ends.length === 1 && input.hasOlder) return 'earlier_history'
  if (input.loadingNewer) return 'awaiting_live'
  return 'not_recorded'
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
    record.requestSeq === 0
      ? 'diagnostic'
      : record.physicalAttempt === undefined
        ? 'request scoped'
        : String(record.physicalAttempt)
  ]
    .join('\n')
    .toLocaleLowerCase()
    .includes(search)
}

function normalizePosition(value: number, min: number, max: number): number {
  if (max <= min) return 0.5
  return Math.min(1, Math.max(0, (value - min) / (max - min)))
}

function evidenceIdentityComparator(
  left: TapeInspectorEvidenceRecord,
  right: TapeInspectorEvidenceRecord
): number {
  return (
    (left.physicalAttempt ?? -1) - (right.physicalAttempt ?? -1) ||
    left.createdAt - right.createdAt ||
    left.traceId.localeCompare(right.traceId)
  )
}

function evidenceChronologyComparator(
  left: TapeInspectorEvidenceRecord,
  right: TapeInspectorEvidenceRecord
): number {
  return left.createdAt - right.createdAt || left.traceId.localeCompare(right.traceId)
}

const EVIDENCE_LANE_KEYS: Record<TapeInspectorEvidenceLaneKind, string> = {
  earlier: EARLIER_EVIDENCE_LANE_KEY,
  request: REQUEST_EVIDENCE_LANE_KEY,
  diagnostic: DIAGNOSTIC_EVIDENCE_LANE_KEY
}

function evidenceRow(input: {
  evidence: TapeInspectorEvidenceRecord
  association: TapeInspectorEvidenceAssociation
  parentGroupKey: string | null
  depth: number
  sequenceStart: number
  minCreatedAt: number
  maxCreatedAt: number
}): TapeInspectorEvidenceRow {
  return {
    recordType: 'evidence',
    key: input.evidence.key,
    record: input.evidence,
    parentGroupKey: input.parentGroupKey,
    association: input.association,
    depth: input.depth,
    status: null,
    statusState: 'not_applicable',
    durationMs: null,
    timingState: 'point',
    sequenceEntryId: null,
    sequenceStart: input.sequenceStart,
    actualStartAt: input.evidence.createdAt,
    actualEndAt: null,
    actualStart: normalizePosition(
      input.evidence.createdAt,
      input.minCreatedAt,
      input.maxCreatedAt
    ),
    actualWidth: 0
  }
}

function appendEvidenceLane(
  rows: TapeInspectorDisplayRow[],
  kind: TapeInspectorEvidenceLaneKind,
  evidence: readonly TapeInspectorEvidenceRecord[],
  collapsedKeys: ReadonlySet<string>,
  minCreatedAt: number,
  maxCreatedAt: number,
  associationFor: (record: TapeInspectorEvidenceRecord) => TapeInspectorEvidenceAssociation
): void {
  if (evidence.length === 0) return
  const key = EVIDENCE_LANE_KEYS[kind]
  const collapsed = collapsedKeys.has(key)
  rows.push({
    recordType: 'evidence_lane',
    key,
    laneKind: kind,
    count: evidence.length,
    collapsed,
    depth: 0,
    status: null,
    statusState: 'not_applicable',
    durationMs: null,
    timingState: 'not_applicable',
    sequenceEntryId: null,
    sequenceStart: 1,
    actualStartAt: null,
    actualEndAt: null,
    actualStart: 1,
    actualWidth: 0
  })
  if (collapsed) return
  for (const record of evidence) {
    rows.push(
      evidenceRow({
        evidence: record,
        association: associationFor(record),
        parentGroupKey: null,
        depth: 1,
        sequenceStart: 1,
        minCreatedAt,
        maxCreatedAt
      })
    )
  }
}

export function buildTapeInspectorRows(input: {
  tapeIncarnationId: string | null
  records: readonly TapeInspectorFactRecord[]
  evidence: readonly TapeInspectorEvidenceRecord[]
  evidenceEntryResolutions?: ReadonlyMap<string, number | null>
  collapsedKeys: ReadonlySet<string>
  search?: string
  flat?: boolean
  chronological?: boolean
  hasOlder?: boolean
  filtersActive?: boolean
  loadingNewer?: boolean
}): TapeInspectorDisplayRow[] {
  const records = input.flat
    ? [...input.records]
    : [...input.records].sort((left, right) => left.entryId - right.entryId)
  const normalizedSearch = input.search?.trim().toLocaleLowerCase() ?? ''
  const descriptors = new Map<string, TapeInspectorGroupDescriptor>()
  const directGroupsByEntryId = new Map<number, TapeInspectorGroupDescriptor[]>()
  const groupsByEntryId = new Map<number, TapeInspectorGroupDescriptor[]>()
  const recordsByGroup = new Map<string, TapeInspectorFactRecord[]>()
  const parentCandidates = new Map<string, Map<string, TapeInspectorGroupDescriptor>>()
  for (const record of records) {
    const groups = getFactGroupDescriptors(record, input.tapeIncarnationId ?? 'unknown')
    directGroupsByEntryId.set(record.entryId, groups)
    for (const descriptor of groups) {
      descriptors.set(descriptor.key, descriptor)
      const matching = recordsByGroup.get(descriptor.key) ?? []
      matching.push(record)
      recordsByGroup.set(descriptor.key, matching)
    }
    for (let index = 1; index < groups.length; index += 1) {
      const parent = groups[index - 1]
      const child = groups[index]
      const candidates = parentCandidates.get(child.key) ?? new Map()
      candidates.set(parent.key, parent)
      parentCandidates.set(child.key, candidates)
    }
  }
  const groupParents = resolveGroupParents(parentCandidates)
  for (const record of records) {
    const directGroups = directGroupsByEntryId.get(record.entryId) ?? []
    groupsByEntryId.set(record.entryId, expandGroupAncestors(directGroups.at(-1), groupParents))
  }
  const groupKeys = new Set(descriptors.keys())
  const evidenceByParent = new Map<string, TapeInspectorEvidenceRecord[]>()
  const searchMatchingEvidenceParents = new Set<string>()
  const diagnosticEvidence: TapeInspectorEvidenceRecord[] = []
  const earlierLaneEvidence: TapeInspectorEvidenceRecord[] = []
  const requestLaneEvidence: TapeInspectorEvidenceRecord[] = []
  const loadedEntryIds = records.map((record) => record.entryId)
  const minLoadedEntryId = loadedEntryIds.length > 0 ? Math.min(...loadedEntryIds) : null
  const maxLoadedEntryId = loadedEntryIds.length > 0 ? Math.max(...loadedEntryIds) : null
  const resolutionFor = (record: TapeInspectorEvidenceRecord): number | null | undefined => {
    const key = getTapeInspectorEvidenceEntryIdentityKey(record)
    return key && input.evidenceEntryResolutions?.has(key)
      ? input.evidenceEntryResolutions.get(key)
      : undefined
  }
  const standaloneAssociationFor = (
    record: TapeInspectorEvidenceRecord
  ): TapeInspectorEvidenceAssociation => {
    if (record.physicalAttempt === undefined) return 'request'
    const resolution = resolutionFor(record)
    if (resolution === undefined) return 'unresolved'
    if (resolution === null) return 'not_recorded'
    if (maxLoadedEntryId !== null && resolution > maxLoadedEntryId) return 'newer'
    return 'filtered'
  }
  for (const evidence of input.evidence) {
    if (evidence.requestSeq === 0) {
      if (matchesEvidenceSearch(evidence, normalizedSearch)) diagnosticEvidence.push(evidence)
      continue
    }
    const parentKey = getEvidenceParentGroupKey(
      evidence,
      groupKeys,
      input.tapeIncarnationId ?? 'unknown'
    )
    if (!parentKey) {
      if (matchesEvidenceSearch(evidence, normalizedSearch)) {
        const resolution = resolutionFor(evidence)
        if (
          !input.flat &&
          typeof resolution === 'number' &&
          minLoadedEntryId !== null &&
          resolution < minLoadedEntryId
        ) {
          earlierLaneEvidence.push(evidence)
        } else {
          requestLaneEvidence.push(evidence)
        }
      }
      continue
    }
    const values = evidenceByParent.get(parentKey) ?? []
    values.push(evidence)
    evidenceByParent.set(parentKey, values)
    if (matchesEvidenceSearch(evidence, normalizedSearch)) {
      searchMatchingEvidenceParents.add(parentKey)
    }
  }
  for (const values of evidenceByParent.values()) values.sort(evidenceIdentityComparator)
  diagnosticEvidence.sort(evidenceChronologyComparator)
  earlierLaneEvidence.sort(evidenceChronologyComparator)
  requestLaneEvidence.sort(evidenceChronologyComparator)

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
    if (record.requestSeq === 0) continue
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
      const status = factStatus(record)
      return {
        recordType: 'fact',
        key: `fact:${input.tapeIncarnationId ?? 'unknown'}:${record.key}`,
        record,
        depth: 0,
        status,
        statusState: status === null ? 'not_applicable' : 'explicit',
        durationMs: null,
        timingState: 'point',
        sequenceEntryId: record.entryId,
        sequenceStart: normalizePosition(record.entryId, minEntryId, maxEntryId),
        actualStartAt: record.createdAt,
        actualEndAt: null,
        actualStart: normalizePosition(record.createdAt, minCreatedAt, maxCreatedAt),
        actualWidth: 0
      }
    })
    appendEvidenceLane(
      flatRows,
      'earlier',
      earlierLaneEvidence,
      input.collapsedKeys,
      minCreatedAt,
      maxCreatedAt,
      () => 'earlier'
    )
    appendEvidenceLane(
      flatRows,
      'request',
      requestLaneEvidence,
      input.collapsedKeys,
      minCreatedAt,
      maxCreatedAt,
      standaloneAssociationFor
    )
    appendEvidenceLane(
      flatRows,
      'diagnostic',
      diagnosticEvidence,
      input.collapsedKeys,
      minCreatedAt,
      maxCreatedAt,
      () => 'diagnostic'
    )
    return flatRows
  }

  if (input.chronological) {
    const chronologicalRows: TapeInspectorDisplayRow[] = visibleFacts.map((record) => {
      const status = factStatus(record)
      return {
        recordType: 'fact',
        key: `fact:${input.tapeIncarnationId ?? 'unknown'}:${record.key}`,
        record,
        depth: 0,
        status,
        statusState: status === null ? 'not_applicable' : 'explicit',
        durationMs: null,
        timingState: 'point',
        sequenceEntryId: record.entryId,
        sequenceStart: normalizePosition(record.entryId, minEntryId, maxEntryId),
        actualStartAt: record.createdAt,
        actualEndAt: null,
        actualStart: normalizePosition(record.createdAt, minCreatedAt, maxCreatedAt),
        actualWidth: 0
      }
    })
    for (const record of input.evidence) {
      if (record.requestSeq === 0 || !matchesEvidenceSearch(record, normalizedSearch)) continue
      const parentKey = getEvidenceParentGroupKey(
        record,
        groupKeys,
        input.tapeIncarnationId ?? 'unknown'
      )
      const parent = parentKey ? descriptors.get(parentKey) : undefined
      const association = parent
        ? parent.kind === 'request'
          ? 'request'
          : 'attempt'
        : typeof resolutionFor(record) === 'number' &&
            minLoadedEntryId !== null &&
            (resolutionFor(record) as number) < minLoadedEntryId
          ? 'earlier'
          : standaloneAssociationFor(record)
      chronologicalRows.push(
        evidenceRow({
          evidence: record,
          association,
          parentGroupKey: parentKey,
          depth: 0,
          sequenceStart:
            parentKey === null
              ? 1
              : normalizePosition(
                  recordsByGroup.get(parentKey)?.at(-1)?.entryId ?? maxEntryId,
                  minEntryId,
                  maxEntryId
                ),
          minCreatedAt,
          maxCreatedAt
        })
      )
    }
    chronologicalRows.sort((left, right) => {
      const time = (left.actualStartAt ?? 0) - (right.actualStartAt ?? 0)
      if (time !== 0) return time
      const domain = (left.recordType === 'fact' ? 0 : 1) - (right.recordType === 'fact' ? 0 : 1)
      if (domain !== 0) return domain
      if (left.recordType === 'fact' && right.recordType === 'fact') {
        return left.record.entryId - right.record.entryId
      }
      return left.key.localeCompare(right.key)
    })
    appendEvidenceLane(
      chronologicalRows,
      'diagnostic',
      diagnosticEvidence,
      input.collapsedKeys,
      minCreatedAt,
      maxCreatedAt,
      () => 'diagnostic'
    )
    return chronologicalRows
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
        const matching = recordsByGroup.get(group.key) ?? []
        const timing = timings.get(group.key) ?? null
        const knownStartAt = timing?.startAt ?? groupStartAt(group, matching)
        const status = groupStatus(group, matching)
        const incompleteReason =
          status === null || ((group.kind === 'run' || group.kind === 'tool') && timing === null)
            ? groupIncompleteReason({
                group,
                matching,
                hasOlder: input.hasOlder === true,
                filtersActive: input.filtersActive === true,
                loadingNewer: input.loadingNewer === true
              })
            : undefined
        result.push({
          recordType: 'group',
          key: group.key,
          group,
          summary: groupSummary(matching),
          depth: index,
          collapsed: input.collapsedKeys.has(group.key),
          status,
          statusState: status === null ? 'unresolved' : 'explicit',
          durationMs: timing?.durationMs ?? null,
          timingState:
            group.kind === 'run' || group.kind === 'tool'
              ? timing
                ? 'span'
                : 'unresolved'
              : 'not_applicable',
          sequenceEntryId: record.entryId,
          sequenceStart: normalizePosition(record.entryId, minEntryId, maxEntryId),
          actualStartAt: knownStartAt,
          actualEndAt: timing?.endAt ?? null,
          actualStart:
            knownStartAt === null
              ? 0.5
              : normalizePosition(knownStartAt, minCreatedAt, maxCreatedAt),
          actualWidth: timing
            ? normalizePosition(timing.endAt, minCreatedAt, maxCreatedAt) -
              normalizePosition(timing.startAt, minCreatedAt, maxCreatedAt)
            : 0,
          ...(incompleteReason ? { incompleteReason } : {})
        })
        emittedGroups.add(group.key)
      }
      if (input.collapsedKeys.has(group.key)) hidden = true
    }
    if (!hidden) {
      const status = factStatus(record)
      result.push({
        recordType: 'fact',
        key: `fact:${input.tapeIncarnationId ?? 'unknown'}:${record.key}`,
        record,
        depth: groups.length,
        status,
        statusState: status === null ? 'not_applicable' : 'explicit',
        durationMs: null,
        timingState: 'point',
        sequenceEntryId: record.entryId,
        sequenceStart: normalizePosition(record.entryId, minEntryId, maxEntryId),
        actualStartAt: record.createdAt,
        actualEndAt: null,
        actualStart: normalizePosition(record.createdAt, minCreatedAt, maxCreatedAt),
        actualWidth: 0
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
        result.push(
          evidenceRow({
            evidence,
            association: group.kind === 'request' ? 'request' : 'attempt',
            parentGroupKey: group.key,
            depth: groupIndex + 1,
            sequenceStart: normalizePosition(record.entryId, minEntryId, maxEntryId),
            minCreatedAt,
            maxCreatedAt
          })
        )
      }
    }
  }

  appendEvidenceLane(
    result,
    'diagnostic',
    diagnosticEvidence,
    input.collapsedKeys,
    minCreatedAt,
    maxCreatedAt,
    () => 'diagnostic'
  )
  appendEvidenceLane(
    result,
    'earlier',
    earlierLaneEvidence,
    input.collapsedKeys,
    minCreatedAt,
    maxCreatedAt,
    () => 'earlier'
  )
  appendEvidenceLane(
    result,
    'request',
    requestLaneEvidence,
    input.collapsedKeys,
    minCreatedAt,
    maxCreatedAt,
    standaloneAssociationFor
  )
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
      messageDiagnostics: true
    }
  }
  if (row.recordType === 'fact') {
    const payload =
      row.record.family === 'journal' ||
      row.record.family === 'attempt' ||
      row.record.family === 'anchor' ||
      row.record.kind === 'tool_call' ||
      row.record.kind === 'tool_result'
    return {
      source: 'tape',
      summary: true,
      payload,
      timing: true,
      provenance: true,
      integrity: row.record.integrity !== undefined,
      raw: false,
      messageDiagnostics: Boolean(row.record.messageId)
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
    messageDiagnostics: row.recordType === 'group' && Boolean(row.group.messageId)
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
  if (input.requestSeq === undefined && requestGroups.length > 1) return null
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
  if (
    input.requestSeq === undefined &&
    new Set(
      matchingRows.flatMap((row) =>
        (row.recordType === 'fact' || row.recordType === 'evidence') &&
        row.record.requestSeq !== undefined
          ? [row.record.requestSeq]
          : []
      )
    ).size > 1
  ) {
    return null
  }
  return matchingRows.at(-1)?.key ?? null
}

export { DIAGNOSTIC_EVIDENCE_LANE_KEY, EARLIER_EVIDENCE_LANE_KEY, REQUEST_EVIDENCE_LANE_KEY }
