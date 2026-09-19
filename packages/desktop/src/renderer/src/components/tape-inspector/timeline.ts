import type { TapeInspectorDisplayRow } from './model'

export type TapeInspectorTimelineMode = 'actual' | 'sequence'
export type TapeInspectorTimelineLane = 'session' | 'model' | 'tool'

export interface TapeInspectorTimelineItem {
  key: string
  row: TapeInspectorDisplayRow
  lane: TapeInspectorTimelineLane
  start: number
  width: number
  count: number
  point: boolean
}

interface TimelineCandidate {
  row: TapeInspectorDisplayRow
  lane: TapeInspectorTimelineLane
  start: number
  width: number
  point: boolean
}

function timelineLane(row: TapeInspectorDisplayRow): TapeInspectorTimelineLane | null {
  if (row.recordType === 'evidence_lane') return null
  if (row.recordType === 'evidence') {
    return row.association === 'diagnostic' ? null : 'model'
  }
  if (row.recordType === 'group') {
    if (row.group.kind === 'tool') return 'tool'
    if (row.group.kind === 'request' || row.group.kind === 'attempt') return 'model'
    return 'session'
  }
  if (row.record.family === 'tool') return 'tool'
  if (row.record.family === 'attempt') return 'model'
  return 'session'
}

function shouldPlotFact(row: TapeInspectorDisplayRow): boolean {
  if (row.recordType !== 'fact') return true
  if (row.depth === 0 || row.status === 'error' || row.record.facts?.isError === true) return true
  return (
    row.record.family === 'context' ||
    row.record.family === 'view' ||
    row.record.family === 'anchor' ||
    row.record.family === 'lineage' ||
    row.record.family === 'attempt' ||
    row.record.family === 'tool'
  )
}

function candidateForRow(
  row: TapeInspectorDisplayRow,
  mode: TapeInspectorTimelineMode
): TimelineCandidate | null {
  const lane = timelineLane(row)
  if (!lane || !shouldPlotFact(row)) return null
  if (mode === 'sequence') {
    if (row.sequenceEntryId === null) return null
    return { row, lane, start: row.sequenceStart, width: 0, point: true }
  }
  if (row.actualStartAt === null || (row.timingState !== 'span' && row.timingState !== 'point')) {
    return null
  }
  return {
    row,
    lane,
    start: row.actualStart,
    width: row.timingState === 'span' ? row.actualWidth : 0,
    point: row.timingState !== 'span'
  }
}

function candidatePriority(candidate: TimelineCandidate, selectedKey: string | null): number {
  if (candidate.row.key === selectedKey) return 4
  if (candidate.row.status === 'error') return 3
  if (!candidate.point) return 2
  return candidate.row.recordType === 'group' ? 1 : 0
}

export function buildTapeInspectorTimelineItems(input: {
  rows: readonly TapeInspectorDisplayRow[]
  mode: TapeInspectorTimelineMode
  viewportStart: number
  viewportEnd: number
  selectedKey: string | null
  bucketsPerLane?: number
}): TapeInspectorTimelineItem[] {
  const bucketsPerLane = Math.max(8, Math.min(96, input.bucketsPerLane ?? 72))
  const viewportSpan = Math.max(0.0001, input.viewportEnd - input.viewportStart)
  const buckets = new Map<string, { candidate: TimelineCandidate; count: number }>()
  for (const row of input.rows) {
    const candidate = candidateForRow(row, input.mode)
    if (!candidate) continue
    const candidateEnd = candidate.start + candidate.width
    if (candidateEnd < input.viewportStart || candidate.start > input.viewportEnd) continue
    const visibleStart = Math.max(candidate.start, input.viewportStart)
    const bucketIndex = Math.min(
      bucketsPerLane - 1,
      Math.floor(((visibleStart - input.viewportStart) / viewportSpan) * bucketsPerLane)
    )
    const bucketKey = `${candidate.lane}:${bucketIndex}`
    const bucket = buckets.get(bucketKey)
    if (!bucket) {
      buckets.set(bucketKey, { candidate, count: 1 })
      continue
    }
    bucket.count += 1
    if (
      candidatePriority(candidate, input.selectedKey) >
      candidatePriority(bucket.candidate, input.selectedKey)
    ) {
      bucket.candidate = candidate
    }
  }

  return [...buckets.entries()].map(([key, bucket]) => {
    const visibleStart = Math.max(bucket.candidate.start, input.viewportStart)
    const visibleEnd = Math.min(bucket.candidate.start + bucket.candidate.width, input.viewportEnd)
    return {
      key,
      row: bucket.candidate.row,
      lane: bucket.candidate.lane,
      start: (visibleStart - input.viewportStart) / viewportSpan,
      width: Math.max(0, (visibleEnd - visibleStart) / viewportSpan),
      count: bucket.count,
      point: bucket.candidate.point
    }
  })
}
