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

function createHarness(
  overrides: {
    session?: SessionWithState
    storedSession?: SessionRecord | null
    messages?: ChatMessageRecord[]
  } = {}
): {
  service: CliRunService
  hub: TypedEventHub
  lifecycle: CliRunServiceOptions['lifecycle']
  turn: CliRunServiceOptions['turn']
  projection: CliRunServiceOptions['projection']
  sessions: CliRunServiceOptions['sessions']
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
      eventHub: hub,
      now: () => 200,
      log
    }),
    hub,
    lifecycle,
    turn,
    projection,
    sessions,
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
          content: JSON.stringify([{ type: 'content', content: oversized }])
        })
      ]
    })

    const result = runsGetRoute.output.parse(
      await invokeRoute(service, runsGetRoute.name, { runId: 'run-1' })
    )

    expect(result.messages[0]).toMatchObject({ role: 'user', text: 'hello' })
    expect(result.messages[1].textTruncated).toBe(true)
    expect(Buffer.byteLength(result.messages[1].text, 'utf8')).toBeLessThanOrEqual(
      RUN_MESSAGE_MAX_TEXT_BYTES
    )
    expect(JSON.stringify(result)).not.toContain('private-provider-detail')
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
          { type: 'content', content: '\0'.repeat(RUN_MESSAGE_MAX_TEXT_BYTES) }
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

  it('emits a recovery snapshot and then terminates on a targeted completion event', async () => {
    const { service, hub } = createHarness()
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

    await expect(result).resolves.toEqual({ runId: 'run-1', lastCursor: 'test-epoch_1:1' })
    expect(emitted.map((entry) => entry.event)).toEqual(['runs.snapshot', 'chat.stream.completed'])
    expect(emitted[0].context).toEqual({ runId: 'run-1', cursor: 'test-epoch_1:0' })
  })

  it('does not terminate a root run watcher when a descendant session completes', async () => {
    const { service, hub } = createHarness()
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

    hub.publish(
      'chat.stream.completed',
      {
        requestId: 'request-child',
        sessionId: 'child-session',
        messageId: 'message-child',
        completedAt: 300
      },
      { kind: 'run', runId: 'run-1' }
    )
    await vi.waitFor(() => expect(emitted).toContain('chat.stream.completed'))
    let settled = false
    void result.finally(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    hub.publish(
      'chat.stream.completed',
      {
        requestId: 'request-root',
        sessionId: 'run-1',
        messageId: 'message-root',
        completedAt: 301
      },
      { kind: 'run', runId: 'run-1' }
    )

    await expect(result).resolves.toEqual({ runId: 'run-1', lastCursor: 'test-epoch_1:2' })
    expect(emitted).toEqual(['runs.snapshot', 'chat.stream.completed', 'chat.stream.completed'])
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
      expect.objectContaining({ recoveryReason: 'cursor_missing' }),
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
