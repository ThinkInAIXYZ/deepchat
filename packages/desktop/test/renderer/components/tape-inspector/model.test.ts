import { describe, expect, it } from 'vitest'
import type {
  TapeInspectorEvidenceRecord,
  TapeInspectorFactRecord
} from '@shared/types/tape-inspector'
import {
  buildTapeInspectorRows,
  DIAGNOSTIC_EVIDENCE_LANE_KEY,
  EARLIER_EVIDENCE_LANE_KEY,
  findTapeInspectorPreselection,
  getEvidenceParentGroupKey,
  getFactGroupDescriptors,
  getTapeInspectorEvidenceEntryIdentityKey,
  REQUEST_EVIDENCE_LANE_KEY
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
  it('preselects a request only when its identity is unambiguous', () => {
    const oneRequest = buildTapeInspectorRows({
      tapeIncarnationId: 'incarnation-1',
      records: [
        fact(1, {
          messageId: 'message-1',
          requestSeq: 1,
          physicalAttempt: 0
        })
      ],
      evidence: [],
      collapsedKeys: new Set()
    })
    expect(findTapeInspectorPreselection({ rows: oneRequest, messageId: 'message-1' })).toContain(
      'group:request:'
    )

    const twoRequests = buildTapeInspectorRows({
      tapeIncarnationId: 'incarnation-1',
      records: [
        fact(1, { messageId: 'message-1', requestSeq: 1 }),
        fact(2, { messageId: 'message-1', requestSeq: 2 })
      ],
      evidence: [],
      collapsedKeys: new Set()
    })
    expect(findTapeInspectorPreselection({ rows: twoRequests, messageId: 'message-1' })).toBeNull()
    const requestTwo = twoRequests.find(
      (row) =>
        row.recordType === 'group' && row.group.kind === 'request' && row.group.requestSeq === 2
    )
    expect(
      findTapeInspectorPreselection({
        rows: twoRequests,
        messageId: 'message-1',
        requestSeq: 2
      })
    ).toBe(requestTwo?.key)
  })

  it('does not guess a request identity when only fallback rows are available', () => {
    const rows = buildTapeInspectorRows({
      tapeIncarnationId: 'incarnation-1',
      records: [
        fact(1, { messageId: 'message-1', requestSeq: 1 }),
        fact(2, { messageId: 'message-1', requestSeq: 2 })
      ],
      evidence: [],
      collapsedKeys: new Set()
    }).filter((row) => row.recordType !== 'group')

    expect(findTapeInspectorPreselection({ rows, messageId: 'message-1' })).toBeNull()
  })

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

  it('binds exact attempts and keeps unloaded request context separate from diagnostics', () => {
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
    const groups = [
      ...getFactGroupDescriptors(attemptZero, 'incarnation-1'),
      ...getFactGroupDescriptors(attemptOne, 'incarnation-1')
    ]
    const groupKeys = new Set(groups.map((group) => group.key))
    const exact = evidence('exact-zero', { physicalAttempt: 0 })
    const requestScoped = evidence('request-scoped')
    const diagnostic = evidence('diagnostic', { requestSeq: 0 })

    expect(getEvidenceParentGroupKey(exact, groupKeys, 'incarnation-1')).toBe(
      groups.find((group) => group.kind === 'attempt' && group.physicalAttempt === 0)?.key
    )
    expect(getEvidenceParentGroupKey(requestScoped, groupKeys, 'incarnation-1')).toBe(
      groups.find((group) => group.kind === 'request')?.key
    )
    expect(
      getEvidenceParentGroupKey(
        evidence('missing', { physicalAttempt: 2 }),
        groupKeys,
        'incarnation-1'
      )
    ).toBeNull()
    expect(getEvidenceParentGroupKey(diagnostic, groupKeys, 'incarnation-1')).toBeNull()

    const rows = buildTapeInspectorRows({
      tapeIncarnationId: 'incarnation-1',
      records: [attemptZero, attemptOne],
      evidence: [requestScoped, exact, diagnostic, evidence('missing', { physicalAttempt: 2 })],
      collapsedKeys: new Set()
    })
    const exactRow = rows.find((row) => row.key === exact.key)
    const requestScopedRow = rows.find((row) => row.key === requestScoped.key)
    const diagnosticRow = rows.find((row) => row.key === diagnostic.key)
    const missingRow = rows.find((row) => row.key === 'trace:missing')

    expect(exactRow?.recordType).toBe('evidence')
    expect(exactRow?.recordType === 'evidence' && exactRow.association).toBe('attempt')
    expect(exactRow?.sequenceEntryId).toBeNull()
    expect(exactRow?.actualStartAt).toBe(100)
    expect(requestScopedRow?.recordType === 'evidence' && requestScopedRow.association).toBe(
      'request'
    )
    expect(missingRow?.recordType === 'evidence' && missingRow.association).toBe('unresolved')
    expect(diagnosticRow?.recordType === 'evidence' && diagnosticRow.association).toBe('diagnostic')
    expect(rows.some((row) => row.key === DIAGNOSTIC_EVIDENCE_LANE_KEY)).toBe(true)
    expect(rows.some((row) => row.key === REQUEST_EVIDENCE_LANE_KEY)).toBe(true)
  })

  it('orders request-scoped model requests by their actual time', () => {
    const rows = buildTapeInspectorRows({
      tapeIncarnationId: 'incarnation-1',
      records: [],
      evidence: [
        evidence('latest', { createdAt: 300 }),
        evidence('earliest', { createdAt: 100 }),
        evidence('middle', { createdAt: 200 })
      ],
      collapsedKeys: new Set()
    })

    expect(
      rows
        .filter((row) => row.recordType === 'evidence')
        .map((row) => [row.record.traceId, row.actualStartAt, row.association])
    ).toEqual([
      ['earliest', 100, 'request'],
      ['middle', 200, 'request'],
      ['latest', 300, 'request']
    ])
  })

  it('merges Tape facts and model requests by display time with stable domain keys', () => {
    const input = {
      tapeIncarnationId: 'incarnation-1',
      records: [
        fact(4, { name: 'execution/run_terminal', runId: 'run-1', createdAt: 300 }),
        fact(2, { name: 'execution/run_started', runId: 'run-1', createdAt: 100 }),
        fact(3, { createdAt: 200 })
      ],
      evidence: [
        evidence('later-key', { createdAt: 200 }),
        evidence('earlier-key', { createdAt: 200 }),
        evidence('first-request', { createdAt: 150 })
      ],
      collapsedKeys: new Set<string>(),
      chronological: true
    }

    const rows = buildTapeInspectorRows(input)

    expect(rows.map((row) => row.key)).toEqual([
      'fact:incarnation-1:entry:2',
      'trace:first-request',
      'fact:incarnation-1:entry:3',
      'trace:earlier-key',
      'trace:later-key',
      'fact:incarnation-1:entry:4'
    ])
    expect(
      rows
        .filter((row) => row.recordType === 'evidence')
        .every((row) => row.sequenceEntryId === null)
    ).toBe(true)

    const sequenceRows = buildTapeInspectorRows({ ...input, chronological: false })
    expect(
      sequenceRows.filter((row) => row.recordType === 'fact').map((row) => row.record.entryId)
    ).toEqual([2, 3, 4])
    expect(sequenceRows.some((row) => row.recordType === 'group')).toBe(true)
  })

  it('states why authoritative group boundaries are incomplete without guessing', () => {
    const reasonFor = (
      records: TapeInspectorFactRecord[],
      options: { hasOlder?: boolean; filtersActive?: boolean; loadingNewer?: boolean } = {}
    ) => {
      const group = buildTapeInspectorRows({
        tapeIncarnationId: 'incarnation-1',
        records,
        evidence: [],
        collapsedKeys: new Set(),
        ...options
      }).find((row) => row.recordType === 'group' && row.group.kind === 'run')
      return group?.incompleteReason
    }
    const started = fact(1, {
      name: 'execution/run_started',
      runId: 'run-1',
      createdAt: 100
    })
    const terminal = fact(2, {
      name: 'execution/run_terminal',
      runId: 'run-1',
      createdAt: 200
    })

    expect(reasonFor([terminal], { hasOlder: true })).toBe('earlier_history')
    expect(reasonFor([started], { filtersActive: true })).toBe('filtered')
    expect(reasonFor([started], { loadingNewer: true })).toBe('awaiting_live')
    expect(reasonFor([started])).toBe('not_recorded')
    expect(reasonFor([started, fact(3, { ...started, entryId: 3, key: 'entry:3' })])).toBe(
      'inconsistent'
    )
    expect(
      reasonFor([started, fact(3, { ...started, entryId: 3, key: 'entry:3' })], {
        filtersActive: true,
        loadingNewer: true
      })
    ).toBe('inconsistent')
  })

  it('distinguishes exact parent locations without guessing across sorting domains', () => {
    const earlier = evidence('earlier', { physicalAttempt: 0 })
    const filtered = evidence('filtered', { physicalAttempt: 1 })
    const newer = evidence('newer', { physicalAttempt: 2 })
    const notRecorded = evidence('not-recorded', { physicalAttempt: 3 })
    const unresolved = evidence('unresolved', { physicalAttempt: 4 })
    const entryResolutions = new Map<string, number | null>()
    for (const [record, entryId] of [
      [earlier, 10],
      [filtered, 25],
      [newer, 40],
      [notRecorded, null]
    ] as const) {
      const key = getTapeInspectorEvidenceEntryIdentityKey(record)
      if (key) entryResolutions.set(key, entryId)
    }

    const canonicalRows = buildTapeInspectorRows({
      tapeIncarnationId: 'incarnation-1',
      records: [fact(20), fact(30)],
      evidence: [earlier, filtered, newer, notRecorded, unresolved],
      evidenceEntryResolutions: entryResolutions,
      collapsedKeys: new Set()
    })
    const association = (traceId: string): string | undefined => {
      const row = canonicalRows.find((candidate) => candidate.key === `trace:${traceId}`)
      return row?.recordType === 'evidence' ? row.association : undefined
    }

    expect(association('earlier')).toBe('earlier')
    expect(association('filtered')).toBe('filtered')
    expect(association('newer')).toBe('newer')
    expect(association('not-recorded')).toBe('not_recorded')
    expect(association('unresolved')).toBe('unresolved')
    expect(canonicalRows.some((row) => row.key === EARLIER_EVIDENCE_LANE_KEY)).toBe(true)

    const nonCanonicalRows = buildTapeInspectorRows({
      tapeIncarnationId: 'incarnation-1',
      records: [fact(20), fact(30)],
      evidence: [earlier],
      evidenceEntryResolutions: entryResolutions,
      collapsedKeys: new Set(),
      flat: true
    })
    const nonCanonicalEvidence = nonCanonicalRows.find((row) => row.key === earlier.key)
    expect(
      nonCanonicalEvidence?.recordType === 'evidence' && nonCanonicalEvidence.association
    ).toBe('filtered')
    expect(nonCanonicalRows.some((row) => row.key === EARLIER_EVIDENCE_LANE_KEY)).toBe(false)
  })

  it('does not hide request evidence when a descendant attempt is collapsed', () => {
    const record = fact(1, {
      family: 'attempt',
      name: 'provider/attempt_recorded',
      messageId: 'message-1',
      requestSeq: 4,
      physicalAttempt: 0
    })
    const attemptGroup = getFactGroupDescriptors(record, 'incarnation-1').find(
      (group) => group.kind === 'attempt'
    )

    const rows = buildTapeInspectorRows({
      tapeIncarnationId: 'incarnation-1',
      records: [record],
      evidence: [evidence('request-scoped')],
      collapsedKeys: new Set(attemptGroup ? [attemptGroup.key] : [])
    })

    expect(rows.some((row) => row.key === 'trace:request-scoped')).toBe(true)
    expect(rows.some((row) => row.recordType === 'fact')).toBe(false)
  })

  it('uses loaded authoritative bridges regardless of their canonical position', () => {
    const rows = buildTapeInspectorRows({
      tapeIncarnationId: 'incarnation-1',
      records: [
        fact(1, { messageId: 'message-1', requestSeq: 4 }),
        fact(2, { runId: 'run-1' }),
        fact(3, { runId: 'run-1', messageId: 'message-1', requestSeq: 4 })
      ],
      evidence: [],
      collapsedKeys: new Set()
    })
    const runGroup = rows.find((row) => row.recordType === 'group' && row.group.kind === 'run')
    const requestGroup = rows.find(
      (row) => row.recordType === 'group' && row.group.kind === 'request'
    )
    const firstFact = rows.find((row) => row.recordType === 'fact' && row.record.entryId === 1)

    expect(runGroup?.key).toContain('incarnation-1')
    expect(requestGroup?.key).toContain('incarnation-1')
    expect(runGroup?.depth).toBe(0)
    expect(requestGroup?.depth).toBe(1)
    expect(firstFact?.depth).toBe(2)
    expect(rows.indexOf(runGroup!)).toBeLessThan(rows.indexOf(requestGroup!))
    expect(rows.indexOf(requestGroup!)).toBeLessThan(rows.indexOf(firstFact!))
  })

  it('does not choose between conflicting run bridges', () => {
    const rows = buildTapeInspectorRows({
      tapeIncarnationId: 'incarnation-1',
      records: [
        fact(1, { messageId: 'message-1', requestSeq: 4 }),
        fact(2, { runId: 'run-1', messageId: 'message-1', requestSeq: 4 }),
        fact(3, { runId: 'run-2', messageId: 'message-1', requestSeq: 4 })
      ],
      evidence: [],
      collapsedKeys: new Set()
    })
    const requestGroup = rows.find(
      (row) => row.recordType === 'group' && row.group.kind === 'request'
    )
    const firstFact = rows.find((row) => row.recordType === 'fact' && row.record.entryId === 1)

    expect(requestGroup?.depth).toBe(0)
    expect(firstFact?.depth).toBe(1)
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
        createdAt: 200,
        facts: { toolName: 'lookup', targetServer: 'search' }
      }),
      fact(4, {
        name: 'execution/tool_outcome',
        runId: 'run-1',
        requestSeq: 1,
        providerToolCallId: 'call-1',
        createdAt: 260,
        facts: { isError: false, toolName: 'lookup', targetServer: 'search' }
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
    expect(runOne?.statusState).toBe('unresolved')
    expect(runOne?.timingState).toBe('unresolved')
    expect(runOne?.actualStartAt).toBe(100)
    expect(runOne?.actualEndAt).toBeNull()
    expect(runTwo?.durationMs).toBeNull()
    expect(runThree?.durationMs).toBeNull()
    expect(tool?.durationMs).toBe(60)
    expect(tool?.status).toBe('success')
    expect(tool?.statusState).toBe('explicit')
    expect(tool?.timingState).toBe('span')
    expect(tool?.actualStartAt).toBe(200)
    expect(tool?.actualEndAt).toBe(260)
    expect(tool?.sequenceEntryId).toBe(3)
    expect(tool?.recordType === 'group' && tool.summary).toMatchObject({
      factCount: 2,
      toolName: 'lookup',
      targetServer: 'search'
    })
    const dispatch = rows.find((row) => row.recordType === 'fact' && row.record.entryId === 3)
    const outcome = rows.find((row) => row.recordType === 'fact' && row.record.entryId === 4)
    expect(dispatch?.durationMs).toBeNull()
    expect(dispatch?.timingState).toBe('point')
    expect(dispatch?.actualStartAt).toBe(200)
    expect(dispatch?.actualEndAt).toBeNull()
    expect(dispatch?.sequenceEntryId).toBe(3)
    expect(outcome?.status).toBe('success')
    expect(outcome?.statusState).toBe('explicit')
    expect(outcome?.durationMs).toBeNull()
  })

  it('derives request and attempt status only from provider attempt facts', () => {
    const rows = buildTapeInspectorRows({
      tapeIncarnationId: 'incarnation-1',
      records: [
        fact(1, {
          name: 'provider/attempt_completed',
          family: 'attempt',
          messageId: 'message-1',
          requestSeq: 4,
          physicalAttempt: 1,
          facts: { status: 'error' }
        }),
        fact(2, {
          name: 'execution/tool_outcome',
          messageId: 'message-1',
          requestSeq: 4,
          facts: { isError: true }
        }),
        fact(3, {
          name: 'provider/attempt_completed',
          family: 'attempt',
          messageId: 'message-1',
          requestSeq: 4,
          physicalAttempt: 2,
          facts: { status: 'completed' }
        })
      ],
      evidence: [],
      collapsedKeys: new Set()
    })
    const request = rows.find((row) => row.recordType === 'group' && row.group.kind === 'request')
    const attempts = rows.filter(
      (row) => row.recordType === 'group' && row.group.kind === 'attempt'
    )

    expect(request?.status).toBe('completed')
    expect(request?.statusState).toBe('explicit')
    expect(request?.timingState).toBe('not_applicable')
    expect(attempts.map((row) => row.status)).toEqual(['error', 'completed'])
    expect(attempts.every((row) => row.timingState === 'not_applicable')).toBe(true)
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

  it('keeps diagnostic timestamps out of the overview time domain', () => {
    const rows = buildTapeInspectorRows({
      tapeIncarnationId: 'incarnation-1',
      records: [fact(1, { createdAt: 100 }), fact(2, { createdAt: 200 })],
      evidence: [evidence('diagnostic', { requestSeq: 0, createdAt: 10_000 })],
      collapsedKeys: new Set()
    })
    const lastFact = rows.find((row) => row.recordType === 'fact' && row.record.entryId === 2)

    expect(lastFact?.actualStart).toBe(1)
  })
})
