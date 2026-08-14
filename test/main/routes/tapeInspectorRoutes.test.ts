import { describe, expect, it } from 'vitest'
import {
  sessionsGetTapeInspectorRecordDetailRoute,
  sessionsListTapeInspectorEvidenceRoute,
  sessionsListTapeInspectorPageRoute
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
  })

  it('projects evidence metadata without request payload fields', () => {
    const parsed = sessionsListTapeInspectorEvidenceRoute.output.parse({
      records: [
        {
          recordType: 'evidence',
          key: 'trace:trace-1',
          traceId: 'trace-1',
          messageId: 'message-1',
          requestSeq: 1,
          providerId: 'provider-1',
          modelId: 'model-1',
          createdAt: 100,
          truncated: false,
          endpoint: 'https://example.invalid',
          headersJson: '{"authorization":"secret"}',
          bodyJson: '{"prompt":"secret"}'
        }
      ],
      nextCursor: null
    })

    expect(parsed.records[0]).toEqual({
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
})
