import { describe, expect, it, vi } from 'vitest'
import { SessionEventRouter } from '@/events/sessionEventRouter'
import {
  TypedEventHub,
  TypedEventHubOverflowError,
  type TypedEventRecord
} from '@/events/typedEventHub'

function createHub(options: Partial<ConstructorParameters<typeof TypedEventHub>[0]> = {}): {
  hub: TypedEventHub
  broadcast: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
} {
  const broadcast = vi.fn()
  const send = vi.fn()
  return {
    hub: new TypedEventHub({
      renderer: { broadcast, send },
      epoch: 'test-epoch',
      now: () => 123,
      ...options
    }),
    broadcast,
    send
  }
}

async function nextEvent(events: AsyncIterable<TypedEventRecord>): Promise<TypedEventRecord> {
  const result = await events[Symbol.asyncIterator]().next()
  if (result.done) throw new Error('Expected an event')
  return result.value
}

describe('TypedEventHub', () => {
  it('delivers renderer targets without creating stream subscriptions', () => {
    const { hub, broadcast, send } = createHub()

    hub.publish(
      'sessions.status.changed',
      { sessionId: 'session-1', status: 'generating', version: 1 },
      { kind: 'renderer-all' }
    )
    hub.publish(
      'sessions.status.changed',
      { sessionId: 'session-2', status: 'idle', version: 2 },
      { kind: 'renderer', webContentsId: 7 }
    )

    expect(broadcast).toHaveBeenCalledWith({
      name: 'sessions.status.changed',
      payload: { sessionId: 'session-1', status: 'generating', version: 1 }
    })
    expect(send).toHaveBeenCalledWith(7, {
      name: 'sessions.status.changed',
      payload: { sessionId: 'session-2', status: 'idle', version: 2 }
    })
  })

  it('isolates run targets and replays retained events after a cursor', async () => {
    const { hub } = createHub()
    const runOne = hub.subscribe({ kind: 'run', runId: 'run-1' })
    const runTwo = hub.subscribe({ kind: 'run', runId: 'run-2' })

    hub.publish(
      'sessions.status.changed',
      { sessionId: 'run-1', status: 'generating', version: 1 },
      { kind: 'run', runId: 'run-1' }
    )
    const first = await nextEvent(runOne.events)
    expect(first.cursor).toBe('test-epoch_1:1')

    const replay = hub.subscribe(
      { kind: 'run', runId: 'run-1' },
      { afterCursor: runOne.initialCursor }
    )
    expect(replay.recoveryReason).toBeNull()
    await expect(nextEvent(replay.events)).resolves.toEqual(first)

    const runTwoIterator = runTwo.events[Symbol.asyncIterator]()
    const pendingRunTwo = runTwoIterator.next()
    runTwo.close()
    await expect(pendingRunTwo).resolves.toEqual({ value: undefined, done: true })
  })

  it('requires a snapshot when a cursor belongs to another process epoch', () => {
    const { hub } = createHub()
    const subscription = hub.subscribe(
      { kind: 'run', runId: 'run-1' },
      { afterCursor: 'old-epoch:42' }
    )

    expect(subscription.recoveryReason).toBe('server_restarted')
    expect(subscription.initialCursor).toBe('test-epoch_1:0')
  })

  it('expires cursors when an evicted stream is recreated in the same process', () => {
    const { hub } = createHub({ maxStreams: 1 })
    const first = hub.subscribe({ kind: 'run', runId: 'run-1' })
    first.close()
    const other = hub.subscribe({ kind: 'run', runId: 'run-2' })
    other.close()

    const recreated = hub.subscribe(
      { kind: 'run', runId: 'run-1' },
      { afterCursor: first.initialCursor }
    )

    expect(recreated.recoveryReason).toBe('cursor_expired')
    expect(recreated.initialCursor).toBe('test-epoch_3:0')
  })

  it('expires idle streams before accepting a stale cursor', () => {
    let now = 0
    const { hub } = createHub({
      now: () => now,
      streamIdleTtlMs: 10
    })
    const first = hub.subscribe({ kind: 'run', runId: 'run-1' })
    first.close()
    hub.publish(
      'sessions.status.changed',
      { sessionId: 'run-1', status: 'generating', version: 1 },
      { kind: 'run', runId: 'run-1' }
    )
    now = 11

    const recreated = hub.subscribe(
      { kind: 'run', runId: 'run-1' },
      { afterCursor: first.initialCursor }
    )

    expect(recreated.recoveryReason).toBe('cursor_expired')
    expect(recreated.initialCursor).toBe('test-epoch_2:0')
  })

  it('expires a cursor when the global retention budget evicts its event', () => {
    const { hub } = createHub({ maxTotalRetainedBytes: 1024 })
    const first = hub.subscribe({ kind: 'run', runId: 'run-1' })
    first.close()
    hub.publish(
      'chat.stream.failed',
      {
        requestId: 'request-1',
        sessionId: 'run-1',
        messageId: 'message-1',
        failedAt: 1,
        error: 'x'.repeat(600)
      },
      { kind: 'run', runId: 'run-1' }
    )
    const second = hub.subscribe({ kind: 'run', runId: 'run-2' })
    second.close()
    hub.publish(
      'chat.stream.failed',
      {
        requestId: 'request-2',
        sessionId: 'run-2',
        messageId: 'message-2',
        failedAt: 2,
        error: 'y'.repeat(600)
      },
      { kind: 'run', runId: 'run-2' }
    )

    const replay = hub.subscribe(
      { kind: 'run', runId: 'run-1' },
      { afterCursor: first.initialCursor }
    )

    expect(replay.recoveryReason).toBe('cursor_expired')
    expect(replay.initialCursor).toBe('test-epoch_1:1')
    const retained = hub.subscribe(
      { kind: 'run', runId: 'run-2' },
      { afterCursor: second.initialCursor }
    )
    expect(retained.recoveryReason).toBeNull()
  })

  it('replays only the latest retained snapshot for a message', async () => {
    const { hub } = createHub()
    const live = hub.subscribe({ kind: 'run', runId: 'run-1' })
    hub.publish(
      'chat.stream.updated',
      {
        kind: 'snapshot',
        requestId: 'request-1',
        sessionId: 'run-1',
        messageId: 'message-1',
        updatedAt: 1,
        blocks: []
      },
      { kind: 'run', runId: 'run-1' }
    )
    const first = await nextEvent(live.events)
    live.close()
    hub.publish(
      'chat.stream.updated',
      {
        kind: 'snapshot',
        requestId: 'request-1',
        sessionId: 'run-1',
        messageId: 'message-1',
        updatedAt: 2,
        blocks: []
      },
      { kind: 'run', runId: 'run-1' }
    )

    const replay = hub.subscribe({ kind: 'run', runId: 'run-1' }, { afterCursor: first.cursor })

    expect(replay.recoveryReason).toBeNull()
    await expect(nextEvent(replay.events)).resolves.toMatchObject({
      sequence: 2,
      data: { messageId: 'message-1', updatedAt: 2 }
    })
  })

  it('terminates a slow subscriber instead of growing its queue', async () => {
    const { hub } = createHub({ maxSubscriberEvents: 1, maxSubscriberBytes: 64 * 1024 })
    const subscription = hub.subscribe({ kind: 'run', runId: 'run-1' })

    hub.publish(
      'sessions.status.changed',
      { sessionId: 'run-1', status: 'generating', version: 1 },
      { kind: 'run', runId: 'run-1' }
    )
    hub.publish(
      'sessions.status.changed',
      { sessionId: 'run-1', status: 'idle', version: 2 },
      { kind: 'run', runId: 'run-1' }
    )

    await expect(nextEvent(subscription.events)).rejects.toBeInstanceOf(TypedEventHubOverflowError)
  })

  it('rejects an oversized event even while the subscriber is waiting', async () => {
    const { hub } = createHub({ maxSubscriberBytes: 256 })
    const subscription = hub.subscribe({ kind: 'run', runId: 'run-1' })
    const pending = nextEvent(subscription.events)

    hub.publish(
      'chat.stream.failed',
      {
        requestId: 'request-1',
        sessionId: 'run-1',
        messageId: 'message-1',
        failedAt: 123,
        error: 'x'.repeat(512)
      },
      { kind: 'run', runId: 'run-1' }
    )

    await expect(pending).rejects.toBeInstanceOf(TypedEventHubOverflowError)
  })
})

describe('SessionEventRouter', () => {
  it('keeps CLI run content off all-window broadcasts', async () => {
    const { hub, broadcast, send } = createHub()
    const router = new SessionEventRouter({
      hub,
      resolveSessionRunId: (sessionId) => (sessionId === 'cli-run' ? 'cli-run' : null),
      getBoundRendererIds: (sessionId) => (sessionId === 'cli-run' ? [9] : [])
    })
    const subscription = hub.subscribe({ kind: 'run', runId: 'cli-run' })

    router.publish('chat.stream.updated', {
      kind: 'snapshot',
      requestId: 'request-1',
      sessionId: 'cli-run',
      messageId: 'message-1',
      updatedAt: 123,
      blocks: []
    })

    expect(broadcast).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(9, {
      name: 'chat.stream.updated',
      payload: {
        kind: 'snapshot',
        requestId: 'request-1',
        sessionId: 'cli-run',
        messageId: 'message-1',
        updatedAt: 123,
        blocks: []
      }
    })
    await expect(nextEvent(subscription.events)).resolves.toMatchObject({
      target: { kind: 'run', runId: 'cli-run' },
      event: 'chat.stream.updated'
    })
  })

  it('keeps CLI runs discoverable without broadcasting their transcript content', () => {
    const { hub, broadcast, send } = createHub()
    const router = new SessionEventRouter({
      hub,
      resolveSessionRunId: (sessionId) => (sessionId === 'cli-run' ? 'cli-run' : null),
      getBoundRendererIds: () => [9]
    })

    router.publish('sessions.updated', {
      sessionIds: ['normal', 'cli-run'],
      reason: 'updated'
    })

    expect(broadcast).toHaveBeenCalledWith({
      name: 'sessions.updated',
      payload: { sessionIds: ['normal', 'cli-run'], reason: 'updated' }
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('suppresses full transcript notifications from CLI event streams', async () => {
    const { hub, broadcast, send } = createHub()
    const router = new SessionEventRouter({
      hub,
      resolveSessionRunId: () => 'cli-run',
      getBoundRendererIds: () => [9]
    })
    const subscription = hub.subscribe({ kind: 'run', runId: 'cli-run' })

    router.publish('sessions.messages.changed', {
      sessionId: 'cli-run',
      messages: [],
      version: 1
    })

    expect(broadcast).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(1)
    const iterator = subscription.events[Symbol.asyncIterator]()
    const pending = iterator.next()
    subscription.close()
    await expect(pending).resolves.toEqual({ value: undefined, done: true })
  })

  it('routes descendant session events to the root CLI run', async () => {
    const { hub, broadcast } = createHub()
    const resolveSessionRunId = vi.fn((sessionId: string) =>
      sessionId === 'child-session' ? 'root-run' : null
    )
    const router = new SessionEventRouter({
      hub,
      resolveSessionRunId,
      getBoundRendererIds: () => []
    })
    const subscription = hub.subscribe({ kind: 'run', runId: 'root-run' })

    router.publish('chat.stream.completed', {
      requestId: 'request-1',
      sessionId: 'child-session',
      messageId: 'message-1',
      completedAt: 123
    })
    router.publish('sessions.status.changed', {
      sessionId: 'child-session',
      status: 'idle',
      version: 2
    })

    expect(broadcast).not.toHaveBeenCalled()
    expect(resolveSessionRunId).toHaveBeenCalledTimes(1)
    await expect(nextEvent(subscription.events)).resolves.toMatchObject({
      target: { kind: 'run', runId: 'root-run' },
      event: 'chat.stream.completed'
    })
    await expect(nextEvent(subscription.events)).resolves.toMatchObject({
      target: { kind: 'run', runId: 'root-run' },
      event: 'sessions.status.changed'
    })
  })

  it('drops late content events after session ownership can no longer be resolved', () => {
    const { hub, broadcast, send } = createHub()
    const router = new SessionEventRouter({
      hub,
      resolveSessionRunId: () => undefined,
      getBoundRendererIds: () => []
    })

    router.publish('chat.stream.failed', {
      requestId: 'request-1',
      sessionId: 'deleted-session',
      messageId: 'message-1',
      failedAt: 123,
      error: 'late failure'
    })

    expect(broadcast).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('broadcasts deletion invalidations after the session row is gone', () => {
    const { hub, broadcast, send } = createHub()
    const router = new SessionEventRouter({
      hub,
      resolveSessionRunId: () => undefined,
      getBoundRendererIds: () => []
    })

    router.publish('sessions.updated', {
      sessionIds: ['deleted-session'],
      reason: 'deleted'
    })

    expect(broadcast).toHaveBeenCalledWith({
      name: 'sessions.updated',
      payload: { sessionIds: ['deleted-session'], reason: 'deleted' }
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('retries unknown ownership and invalidates cached ownership on session updates', async () => {
    const { hub, broadcast } = createHub()
    let runId: string | null | undefined
    const resolveSessionRunId = vi.fn(() => runId)
    const router = new SessionEventRouter({
      hub,
      resolveSessionRunId,
      getBoundRendererIds: () => []
    })
    const subscription = hub.subscribe({ kind: 'run', runId: 'cli-run' })
    const streamEvent = {
      requestId: 'request-1',
      sessionId: 'session-1',
      messageId: 'message-1',
      completedAt: 123
    }

    router.publish('chat.stream.completed', streamEvent)
    runId = null
    router.publish('chat.stream.completed', streamEvent)
    runId = 'cli-run'
    router.publish('sessions.updated', { sessionIds: ['session-1'], reason: 'updated' })
    router.publish('chat.stream.completed', streamEvent)

    expect(resolveSessionRunId).toHaveBeenCalledTimes(3)
    expect(broadcast).toHaveBeenCalledTimes(2)
    await expect(nextEvent(subscription.events)).resolves.toMatchObject({
      target: { kind: 'run', runId: 'cli-run' },
      event: 'chat.stream.completed'
    })
  })
})
