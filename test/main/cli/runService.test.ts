import { describe, expect, it, vi } from 'vitest'
import {
  RUN_MESSAGE_MAX_TEXT_BYTES,
  RUN_PROMPT_MAX_CHARACTERS,
  PublicRunMessageSchema,
  eventsSubscribeRoute,
  runsCancelRoute,
  runsGetRoute,
  sessionsRunDetachedRoute
} from '@shared/contracts/routes'
import type {
  ChatMessageRecord,
  SessionRecord,
  SessionWithState
} from '@shared/types/agent-interface'
import { DEFAULT_ORCHESTRATION_POLICY } from '@shared/orchestration/policy'
import { LOCAL_CONTROL_MAX_JSON_RESPONSE_BYTES } from '@shared/contracts/localControl'
import { CliRunService, type CliRunServiceOptions } from '@/cli/runService'
import { CliRequestError } from '@/cli/errors'
import { TypedEventHub, type TypedEventRecord } from '@/events/typedEventHub'
import type { CliRouteCaller, RouteContext } from '@/routes/routeRegistry'

const humanCaller: CliRouteCaller = {
  kind: 'cli',
  principal: 'human',
  connectionId: 'connection-1',
  scopes: ['sessions:run', 'runs:read', 'runs:cancel']
}

const agentCaller: CliRouteCaller = {
  kind: 'cli',
  principal: 'agent',
  connectionId: 'connection-agent',
  tokenId: 'token-id-run-1',
  conversationId: 'run-1',
  expiresAt: 10_000,
  scopes: ['runs:read', 'runs:cancel']
}

const baseSession: SessionWithState = {
  id: 'run-1',
  agentId: 'deepchat',
  title: 'CLI Run',
  projectDir: null,
  isPinned: false,
  isDraft: false,
  sessionKind: 'regular',
  parentSessionId: null,
  subagentMeta: null,
  orchestrationPolicy: DEFAULT_ORCHESTRATION_POLICY,
  createdAt: 100,
  updatedAt: 101,
  metadata: { source: 'cli_run' },
  status: 'generating',
  providerId: 'provider-1',
  modelId: 'model-1'
}

function createMessage(overrides: Partial<ChatMessageRecord>): ChatMessageRecord {
  return {
    id: 'message-1',
    sessionId: 'run-1',
    orderSeq: 1,
    role: 'user',
    content: JSON.stringify({ text: 'hello', files: [] }),
    status: 'sent',
    isContextEdge: 0,
    metadata: JSON.stringify({ provider: 'private-provider-detail' }),
    createdAt: 100,
    updatedAt: 101,
    ...overrides
  }
}

function createInteractionMessage(
  actionType: 'tool_call_permission' | 'question_request',
  needsUserAction: boolean | undefined = true
): ChatMessageRecord {
  return createMessage({
    id: `message-${actionType}`,
    orderSeq: 2,
    role: 'assistant',
    status: 'pending',
    content: JSON.stringify([
      {
        type: 'action',
        action_type: actionType,
        status: 'pending',
        timestamp: 100,
        tool_call: { id: `tool-${actionType}`, name: 'test_tool', params: '{}' },
        extra: needsUserAction === undefined ? {} : { needsUserAction }
      }
    ])
  })
}

function createSubagentInteractionMessage(
  type: 'permission' | 'question',
  waiting = true,
  progress?: string
): ChatMessageRecord {
  return createMessage({
    id: `message-subagent-${type}`,
    orderSeq: 2,
    role: 'assistant',
    status: 'pending',
    content: JSON.stringify([
      {
        type: 'tool_call',
        status: 'loading',
        timestamp: 100,
        tool_call: { id: 'subagent-orchestrator', name: 'subagent_orchestrator', params: '{}' },
        extra: {
          subagentProgress:
            progress ??
            JSON.stringify({
              tasks: [
                {
                  sessionId: 'child-session',
                  waitingInteraction: waiting
                    ? {
                        type,
                        messageId: 'child-message',
                        toolCallId: 'child-tool',
                        actionBlock: {
                          type: 'action',
                          status: 'pending',
                          action_type:
                            type === 'question' ? 'question_request' : 'tool_call_permission'
                        }
                      }
                    : null
                }
              ]
            })
        }
      }
    ])
  })
}

function createHarness(
  overrides: {
    session?: SessionWithState
    storedSession?: SessionRecord | null
    messages?: ChatMessageRecord[]
    hasWaitingDescendantInteraction?: boolean
  } = {}
): {
  service: CliRunService
  hub: TypedEventHub
  lifecycle: CliRunServiceOptions['lifecycle']
  turn: CliRunServiceOptions['turn']
  projection: CliRunServiceOptions['projection']
  sessions: CliRunServiceOptions['sessions']
  getPendingAssistantMessages: ReturnType<typeof vi.fn>
  log: { warn: ReturnType<typeof vi.fn> }
} {
  const session = overrides.session ?? baseSession
  const lifecycle = {
    createDetachedSession: vi.fn(async () => ({ ...session, status: 'idle' as const }))
  }
  const turn = {
    sendMessage: vi.fn(async () => ({ requestId: 'request-1', messageId: 'message-2' })),
    cancelGeneration: vi.fn(async () => undefined)
  }
  const projection = {
    getSession: vi.fn(async () => session),
    listMessagesPage: vi.fn(async () => ({
      messages: overrides.messages ?? [],
      nextCursor: null,
      hasMore: false
    }))
  }
  const getPendingAssistantMessages = vi.fn(() =>
    (overrides.messages ?? []).filter(
      (message) => message.role === 'assistant' && message.status === 'pending'
    )
  )
  const sessions = {
    get: vi.fn(() =>
      overrides.storedSession === undefined ? (session as SessionRecord) : overrides.storedSession
    )
  }
  const log = { warn: vi.fn() }
  const hub = new TypedEventHub({
    renderer: { broadcast: vi.fn(), send: vi.fn() },
    epoch: 'test-epoch',
    now: () => 200
  })
  return {
    service: new CliRunService({
      lifecycle,
      turn,
      projection,
      sessions,
      getPendingAssistantMessages,
      hasWaitingDescendantInteraction: vi.fn(
        () => overrides.hasWaitingDescendantInteraction ?? false
      ),
      eventHub: hub,
      now: () => 200,
      log
    }),
    hub,
    lifecycle,
    turn,
    projection,
    sessions,
    getPendingAssistantMessages,
    log
  }
}

async function invokeRoute(
  service: CliRunService,
  method: string,
  input: unknown,
  caller: RouteContext['caller'] = humanCaller
): Promise<unknown> {
  const route = service.createRoutes().get(method as never)
  if (!route) throw new Error(`Missing route: ${method}`)
  return await route(input, { caller })
}

async function nextEvent(events: AsyncIterable<TypedEventRecord>): Promise<TypedEventRecord> {
  const result = await events[Symbol.asyncIterator]().next()
  if (result.done) throw new Error('Expected an event')
  return result.value
}

async function startRunWatcher(service: CliRunService): Promise<{
  emitted: string[]
  result: Promise<unknown>
}> {
  const emitted: string[] = []
  let snapshotEmitted!: () => void
  const snapshotReady = new Promise<void>((resolve) => {
    snapshotEmitted = resolve
  })
  const result = service.dispatchStream(
    eventsSubscribeRoute.name,
    { runId: 'run-1' },
    humanCaller,
    new AbortController().signal,
    async (event) => {
      emitted.push(event)
      if (event === 'runs.snapshot') snapshotEmitted()
    }
  )
  await snapshotReady
  return { emitted, result }
}

async function expectWatcherPending(result: Promise<unknown>): Promise<void> {
  const outcome = await Promise.race([
    result.then(
      () => 'settled' as const,
      () => 'settled' as const
    ),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 10))
  ])
  expect(outcome).toBe('pending')
}

describe('CliRunService', () => {
  it('creates a durable default-permission session before starting its initial turn', async () => {
    const { service, hub, lifecycle, turn } = createHarness()
    const events = hub.subscribe({ kind: 'run', runId: 'run-1' })

    await expect(
      invokeRoute(service, sessionsRunDetachedRoute.name, {
        prompt: 'Run the benchmark',
        providerId: 'provider-1',
        modelId: 'model-1',
        systemPrompt: 'Be concise',
        maxTurns: 4
      })
    ).resolves.toEqual({
      runId: 'run-1',
      sessionId: 'run-1',
      status: 'generating',
      requestId: 'request-1',
      messageId: 'message-2',
      createdAt: 100
    })

    expect(lifecycle.createDetachedSession).toHaveBeenCalledWith({
      title: 'CLI Run',
      providerId: 'provider-1',
      modelId: 'model-1',
      permissionMode: 'default',
      generationSettings: { systemPrompt: 'Be concise' },
      metadata: { source: 'cli_run' }
    })
    expect(turn.sendMessage).toHaveBeenCalledWith('run-1', 'Run the benchmark', {
      maxProviderRounds: 4
    })
    await expect(nextEvent(events.events)).resolves.toMatchObject({ event: 'runs.created' })
    await expect(nextEvent(events.events)).resolves.toMatchObject({ event: 'runs.turn.accepted' })
  })

  it('keeps detached creation human-only even if an Agent reaches the handler', async () => {
    const { service, lifecycle } = createHarness()

    await expect(
      invokeRoute(service, sessionsRunDetachedRoute.name, { prompt: 'recurse' }, agentCaller)
    ).rejects.toMatchObject({ code: 'permission_denied' })
    expect(lifecycle.createDetachedSession).not.toHaveBeenCalled()
  })

  it('rejects oversized prompts before creating a durable session', async () => {
    const { service, lifecycle } = createHarness()

    await expect(
      invokeRoute(service, sessionsRunDetachedRoute.name, {
        prompt: 'x'.repeat(RUN_PROMPT_MAX_CHARACTERS + 1)
      })
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'too_big', path: ['prompt'] })
      ])
    })
    expect(lifecycle.createDetachedSession).not.toHaveBeenCalled()
  })

  it('returns the durable run identity when initial turn startup fails', async () => {
    const { service, turn, hub, log } = createHarness()
    const events = hub.subscribe({ kind: 'run', runId: 'run-1' })
    const privateFailure = 'EACCES /Users/private/provider.json?token=secret'
    vi.mocked(turn.sendMessage).mockRejectedValueOnce(new Error(privateFailure))

    const failure = await invokeRoute(service, sessionsRunDetachedRoute.name, {
      prompt: 'hello'
    }).catch((error: unknown) => error)
    expect(failure).toMatchObject({
      code: 'conflict',
      message: 'Detached Agent run could not start',
      options: { details: { runId: 'run-1', sessionId: 'run-1' } }
    })
    await expect(nextEvent(events.events)).resolves.toMatchObject({ event: 'runs.created' })
    await expect(nextEvent(events.events)).resolves.toMatchObject({
      event: 'runs.turn.failed',
      data: { error: 'Detached Agent run could not start' }
    })
    expect(JSON.stringify(failure)).not.toContain(privateFailure)
    expect(log.warn).toHaveBeenCalledWith('[CLI] Failed to start detached Agent run', {
      runId: 'run-1',
      failure: { name: 'Error' }
    })
  })

  it('returns bounded public message text without internal message metadata', async () => {
    const oversized = '🙂'.repeat(RUN_MESSAGE_MAX_TEXT_BYTES)
    const { service } = createHarness({
      messages: [
        createMessage({}),
        createMessage({
          id: 'message-2',
          orderSeq: 2,
          role: 'assistant',
          content: JSON.stringify([
            { type: 'content', status: 'success', timestamp: 1, content: oversized }
          ])
        })
      ]
    })

    const result = runsGetRoute.output.parse(
      await invokeRoute(service, runsGetRoute.name, { runId: 'run-1' })
    )

    expect(result.messages[0]).toMatchObject({ role: 'user', text: 'hello' })
    expect(result.messages[1].textTruncated).toBe(true)
    expect(result.phase).toBe('running')
    expect(Buffer.byteLength(result.messages[1].text, 'utf8')).toBeLessThanOrEqual(
      RUN_MESSAGE_MAX_TEXT_BYTES
    )
    expect(JSON.stringify(result)).not.toContain('private-provider-detail')
  })

  it.each([
    ['permission', 'tool_call_permission', true, 'awaiting_interaction'],
    ['question', 'question_request', true, 'awaiting_interaction'],
    ['recovered question', 'question_request', undefined, 'awaiting_interaction'],
    ['resolved permission', 'tool_call_permission', false, 'running'],
    ['resolved question', 'question_request', false, 'running']
  ] as const)(
    'projects a %s with the correct phase',
    async (_kind, actionType, needsAction, phase) => {
      const { service } = createHarness({
        messages: [createInteractionMessage(actionType, needsAction)]
      })

      await expect(
        invokeRoute(service, runsGetRoute.name, { runId: 'run-1' })
      ).resolves.toMatchObject({
        phase,
        status: 'generating'
      })
    }
  )

  it.each([
    ['permission', true, 'awaiting_interaction'],
    ['question', true, 'awaiting_interaction'],
    ['cleared interaction', false, 'running']
  ] as const)(
    'projects a legacy subagent %s with the correct phase',
    async (_kind, waiting, phase) => {
      const type = _kind === 'question' ? 'question' : 'permission'
      const { service } = createHarness({
        messages: [createSubagentInteractionMessage(type, waiting)]
      })

      await expect(
        invokeRoute(service, runsGetRoute.name, { runId: 'run-1' })
      ).resolves.toMatchObject({ phase })
    }
  )

  it('projects a current live-delegation wait as awaiting_interaction', async () => {
    const { service } = createHarness({ hasWaitingDescendantInteraction: true })

    await expect(
      invokeRoute(service, runsGetRoute.name, { runId: 'run-1' })
    ).resolves.toMatchObject({ phase: 'awaiting_interaction' })
  })

  it('ignores malformed subagent progress when projecting phase', async () => {
    const { service } = createHarness({
      messages: [createSubagentInteractionMessage('permission', true, '{')]
    })

    await expect(
      invokeRoute(service, runsGetRoute.name, { runId: 'run-1' })
    ).resolves.toMatchObject({ phase: 'running' })
  })

  it.each([
    ['direct question', createInteractionMessage('question_request')],
    ['legacy subagent wait', createSubagentInteractionMessage('permission')]
  ])('derives phase from a pending %s outside an older transcript page', async (_kind, message) => {
    const { service, projection, getPendingAssistantMessages } = createHarness()
    vi.mocked(projection.listMessagesPage).mockResolvedValueOnce({
      messages: [createMessage({})],
      nextCursor: null,
      hasMore: false
    })
    getPendingAssistantMessages.mockReturnValueOnce([message])

    await expect(
      invokeRoute(service, runsGetRoute.name, {
        runId: 'run-1',
        cursor: { orderSeq: 2, id: 'message-2' }
      })
    ).resolves.toMatchObject({ phase: 'awaiting_interaction' })
    expect(getPendingAssistantMessages).toHaveBeenCalledWith('run-1')
  })

  it('derives phase independently of a limited transcript page', async () => {
    const { service, projection, getPendingAssistantMessages } = createHarness()
    vi.mocked(projection.listMessagesPage).mockResolvedValueOnce({
      messages: [createMessage({})],
      nextCursor: { orderSeq: 1, id: 'message-1' },
      hasMore: true
    })
    getPendingAssistantMessages.mockReturnValueOnce([
      createInteractionMessage('tool_call_permission')
    ])

    await expect(
      invokeRoute(service, runsGetRoute.name, { runId: 'run-1', limit: 1 })
    ).resolves.toMatchObject({ phase: 'awaiting_interaction' })
    expect(getPendingAssistantMessages).toHaveBeenCalledWith('run-1')
  })

  it('returns only the final assistant answer without exposing process blocks', async () => {
    const { service } = createHarness({
      messages: [
        createMessage({
          role: 'assistant',
          content: JSON.stringify([
            {
              type: 'reasoning_content',
              status: 'success',
              timestamp: 1,
              content: 'private reasoning'
            },
            {
              type: 'content',
              status: 'success',
              timestamp: 2,
              content: 'I will inspect the file first.'
            },
            {
              type: 'tool_call',
              status: 'success',
              timestamp: 3,
              tool_call: {
                id: 'tool-1',
                name: 'read_file',
                params: '{"path":"/private/input.txt"}',
                response: 'private tool response'
              },
              extra: { toolCallArgsComplete: true }
            },
            {
              type: 'tool_call',
              status: 'error',
              timestamp: 4,
              tool_call: {
                id: 'tool-2',
                name: 'exec',
                params: '{"command":"inspect"}',
                response: 'private tool error'
              },
              extra: { toolCallArgsComplete: true }
            },
            {
              type: 'action',
              action_type: 'tool_call_permission',
              status: 'denied',
              timestamp: 5,
              content: 'private permission copy'
            },
            {
              type: 'error',
              status: 'error',
              timestamp: 6,
              content: 'private internal error'
            },
            {
              type: 'content',
              status: 'success',
              timestamp: 7,
              content: 'Final answer'
            }
          ])
        })
      ]
    })

    const result = runsGetRoute.output.parse(
      await invokeRoute(service, runsGetRoute.name, { runId: 'run-1' })
    )

    expect(result.messages[0]).toMatchObject({
      role: 'assistant',
      text: 'Final answer',
      textTruncated: false
    })
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it('keeps non-final assistant text empty while preserving statuses', async () => {
    const failedSession = { ...baseSession, status: 'error' as const }
    const { service } = createHarness({
      session: failedSession,
      messages: [
        createMessage({
          role: 'assistant',
          status: 'pending',
          content: JSON.stringify([
            {
              type: 'content',
              status: 'pending',
              timestamp: 1,
              content: 'private partial answer'
            },
            {
              type: 'action',
              action_type: 'question_request',
              status: 'pending',
              timestamp: 2,
              content: 'private pending question'
            }
          ])
        }),
        createMessage({
          id: 'message-2',
          orderSeq: 2,
          role: 'assistant',
          status: 'error',
          content: JSON.stringify([
            {
              type: 'content',
              status: 'success',
              timestamp: 1,
              content: 'private partial answer'
            },
            {
              type: 'error',
              status: 'error',
              timestamp: 2,
              content: 'private failure detail'
            }
          ])
        }),
        createMessage({
          id: 'message-3',
          orderSeq: 3,
          role: 'assistant',
          content: JSON.stringify([
            {
              type: 'content',
              status: 'pending',
              timestamp: 1,
              content: 'private pending content in sent message'
            }
          ])
        }),
        createMessage({
          id: 'message-4',
          orderSeq: 4,
          role: 'assistant',
          content: JSON.stringify([
            {
              type: 'content',
              status: 'error',
              timestamp: 1,
              content: 'private errored content in sent message'
            }
          ])
        })
      ]
    })

    const result = runsGetRoute.output.parse(
      await invokeRoute(service, runsGetRoute.name, { runId: 'run-1' })
    )

    expect(result.status).toBe('error')
    expect(result.messages).toEqual([
      expect.objectContaining({ role: 'assistant', status: 'pending', text: '' }),
      expect.objectContaining({ role: 'assistant', status: 'error', text: '' }),
      expect.objectContaining({ role: 'assistant', status: 'sent', text: '' }),
      expect.objectContaining({ role: 'assistant', status: 'sent', text: '' })
    ])
  })

  it('fails closed for malformed sent assistant payloads', async () => {
    const { service } = createHarness({
      messages: [
        createMessage({
          role: 'assistant',
          content: JSON.stringify([{ type: 'content', content: 'private malformed block content' }])
        }),
        createMessage({
          id: 'message-2',
          orderSeq: 2,
          role: 'assistant',
          content: JSON.stringify({ content: 'private non-array content' })
        }),
        createMessage({
          id: 'message-3',
          orderSeq: 3,
          role: 'assistant',
          content: '{'
        })
      ]
    })

    const result = runsGetRoute.output.parse(
      await invokeRoute(service, runsGetRoute.name, { runId: 'run-1' })
    )

    expect(result.messages).toEqual([
      expect.objectContaining({ role: 'assistant', status: 'sent', text: '' }),
      expect.objectContaining({ role: 'assistant', status: 'sent', text: '' }),
      expect.objectContaining({ role: 'assistant', status: 'sent', text: '' })
    ])
  })

  it('enforces the public message limit in UTF-8 bytes', () => {
    const message = {
      id: 'message-1',
      role: 'assistant' as const,
      status: 'sent' as const,
      textTruncated: false,
      createdAt: 100,
      updatedAt: 101
    }

    expect(
      PublicRunMessageSchema.safeParse({
        ...message,
        text: 'x'.repeat(RUN_MESSAGE_MAX_TEXT_BYTES)
      }).success
    ).toBe(true)
    expect(
      PublicRunMessageSchema.safeParse({
        ...message,
        text: '🙂'.repeat(RUN_MESSAGE_MAX_TEXT_BYTES / 4 + 1)
      }).success
    ).toBe(false)
  })

  it('keeps escaped transcript pages within the local response byte limit', async () => {
    const messages = Array.from({ length: 16 }, (_, index) =>
      createMessage({
        id: `message-${index + 1}`,
        orderSeq: index + 1,
        role: 'assistant',
        content: JSON.stringify([
          {
            type: 'content',
            status: 'success',
            timestamp: index + 1,
            content: '\0'.repeat(RUN_MESSAGE_MAX_TEXT_BYTES)
          }
        ])
      })
    )
    const { service } = createHarness({ messages })

    const result = runsGetRoute.output.parse(
      await invokeRoute(service, runsGetRoute.name, { runId: 'run-1', limit: messages.length })
    )

    expect(result.messages.length).toBeLessThan(messages.length)
    expect(result.hasMore).toBe(true)
    const firstIncluded = messages.find((message) => message.id === result.messages[0]?.id)
    expect(result.nextCursor).toEqual({
      orderSeq: firstIncluded?.orderSeq,
      id: firstIncluded?.id
    })
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThan(
      LOCAL_CONTROL_MAX_JSON_RESPONSE_BYTES
    )
  })

  it('hides non-CLI sessions from a human while allowing an Agent to inspect its own session', async () => {
    const normalSession = { ...baseSession, metadata: undefined }
    const { service } = createHarness({ session: normalSession, storedSession: normalSession })

    await expect(invokeRoute(service, runsGetRoute.name, { runId: 'run-1' })).rejects.toMatchObject(
      { code: 'not_found', httpStatus: 404 }
    )
    await expect(
      invokeRoute(service, runsGetRoute.name, { runId: 'run-1' }, agentCaller)
    ).resolves.toMatchObject({ runId: 'run-1' })
  })

  it('fails closed instead of waiting on a normal session with no run event stream', async () => {
    const normalSession = { ...baseSession, metadata: undefined }
    const { service } = createHarness({ session: normalSession, storedSession: normalSession })

    await expect(
      service.dispatchStream(
        eventsSubscribeRoute.name,
        { runId: 'run-1' },
        agentCaller,
        new AbortController().signal,
        vi.fn()
      )
    ).rejects.toMatchObject({ code: 'not_found', httpStatus: 404 })
  })

  it('makes cancellation idempotent and only emits for an active run', async () => {
    const idleSession = { ...baseSession, status: 'idle' as const }
    const { service, hub, projection, turn } = createHarness()
    vi.mocked(projection.getSession)
      .mockResolvedValueOnce(baseSession)
      .mockResolvedValueOnce(idleSession)
      .mockResolvedValue(idleSession)
    const events = hub.subscribe({ kind: 'run', runId: 'run-1' })

    await expect(invokeRoute(service, runsCancelRoute.name, { runId: 'run-1' })).resolves.toEqual({
      runId: 'run-1',
      cancelRequested: true,
      status: 'idle'
    })
    await expect(invokeRoute(service, runsCancelRoute.name, { runId: 'run-1' })).resolves.toEqual({
      runId: 'run-1',
      cancelRequested: false,
      status: 'idle'
    })
    expect(turn.cancelGeneration).toHaveBeenCalledTimes(1)
    await expect(nextEvent(events.events)).resolves.toMatchObject({
      event: 'runs.cancel.requested'
    })
  })

  it('keeps watching after a provider round and terminates on the root Session status', async () => {
    const { service, hub } = createHarness({
      messages: [createInteractionMessage('tool_call_permission')]
    })
    const emitted: Array<{ event: string; data: unknown; context: unknown }> = []
    let snapshotEmitted!: () => void
    const snapshotReady = new Promise<void>((resolve) => {
      snapshotEmitted = resolve
    })
    const controller = new AbortController()
    const result = service.dispatchStream(
      eventsSubscribeRoute.name,
      { runId: 'run-1' },
      humanCaller,
      controller.signal,
      async (event, data, context) => {
        emitted.push({ event, data, context })
        if (event === 'runs.snapshot') snapshotEmitted()
      }
    )
    await snapshotReady

    hub.publish(
      'chat.stream.completed',
      {
        requestId: 'request-1',
        sessionId: 'run-1',
        messageId: 'message-2',
        completedAt: 300
      },
      { kind: 'run', runId: 'run-1' }
    )
    await vi.waitFor(() =>
      expect(emitted.map((entry) => entry.event)).toContain('chat.stream.completed')
    )
    await expectWatcherPending(result)

    hub.publish(
      'sessions.status.changed',
      { sessionId: 'run-1', status: 'idle', version: 301 },
      { kind: 'run', runId: 'run-1' }
    )

    await expect(result).resolves.toEqual({ runId: 'run-1', lastCursor: 'test-epoch_1:2' })
    expect(emitted.map((entry) => entry.event)).toEqual([
      'runs.snapshot',
      'chat.stream.completed',
      'sessions.status.changed'
    ])
    expect(emitted[0].data).toMatchObject({
      run: { phase: 'awaiting_interaction' }
    })
    expect(emitted[0].context).toEqual({ runId: 'run-1', cursor: 'test-epoch_1:0' })
  })

  it('keeps watching after a provider failure until the root Session enters error', async () => {
    const { service, hub } = createHarness()
    const { emitted, result } = await startRunWatcher(service)

    hub.publish(
      'chat.stream.failed',
      {
        requestId: 'request-1',
        sessionId: 'run-1',
        messageId: 'message-2',
        failedAt: 300,
        error: 'provider round failed'
      },
      { kind: 'run', runId: 'run-1' }
    )
    await vi.waitFor(() => expect(emitted).toContain('chat.stream.failed'))
    await expectWatcherPending(result)

    hub.publish(
      'sessions.status.changed',
      { sessionId: 'run-1', status: 'error', version: 301 },
      { kind: 'run', runId: 'run-1' }
    )

    await expect(result).resolves.toEqual({ runId: 'run-1', lastCursor: 'test-epoch_1:2' })
    expect(emitted).toEqual(['runs.snapshot', 'chat.stream.failed', 'sessions.status.changed'])
  })

  it('keeps watching after replaying a provider terminal event from a cursor', async () => {
    const { service, hub } = createHarness()
    hub.publish(
      'chat.stream.completed',
      {
        requestId: 'request-1',
        sessionId: 'run-1',
        messageId: 'message-2',
        completedAt: 300
      },
      { kind: 'run', runId: 'run-1' }
    )
    const emitted: string[] = []
    const controller = new AbortController()
    const result = service.dispatchStream(
      eventsSubscribeRoute.name,
      { runId: 'run-1', cursor: 'test-epoch_1:0' },
      humanCaller,
      controller.signal,
      async (event) => {
        emitted.push(event)
      }
    )

    await vi.waitFor(() => expect(emitted).toEqual(['chat.stream.completed']))
    await expectWatcherPending(result)

    hub.publish(
      'sessions.status.changed',
      { sessionId: 'run-1', status: 'idle', version: 301 },
      { kind: 'run', runId: 'run-1' }
    )

    await expect(result).resolves.toEqual({ runId: 'run-1', lastCursor: 'test-epoch_1:2' })
    expect(emitted).toEqual(['chat.stream.completed', 'sessions.status.changed'])
  })

  it('finishes when cursor catch-up includes an already-terminal root Session', async () => {
    const idleSession = { ...baseSession, status: 'idle' as const }
    const { service, hub } = createHarness({ session: idleSession })
    hub.publish(
      'chat.stream.completed',
      {
        requestId: 'request-1',
        sessionId: 'run-1',
        messageId: 'message-2',
        completedAt: 300
      },
      { kind: 'run', runId: 'run-1' }
    )
    hub.publish(
      'sessions.status.changed',
      { sessionId: 'run-1', status: 'idle', version: 301 },
      { kind: 'run', runId: 'run-1' }
    )
    const emitted: string[] = []

    await expect(
      service.dispatchStream(
        eventsSubscribeRoute.name,
        { runId: 'run-1', cursor: 'test-epoch_1:0' },
        humanCaller,
        new AbortController().signal,
        async (event) => {
          emitted.push(event)
        }
      )
    ).resolves.toEqual({ runId: 'run-1', lastCursor: 'test-epoch_1:2' })
    expect(emitted).toEqual(['chat.stream.completed', 'sessions.status.changed'])
  })

  it('terminates a watcher when detached initial-turn startup fails', async () => {
    const { service, hub } = createHarness()
    const { emitted, result } = await startRunWatcher(service)

    hub.publish(
      'runs.turn.failed',
      {
        runId: 'run-1',
        sessionId: 'run-1',
        failedAt: 300,
        error: 'Detached Agent run could not start'
      },
      { kind: 'run', runId: 'run-1' }
    )

    await expect(result).resolves.toEqual({ runId: 'run-1', lastCursor: 'test-epoch_1:1' })
    expect(emitted).toEqual(['runs.snapshot', 'runs.turn.failed'])
  })

  it('does not terminate a root run watcher when a descendant Session becomes terminal', async () => {
    const { service, hub } = createHarness()
    const { emitted, result } = await startRunWatcher(service)

    hub.publish(
      'sessions.status.changed',
      { sessionId: 'child-session', status: 'idle', version: 300 },
      { kind: 'run', runId: 'run-1' }
    )
    await vi.waitFor(() => expect(emitted).toContain('sessions.status.changed'))
    await expectWatcherPending(result)

    hub.publish(
      'sessions.status.changed',
      { sessionId: 'run-1', status: 'idle', version: 301 },
      { kind: 'run', runId: 'run-1' }
    )

    await expect(result).resolves.toEqual({ runId: 'run-1', lastCursor: 'test-epoch_1:2' })
    expect(emitted).toEqual(['runs.snapshot', 'sessions.status.changed', 'sessions.status.changed'])
  })

  it('returns immediately after recovering an already-terminal run', async () => {
    const idleSession = { ...baseSession, status: 'idle' as const }
    const { service } = createHarness({ session: idleSession })
    const emit = vi.fn(async () => undefined)

    await expect(
      service.dispatchStream(
        eventsSubscribeRoute.name,
        { runId: 'run-1' },
        humanCaller,
        new AbortController().signal,
        emit
      )
    ).resolves.toEqual({ runId: 'run-1', lastCursor: 'test-epoch_1:0' })
    expect(emit).toHaveBeenCalledWith(
      'runs.snapshot',
      expect.objectContaining({
        recoveryReason: 'cursor_missing',
        run: expect.objectContaining({ phase: 'terminal' })
      }),
      { runId: 'run-1', cursor: 'test-epoch_1:0' }
    )
  })

  it('disconnects a watcher without cancelling the detached run', async () => {
    const { service, turn } = createHarness()
    let snapshotEmitted!: () => void
    const snapshotReady = new Promise<void>((resolve) => {
      snapshotEmitted = resolve
    })
    const controller = new AbortController()
    const result = service.dispatchStream(
      eventsSubscribeRoute.name,
      { runId: 'run-1' },
      humanCaller,
      controller.signal,
      async (event) => {
        if (event === 'runs.snapshot') snapshotEmitted()
      }
    )
    await snapshotReady
    controller.abort()

    await expect(result).resolves.toEqual({ runId: 'run-1', lastCursor: 'test-epoch_1:0' })
    expect(turn.cancelGeneration).not.toHaveBeenCalled()
  })

  it('rejects renderer callers before exposing run existence', async () => {
    const { service } = createHarness()

    await expect(
      invokeRoute(
        service,
        runsGetRoute.name,
        { runId: 'run-1' },
        {
          kind: 'renderer',
          webContentsId: 1,
          windowId: 1
        }
      )
    ).rejects.toBeInstanceOf(CliRequestError)
  })
})
