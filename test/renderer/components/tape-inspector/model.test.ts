import { describe, expect, it } from 'vitest'
import type {
  TapeInspectorEvidenceRecord,
  TapeInspectorFactRecord
} from '@shared/types/tape-inspector'
import {
  buildTapeInspectorRows,
  getEvidenceParentGroupKey,
  getFactGroupDescriptors,
  UNBOUND_EVIDENCE_LANE_KEY
} from '@/components/tape-inspector/model'

function fact(
  entryId: number,
  overrides: Partial<TapeInspectorFactRecord> = {}
): TapeInspectorFactRecord {
  return {
    recordType: 'fact',
    key: `entry:${entryId}`,
    entryId,
    kind: 'event',
    family: 'other',
    name: null,
    createdAt: entryId * 10,
    ...overrides
  }
}

function evidence(
  traceId: string,
  overrides: Partial<TapeInspectorEvidenceRecord> = {}
): TapeInspectorEvidenceRecord {
  return {
    recordType: 'evidence',
    key: `trace:${traceId}`,
    traceId,
    messageId: 'message-1',
    requestSeq: 4,
    providerId: 'provider-1',
    modelId: 'model-1',
    createdAt: 100,
    truncated: false,
    ...overrides
  }
}

describe('Tape Inspector renderer projection', () => {
  it('projects every Tape fact exactly once, including unrecognized rows', () => {
    const records = [
      fact(1, { name: 'known', family: 'journal', runId: 'run-1' }),
      fact(2, { name: null, family: 'other' }),
      fact(3, { kind: 'tool_call', family: 'tool', name: 'tool-name' })
    ]

    const rows = buildTapeInspectorRows({
      tapeIncarnationId: 'incarnation-1',
      records,
      evidence: [],
      collapsedKeys: new Set()
    })

    expect(
      rows.filter((row) => row.recordType === 'fact').map((row) => row.record.entryId)
    ).toEqual([1, 2, 3])
    expect(rows.find((row) => row.recordType === 'fact')?.key).toBe('fact:incarnation-1:entry:1')
  })

  it('binds exact attempts and keeps null attempts at the request group', () => {
    const attemptZero = fact(1, {
      family: 'attempt',
      name: 'provider/attempt_recorded',
      messageId: 'message-1',
      requestSeq: 4,
      physicalAttempt: 0
    })
    const attemptOne = fact(2, {
      family: 'attempt',
      name: 'provider/attempt_recorded',
      messageId: 'message-1',
      requestSeq: 4,
      physicalAttempt: 1
    })
    const groups = [...getFactGroupDescriptors(attemptZero), ...getFactGroupDescriptors(attemptOne)]
    const groupKeys = new Set(groups.map((group) => group.key))
    const exact = evidence('exact-zero', { physicalAttempt: 0 })
    const legacy = evidence('legacy')

    expect(getEvidenceParentGroupKey(exact, groupKeys)).toBe(
      groups.find((group) => group.kind === 'attempt' && group.physicalAttempt === 0)?.key
    )
    expect(getEvidenceParentGroupKey(legacy, groupKeys)).toBe(
      groups.find((group) => group.kind === 'request')?.key
    )
    expect(
      getEvidenceParentGroupKey(evidence('missing', { physicalAttempt: 2 }), groupKeys)
    ).toBeNull()

    const rows = buildTapeInspectorRows({
      tapeIncarnationId: 'incarnation-1',
      records: [attemptZero, attemptOne],
      evidence: [legacy, exact, evidence('missing', { physicalAttempt: 2 })],
      collapsedKeys: new Set()
    })
    const exactRow = rows.find((row) => row.key === exact.key)
    const legacyRow = rows.find((row) => row.key === legacy.key)
    const missingRow = rows.find((row) => row.key === 'trace:missing')

    expect(exactRow?.recordType).toBe('evidence')
    expect(exactRow?.recordType === 'evidence' && exactRow.legacyUnattributed).toBe(false)
    expect(exactRow?.sequenceEntryId).toBeNull()
    expect(exactRow?.actualStartAt).toBe(100)
    expect(legacyRow?.recordType === 'evidence' && legacyRow.legacyUnattributed).toBe(true)
    expect(missingRow?.recordType === 'evidence' && missingRow.parentGroupKey).toBeNull()
    expect(rows.some((row) => row.key === UNBOUND_EVIDENCE_LANE_KEY)).toBe(true)
  })

  it('does not hide request evidence when a descendant attempt is collapsed', () => {
    const record = fact(1, {
      family: 'attempt',
      name: 'provider/attempt_recorded',
      messageId: 'message-1',
      requestSeq: 4,
      physicalAttempt: 0
    })
    const attemptGroup = getFactGroupDescriptors(record).find((group) => group.kind === 'attempt')

    const rows = buildTapeInspectorRows({
      tapeIncarnationId: 'incarnation-1',
      records: [record],
      evidence: [evidence('legacy')],
      collapsedKeys: new Set(attemptGroup ? [attemptGroup.key] : [])
    })

    expect(rows.some((row) => row.key === 'trace:legacy')).toBe(true)
    expect(rows.some((row) => row.recordType === 'fact')).toBe(false)
  })

  it('pairs duration only for authoritative endpoints with the same identity', () => {
    const records = [
      fact(1, { name: 'execution/run_started', runId: 'run-1', createdAt: 100 }),
      fact(2, { name: 'execution/run_terminal', runId: 'run-2', createdAt: 130 }),
      fact(3, {
        name: 'execution/dispatch_committed',
        runId: 'run-1',
        requestSeq: 1,
        providerToolCallId: 'call-1',
        createdAt: 200
      }),
      fact(4, {
        name: 'execution/tool_outcome',
        runId: 'run-1',
        requestSeq: 1,
        providerToolCallId: 'call-1',
        createdAt: 260,
        facts: { isError: false }
      }),
      fact(5, { name: 'execution/run_started', runId: 'run-3', createdAt: 400 }),
      fact(6, { name: 'execution/run_terminal', runId: 'run-3', createdAt: 390 })
    ]

    const rows = buildTapeInspectorRows({
      tapeIncarnationId: 'incarnation-1',
      records,
      evidence: [],
      collapsedKeys: new Set()
    })
    const runOne = rows.find(
      (row) => row.recordType === 'group' && row.group.kind === 'run' && row.group.runId === 'run-1'
    )
    const runTwo = rows.find(
      (row) => row.recordType === 'group' && row.group.kind === 'run' && row.group.runId === 'run-2'
    )
    const runThree = rows.find(
      (row) => row.recordType === 'group' && row.group.kind === 'run' && row.group.runId === 'run-3'
    )
    const tool = rows.find(
      (row) =>
        row.recordType === 'group' &&
        row.group.kind === 'tool' &&
        row.group.providerToolCallId === 'call-1'
    )

    expect(runOne?.durationMs).toBeNull()
    expect(runOne?.status).toBeNull()
    expect(runOne?.actualStartAt).toBeNull()
    expect(runOne?.actualEndAt).toBeNull()
    expect(runTwo?.durationMs).toBeNull()
    expect(runThree?.durationMs).toBeNull()
    expect(tool?.durationMs).toBe(60)
    expect(tool?.actualStartAt).toBe(200)
    expect(tool?.actualEndAt).toBe(260)
    expect(tool?.sequenceEntryId).toBe(3)
    const dispatch = rows.find((row) => row.recordType === 'fact' && row.record.entryId === 3)
    expect(dispatch?.durationMs).toBe(60)
    expect(dispatch?.actualStartAt).toBe(200)
    expect(dispatch?.actualEndAt).toBe(260)
    expect(dispatch?.sequenceEntryId).toBe(3)
  })

  it('upgrades delayed timing without pairing nested operations across identities', () => {
    const dispatch = fact(1, {
      name: 'execution/dispatch_committed',
      runId: 'run-1',
      requestSeq: 1,
      providerToolCallId: 'call-1',
      childOrdinal: 0,
      createdAt: 100
    })
    const siblingOutcome = fact(2, {
      name: 'execution/tool_outcome',
      runId: 'run-1',
      requestSeq: 1,
      providerToolCallId: 'call-1',
      childOrdinal: 1,
      createdAt: 150,
      facts: { isError: false }
    })
    const beforeOutcome = buildTapeInspectorRows({
      tapeIncarnationId: 'incarnation-1',
      records: [dispatch, siblingOutcome],
      evidence: [],
      collapsedKeys: new Set()
    })
    expect(
      beforeOutcome.find(
        (row) =>
          row.recordType === 'group' && row.group.kind === 'tool' && row.group.childOrdinal === 0
      )?.durationMs
    ).toBeNull()

    const afterOutcome = buildTapeInspectorRows({
      tapeIncarnationId: 'incarnation-1',
      records: [
        dispatch,
        siblingOutcome,
        fact(3, {
          name: 'execution/tool_outcome',
          runId: 'run-1',
          requestSeq: 1,
          providerToolCallId: 'call-1',
          childOrdinal: 0,
          createdAt: 170,
          facts: { isError: false }
        })
      ],
      evidence: [],
      collapsedKeys: new Set()
    })
    expect(
      afterOutcome.find(
        (row) =>
          row.recordType === 'group' && row.group.kind === 'tool' && row.group.childOrdinal === 0
      )?.durationMs
    ).toBe(70)
  })

  it('keeps equal-timestamp facts in canonical entry order', () => {
    const rows = buildTapeInspectorRows({
      tapeIncarnationId: 'incarnation-1',
      records: [
        fact(3, { createdAt: 100 }),
        fact(1, { createdAt: 100 }),
        fact(2, { createdAt: 100 })
      ],
      evidence: [],
      collapsedKeys: new Set()
    })

    expect(
      rows.filter((row) => row.recordType === 'fact').map((row) => row.record.entryId)
    ).toEqual([1, 2, 3])
  })

  it('searches evidence metadata without moving it into the Tape ordering domain', () => {
    const record = fact(10, {
      name: 'provider/attempt_recorded',
      family: 'attempt',
      messageId: 'message-1',
      requestSeq: 4,
      physicalAttempt: 1
    })
    const rows = buildTapeInspectorRows({
      tapeIncarnationId: 'incarnation-1',
      records: [record],
      evidence: [evidence('needle', { physicalAttempt: 1 })],
      collapsedKeys: new Set(),
      search: 'needle'
    })

    expect(rows.some((row) => row.recordType === 'fact' && row.record.entryId === 10)).toBe(true)
    expect(rows.some((row) => row.key === 'trace:needle')).toBe(true)
  })
})
