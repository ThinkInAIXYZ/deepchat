import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import { AcpContentMapper } from '@/agent/acp/runtime/acpContentMapper'
import { toAcpRemoteSessionId, toAppSessionId } from '@/agent/shared/agentSessionIds'
import {
  AcpCompatibilityProjectionAdapter,
  AcpRequestTraceAdapter
} from '@/agent/acp/compatibility/adapters'
import { SessionTranscript } from '@/session/data/transcript'
import { SessionTape } from '@/session/data/tape'
import type { MainDatabase } from '@/data/mainDatabase'

const publishDeepchatEvent = vi.fn()

interface MessageRow {
  id: string
  session_id: string
  order_seq: number
  role: 'user' | 'assistant'
  content: string
  status: 'pending' | 'sent' | 'error'
  is_context_edge: number
  metadata: string
  trace_count: number
  created_at: number
  updated_at: number
}

interface TapeRow {
  session_id: string
  entry_id: number
  kind: string
  name: string | null
  source_type: string | null
  source_id: string | null
  source_seq: number | null
  provenance_key: string | null
  payload_json: string
  meta_json: string
  created_at: number
}

function createProjectionHarness() {
  const messages = new Map<string, MessageRow>()
  const tapeRows: TapeRow[] = []
  let clock = 1
  const deepchatMessagesTable = {
    insert: vi.fn(
      (input: {
        id: string
        sessionId: string
        orderSeq: number
        role: 'user' | 'assistant'
        content: string
        status: 'pending' | 'sent' | 'error'
      }) => {
        const now = clock++
        messages.set(input.id, {
          id: input.id,
          session_id: input.sessionId,
          order_seq: input.orderSeq,
          role: input.role,
          content: input.content,
          status: input.status,
          is_context_edge: 0,
          metadata: '{}',
          trace_count: 0,
          created_at: now,
          updated_at: now
        })
      }
    ),
    get: vi.fn((id: string) => messages.get(id)),
    getBySession: vi.fn((sessionId: string) =>
      [...messages.values()].filter((message) => message.session_id === sessionId)
    ),
    getMaxOrderSeq: vi.fn((sessionId: string) =>
      Math.max(
        0,
        ...[...messages.values()]
          .filter((message) => message.session_id === sessionId)
          .map((message) => message.order_seq)
      )
    ),
    updateStatus: vi.fn((id: string, status: MessageRow['status']) => {
      const message = messages.get(id)
      if (message) Object.assign(message, { status, updated_at: clock++ })
    }),
    updateContentAndStatus: vi.fn(
      (id: string, content: string, status: MessageRow['status'], metadata?: string) => {
        const message = messages.get(id)
        if (message) {
          Object.assign(message, {
            content,
            status,
            metadata: metadata ?? message.metadata,
            updated_at: clock++
          })
        }
      }
    )
  }
  const appendTape = (input: {
    sessionId: string
    kind: string
    name?: string | null
    source?: { type: string; id: string; seq?: number }
    provenanceKey?: string | null
    payload?: unknown
    meta?: unknown
    createdAt?: number
  }) => {
    const row: TapeRow = {
      session_id: input.sessionId,
      entry_id: tapeRows.length + 1,
      kind: input.kind,
      name: input.name ?? null,
      source_type: input.source?.type ?? null,
      source_id: input.source?.id ?? null,
      source_seq: input.source?.seq ?? null,
      provenance_key: input.provenanceKey ?? null,
      payload_json: JSON.stringify(input.payload ?? {}),
      meta_json: JSON.stringify(input.meta ?? {}),
      created_at: input.createdAt ?? clock++
    }
    tapeRows.push(row)
    return row
  }
  const sqlitePresenter = {
    newSessionsTable: { get: vi.fn() },
    deepchatMessagesTable,
    deepchatSessionsTable: {
      get: vi.fn(() => ({ provider_id: 'acp', model_id: 'agent-id' })),
      getSummaryState: vi.fn(() => null)
    },
    deepchatUserMessagesTable: {
      upsert: vi.fn(),
      get: vi.fn(),
      listByMessageIds: vi.fn(() => [])
    },
    deepchatUserMessageFilesTable: {
      replaceForMessage: vi.fn(),
      listByMessageIds: vi.fn(() => [])
    },
    deepchatUserMessageLinksTable: {
      replaceForMessage: vi.fn(),
      listByMessageIds: vi.fn(() => [])
    },
    deepchatAssistantBlocksTable: {
      replaceForMessage: vi.fn(),
      listByMessageId: vi.fn(() => []),
      listByMessageIds: vi.fn(() => [])
    },
    deepchatSearchDocumentsTable: { upsert: vi.fn() },
    deepchatMessageTracesTable: {
      countByMessageId: vi.fn(() => 0),
      maxRequestSeqByMessageId: vi.fn(() => 0)
    },
    deepchatUsageStatsTable: { upsert: vi.fn() },
    deepchatTapeEntriesTable: {
      ensureBootstrapAnchor: vi.fn(),
      append: vi.fn(appendTape),
      appendEvent: vi.fn(
        (input: {
          sessionId: string
          name: string
          source?: { type: string; id: string; seq?: number }
          provenanceKey?: string | null
          data?: unknown
          meta?: unknown
          createdAt?: number
        }) =>
          appendTape({
            ...input,
            kind: 'event',
            payload: { name: input.name, data: input.data }
          })
      ),
      getLatestSummaryAnchor: vi.fn(),
      getBySession: vi.fn((sessionId: string) =>
        tapeRows.filter((row) => row.session_id === sessionId)
      )
    }
  } as unknown as MainDatabase
  const messageStore = new SessionTranscript(sqlitePresenter)
  const tapeService = new SessionTape(sqlitePresenter)
  const adapter = new AcpCompatibilityProjectionAdapter({
    publishEvent: publishDeepchatEvent,
    publishSessionUpdate: vi.fn(),
    messageStore,
    tapeService,
    writeViewManifest: vi.fn(),
    setStatus: vi.fn()
  })
  const handle = adapter.begin({
    sessionId: toAppSessionId('app-session'),
    userContent: { text: 'hello', files: [], links: [], search: false, think: false }
  })
  const getAssistantTapeRecord = () => {
    const row = tapeRows.find(
      (candidate) => candidate.kind === 'message' && candidate.source_id === handle.messageId
    )
    return row
      ? (JSON.parse(row.payload_json) as { record: { content: string; status: string } }).record
      : null
  }
  return { adapter, getAssistantTapeRecord, handle, messageStore, tapeRows, tapeService }
}

describe('ACP compatibility adapters', () => {
  beforeEach(() => {
    publishDeepchatEvent.mockClear()
  })

  it('projects protocol mapper events through the existing message/Tape writer', () => {
    const harness = createProjectionHarness()
    const mapped = new AcpContentMapper().map({
      sessionId: 'remote-session',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'from-events' }
      }
    })
    mapped.blocks[0]!.content = 'wrong-block-source'

    harness.adapter.applyEvents(harness.handle, mapped.events)
    const settlement = harness.adapter.complete(harness.handle, 'end_turn')
    const message = harness.messageStore.getMessage(harness.handle.messageId)
    const blocks = JSON.parse(message?.content ?? '[]')
    const tapeRecord = harness.getAssistantTapeRecord()

    expect(settlement).toEqual({
      status: 'completed',
      stopReason: 'complete'
    })
    expect(message?.status).toBe('sent')
    expect(blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'content', content: 'from-events', status: 'success' })
      ])
    )
    expect(JSON.stringify(blocks)).not.toContain('wrong-block-source')
    expect(tapeRecord?.status).toBe('sent')
    expect(JSON.parse(tapeRecord?.content ?? '[]')).toEqual(blocks)
    expect(publishDeepchatEvent).toHaveBeenCalledWith(
      'chat.stream.completed',
      expect.objectContaining({ messageId: harness.handle.messageId })
    )
  })

  it.each([
    ['max_tokens', 'max_tokens'],
    ['max_turn_requests', 'max_turn_requests']
  ] as const)('preserves the ACP %s stop reason through settlement', (stopReason, expected) => {
    const harness = createProjectionHarness()
    harness.adapter.applyEvents(harness.handle, [{ type: 'text', content: 'partial response' }])

    expect(harness.adapter.complete(harness.handle, stopReason)).toEqual({
      status: 'completed',
      stopReason: expected
    })
  })

  it.each([
    ['refusal', 'ACP agent refused the prompt.'],
    ['cancelled', 'ACP prompt was cancelled by the agent.']
  ] as const)('surfaces ACP %s as an explicit provider error', (stopReason, errorMessage) => {
    const harness = createProjectionHarness()

    expect(harness.adapter.complete(harness.handle, stopReason)).toEqual({
      status: 'error',
      stopReason: 'error',
      errorMessage
    })
  })

  it('persists ACP tool responses and appends a Tape tool result', () => {
    const harness = createProjectionHarness()
    const mapper = new AcpContentMapper()
    const start = mapper.map({
      sessionId: 'remote-session',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'glob',
        status: 'in_progress',
        rawInput: { pattern: '**/*' }
      }
    })
    const end = mapper.map({
      sessionId: 'remote-session',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        status: 'completed',
        rawOutput: ['README.md']
      }
    })

    harness.adapter.applyEvents(harness.handle, [...start.events, ...end.events])
    harness.adapter.complete(harness.handle, 'end_turn')

    const message = harness.messageStore.getMessage(harness.handle.messageId)
    const blocks = JSON.parse(message?.content ?? '[]')
    expect(blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_call',
          status: 'success',
          tool_call: expect.objectContaining({
            params: '{"pattern":"**/*"}',
            response: '["README.md"]'
          })
        })
      ])
    )
    expect(harness.tapeRows).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'tool_result', name: 'glob' })])
    )
  })

  it('uses the existing no-model-response error for an empty end turn', () => {
    const harness = createProjectionHarness()

    const settlement = harness.adapter.complete(harness.handle, 'end_turn')
    const message = harness.messageStore.getMessage(harness.handle.messageId)
    const blocks = JSON.parse(message?.content ?? '[]')
    const tapeRecord = harness.getAssistantTapeRecord()

    expect(settlement).toEqual({
      status: 'error',
      stopReason: 'error',
      errorMessage: 'common.error.noModelResponse'
    })
    expect(message?.status).toBe('error')
    expect(blocks).toEqual([
      expect.objectContaining({
        type: 'error',
        content: 'common.error.noModelResponse',
        status: 'error'
      })
    ])
    expect(tapeRecord?.status).toBe('error')
    expect(JSON.parse(tapeRecord?.content ?? '[]')).toEqual(blocks)
    expect(publishDeepchatEvent).toHaveBeenCalledWith(
      'chat.stream.failed',
      expect.objectContaining({
        messageId: harness.handle.messageId,
        error: 'common.error.noModelResponse'
      })
    )
  })

  it('projects prompt rejection as an ACP error event before legacy settlement', () => {
    const harness = createProjectionHarness()

    const settlement = harness.adapter.fail(harness.handle, new Error('prompt failed'))
    const message = harness.messageStore.getMessage(harness.handle.messageId)
    const blocks = JSON.parse(message?.content ?? '[]')
    const tapeRecord = harness.getAssistantTapeRecord()

    expect(settlement).toEqual({
      status: 'error',
      stopReason: 'error',
      errorMessage: 'ACP: prompt failed'
    })
    expect(message?.status).toBe('error')
    expect(blocks).toEqual([
      expect.objectContaining({ type: 'error', content: 'ACP: prompt failed', status: 'error' })
    ])
    expect(tapeRecord?.status).toBe('error')
    expect(JSON.parse(tapeRecord?.content ?? '[]')).toEqual(blocks)
    expect(publishDeepchatEvent).toHaveBeenCalledWith(
      'chat.stream.failed',
      expect.objectContaining({
        messageId: harness.handle.messageId,
        error: 'ACP: prompt failed'
      })
    )
    expect(publishDeepchatEvent).not.toHaveBeenCalledWith(
      'chat.stream.completed',
      expect.objectContaining({ messageId: harness.handle.messageId })
    )
  })

  it('keeps ACP trace opt-in, correlation, redaction, truncation, and fixed endpoint/body', () => {
    const insertMessageTrace = vi.fn()
    const adapter = new AcpRequestTraceAdapter({
      insertMessageTrace
    } as unknown as SessionTranscript)
    const prompt = [
      {
        api_key: 'super-secret',
        type: 'text',
        text: 'x'.repeat(600 * 1024)
      }
    ] as unknown as schema.ContentBlock[]
    const base = {
      sessionId: toAppSessionId('app-session'),
      messageId: 'assistant-message',
      providerId: 'acp' as const,
      modelId: 'agent-id',
      requestSeq: 2,
      remoteSessionId: toAcpRemoteSessionId('remote-session'),
      prompt
    }

    adapter.writePrompt({ ...base, enabled: false })
    expect(insertMessageTrace).not.toHaveBeenCalled()

    adapter.writePrompt({ ...base, enabled: true })
    expect(insertMessageTrace).toHaveBeenCalledTimes(1)
    const row = insertMessageTrace.mock.calls[0]![0]
    expect(row).toMatchObject({
      sessionId: 'app-session',
      messageId: 'assistant-message',
      providerId: 'acp',
      modelId: 'agent-id',
      requestSeq: 2,
      endpoint: 'acp://session/prompt',
      headersJson: '{}',
      truncated: true
    })
    expect(row.bodyJson).toContain('remote-session')
    expect(row.bodyJson).not.toContain('super-secret')
  })

  it('keeps trace persistence fail-open', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapter = new AcpRequestTraceAdapter({
      insertMessageTrace: vi.fn(() => {
        throw new Error('db unavailable')
      })
    } as unknown as SessionTranscript)

    expect(() =>
      adapter.writePrompt({
        enabled: true,
        sessionId: toAppSessionId('app-session'),
        messageId: 'assistant-message',
        providerId: 'acp',
        modelId: 'agent-id',
        requestSeq: 1,
        remoteSessionId: toAcpRemoteSessionId('remote-session'),
        prompt: [{ type: 'text', text: 'hello' }]
      })
    ).not.toThrow()
    expect(warning).toHaveBeenCalled()
    warning.mockRestore()
  })
})
