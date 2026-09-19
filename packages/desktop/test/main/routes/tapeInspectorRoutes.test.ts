import { describe, expect, it } from 'vitest'
import {
  sessionsExportTapeInspectorSupportTraceRoute,
  sessionsGetTapeInspectorRecordDetailRoute,
  sessionsListTapeInspectorEvidenceRoute,
  sessionsListTapeInspectorPageRoute,
  sessionsSubscribeTapeInspectorHeadRoute,
  sessionsUnsubscribeTapeInspectorHeadRoute
} from '@shared/contracts/routes'

describe('Tape Inspector route contracts', () => {
  it('enforces directional entry cursors and bounded page sizes', () => {
    expect(
      sessionsListTapeInspectorPageRoute.input.safeParse({
        sessionId: 'session-1',
        mode: 'tail',
        cursor: { sort: 'entryId', entryId: 10 }
      }).success
    ).toBe(false)
    expect(
      sessionsListTapeInspectorPageRoute.input.safeParse({
        sessionId: 'session-1',
        mode: 'older',
        cursor: { sort: 'entryId', entryId: 10 }
      }).success
    ).toBe(false)
    expect(
      sessionsListTapeInspectorPageRoute.input.safeParse({
        sessionId: 'session-1',
        mode: 'newer',
        cursor: { sort: 'entryId', entryId: 10 },
        limit: 201
      }).success
    ).toBe(false)
    expect(
      sessionsListTapeInspectorPageRoute.input.safeParse({
        sessionId: 'session-1',
        expectedTapeIncarnationId: 'incarnation-1',
        mode: 'newer',
        cursor: { sort: 'entryId', entryId: 10 },
        limit: 200
      }).success
    ).toBe(true)
    expect(
      sessionsListTapeInspectorPageRoute.input.safeParse({
        sessionId: 'session-1',
        expectedTapeIncarnationId: 'incarnation-1',
        mode: 'older',
        sort: { column: 'name', direction: 'desc' },
        cursor: {
          sort: 'name',
          direction: 'desc',
          nameHash: '0'.repeat(64),
          entryId: 10,
          snapshotMaxEntryId: 20
        }
      }).success
    ).toBe(true)
    expect(
      sessionsListTapeInspectorPageRoute.input.safeParse({
        sessionId: 'session-1',
        expectedTapeIncarnationId: 'incarnation-1',
        mode: 'older',
        sort: { column: 'createdAt', direction: 'asc' },
        cursor: { sort: 'createdAt', createdAt: 100, entryId: 10 }
      }).success
    ).toBe(false)
  })

  it('projects evidence metadata without request payload fields', () => {
    expect(
      sessionsListTapeInspectorEvidenceRoute.input.safeParse({ sessionId: 'session-1' }).success
    ).toBe(false)
    expect(
      sessionsListTapeInspectorEvidenceRoute.input.safeParse({
        sessionId: 'session-1',
        mode: 'newer',
        cursor: { createdAt: 100, traceId: 'trace-1' }
      }).success
    ).toBe(false)
    expect(
      sessionsListTapeInspectorEvidenceRoute.input.safeParse({
        sessionId: 'session-1',
        mode: 'newer',
        cursor: { rowId: 10 }
      }).success
    ).toBe(true)
    expect(
      sessionsListTapeInspectorEvidenceRoute.input.safeParse({
        sessionId: 'session-1',
        mode: 'older',
        requestSeq: 0
      }).success
    ).toBe(false)
    const parsed = sessionsListTapeInspectorEvidenceRoute.output.parse({
      records: [
        {
          recordType: 'evidence',
          key: 'trace:trace-1',
          traceId: 'trace-1',
          messageId: 'message-1',
          requestSeq: 0,
          providerId: 'provider-1',
          modelId: 'model-1',
          createdAt: 100,
          truncated: false,
          endpoint: 'https://example.invalid',
          headersJson: '{"authorization":"secret"}',
          bodyJson: '{"prompt":"secret"}'
        }
      ],
      nextCursor: null,
      newerCursor: { rowId: 10 }
    })
    expect(
      sessionsListTapeInspectorEvidenceRoute.output.safeParse({
        records: [
          {
            recordType: 'evidence',
            key: 'trace:invalid',
            traceId: 'invalid',
            messageId: 'message-1',
            requestSeq: -1,
            providerId: 'provider-1',
            modelId: 'model-1',
            createdAt: 100,
            truncated: false
          }
        ],
        nextCursor: null,
        newerCursor: null
      }).success
    ).toBe(false)

    expect(parsed.records[0]).toEqual({
      recordType: 'evidence',
      key: 'trace:trace-1',
      traceId: 'trace-1',
      messageId: 'message-1',
      requestSeq: 0,
      providerId: 'provider-1',
      modelId: 'model-1',
      createdAt: 100,
      truncated: false
    })
  })

  it('requires incarnation validation for record details', () => {
    expect(
      sessionsGetTapeInspectorRecordDetailRoute.input.safeParse({
        sessionId: 'session-1',
        entryId: 1
      }).success
    ).toBe(false)
    expect(
      sessionsGetTapeInspectorRecordDetailRoute.input.safeParse({
        sessionId: 'session-1',
        expectedTapeIncarnationId: 'incarnation-1',
        entryId: 1
      }).success
    ).toBe(true)
  })

  it('bounds support exports and strips opaque evidence payload fields', () => {
    const detail = {
      record: {
        recordType: 'fact' as const,
        key: 'entry:1' as const,
        entryId: 1,
        kind: 'event' as const,
        family: 'other' as const,
        name: 'future/event',
        createdAt: 100,
        hashes: { payloadHash: 'a'.repeat(64), metaHash: 'b'.repeat(64) }
      },
      disclosure: 'metadata_only' as const,
      provenance: {},
      hashes: { payloadHash: 'a'.repeat(64), metaHash: 'b'.repeat(64) },
      sizes: { payloadBytes: 2, metaBytes: 2 }
    }
    const evidence = {
      recordType: 'evidence' as const,
      key: 'trace:trace-1' as const,
      traceId: 'trace-1',
      messageId: 'message-1',
      requestSeq: 1,
      providerId: 'provider-1',
      modelId: 'model-1',
      createdAt: 100,
      truncated: false,
      headersJson: '{"authorization":"private"}',
      bodyJson: '{"prompt":"private"}'
    }
    const parsed = sessionsExportTapeInspectorSupportTraceRoute.output.parse({
      status: 'ok',
      trace: {
        schemaVersion: 1,
        exportedAt: 200,
        sessionId: 'session-1',
        tapeIncarnationId: 'incarnation-1',
        snapshotMaxEntryId: 1,
        facts: [detail],
        evidence: [evidence],
        truncated: { facts: false, evidence: false, detailData: false }
      }
    })

    expect(parsed.status === 'ok' ? parsed.trace.evidence[0] : null).toEqual({
      recordType: 'evidence',
      key: 'trace:trace-1',
      traceId: 'trace-1',
      messageId: 'message-1',
      requestSeq: 1,
      providerId: 'provider-1',
      modelId: 'model-1',
      createdAt: 100,
      truncated: false
    })
    expect(
      sessionsExportTapeInspectorSupportTraceRoute.input.safeParse({
        sessionId: 'session-1'
      }).success
    ).toBe(false)
    expect(
      sessionsExportTapeInspectorSupportTraceRoute.output.safeParse({
        status: 'ok',
        trace: {
          schemaVersion: 1,
          exportedAt: 200,
          sessionId: 'session-1',
          tapeIncarnationId: 'incarnation-1',
          snapshotMaxEntryId: 1,
          facts: Array.from({ length: 201 }, () => detail),
          evidence: [],
          truncated: { facts: true, evidence: false, detailData: false }
        }
      }).success
    ).toBe(false)
  })

  it('bounds opaque live subscription ids and projects committed heads', () => {
    expect(
      sessionsSubscribeTapeInspectorHeadRoute.input.safeParse({
        sessionId: 'session-1',
        subscriptionId: ''
      }).success
    ).toBe(false)
    expect(
      sessionsUnsubscribeTapeInspectorHeadRoute.input.safeParse({
        subscriptionId: 'x'.repeat(129)
      }).success
    ).toBe(false)
    expect(
      sessionsSubscribeTapeInspectorHeadRoute.output.parse({
        subscribed: true,
        tapeIncarnationId: 'incarnation-1',
        maxEntryId: 20,
        payload: 'must not cross the boundary'
      })
    ).toEqual({
      subscribed: true,
      tapeIncarnationId: 'incarnation-1',
      maxEntryId: 20
    })
  })
})
