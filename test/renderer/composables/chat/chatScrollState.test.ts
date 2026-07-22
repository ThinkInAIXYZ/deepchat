import { describe, expect, it } from 'vitest'
import {
  canAcceptChatScrollRequest,
  createChatScrollState,
  getChatScrollRequestPriority,
  reduceChatScrollState,
  type ChatScrollRequest
} from '@/composables/chat/chatScrollState'
import { ChatScrollOperationArbiter } from '@/composables/chat/chatScrollOperationArbiter'
import { ChatScrollRequestQueue } from '@/composables/chat/chatScrollRequestQueue'

describe('chatScrollState', () => {
  it('keeps user ownership durable across passive restore, stream, resize, and measurement events', () => {
    let state = createChatScrollState(1)
    state = reduceChatScrollState(state, { type: 'user-gesture-start' })

    for (const event of [
      { type: 'restore-requested' },
      { type: 'stream-updated' },
      { type: 'viewport-resized' },
      { type: 'measurements-committed' }
    ] as const) {
      state = reduceChatScrollState(state, event)
    }

    expect(state.mode).toBe('reading')
    expect(state.userOwned).toBe(true)
  })

  it('returns ownership only through an explicit bottom action or a new session', () => {
    let state = reduceChatScrollState(createChatScrollState(1), {
      type: 'user-gesture-start'
    })

    state = reduceChatScrollState(state, { type: 'user-gesture-end' })
    expect(state.userOwned).toBe(true)

    state = reduceChatScrollState(state, { type: 'return-to-bottom' })
    expect(state.mode).toBe('following')
    expect(state.userOwned).toBe(false)

    state = reduceChatScrollState(state, { type: 'begin-session', sessionEpoch: 2 })
    expect(state.sessionEpoch).toBe(2)
    expect(state.mode).toBe('restoring')
    expect(state.userOwned).toBe(false)
  })

  it('lets an explicit navigation temporarily override reading without enabling passive follow', () => {
    let state = reduceChatScrollState(createChatScrollState(1), {
      type: 'user-gesture-start'
    })
    state = reduceChatScrollState(state, { type: 'explicit-navigation-start' })
    expect(state.mode).toBe('navigating')
    expect(state.userOwned).toBe(false)

    state = reduceChatScrollState(state, { type: 'explicit-navigation-complete' })
    expect(state.mode).toBe('reading')
    expect(state.userOwned).toBe(true)
  })

  it('preserves reading ownership across coalesced explicit navigation starts', () => {
    let state = reduceChatScrollState(createChatScrollState(1), {
      type: 'user-gesture-start'
    })
    state = reduceChatScrollState(state, { type: 'user-gesture-end' })
    state = reduceChatScrollState(state, { type: 'explicit-navigation-start' })
    state = reduceChatScrollState(state, { type: 'explicit-navigation-start' })
    state = reduceChatScrollState(state, { type: 'explicit-navigation-complete' })

    expect(state.mode).toBe('reading')
    expect(state.userOwned).toBe(true)
  })

  it('ranks explicit user navigation above history, restore, follow, and measurements', () => {
    expect(getChatScrollRequestPriority('search-navigation')).toBeGreaterThan(
      getChatScrollRequestPriority('history-prepend')
    )
    expect(getChatScrollRequestPriority('history-prepend')).toBeGreaterThan(
      getChatScrollRequestPriority('session-restore')
    )
    expect(getChatScrollRequestPriority('session-restore')).toBeGreaterThan(
      getChatScrollRequestPriority('auto-follow')
    )
    expect(getChatScrollRequestPriority('auto-follow')).toBeGreaterThan(
      getChatScrollRequestPriority('measurement-anchor')
    )
  })

  it('prevents passive owners from pulling in the opposite controller mode', () => {
    const following = reduceChatScrollState(createChatScrollState(1), {
      type: 'restore-complete'
    })
    expect(canAcceptChatScrollRequest(following, 'auto-follow')).toBe(true)
    expect(canAcceptChatScrollRequest(following, 'measurement-anchor')).toBe(false)

    const reading = reduceChatScrollState(following, { type: 'user-gesture-start' })
    expect(canAcceptChatScrollRequest(reading, 'auto-follow')).toBe(false)
    expect(canAcceptChatScrollRequest(reading, 'session-restore')).toBe(false)
    expect(canAcceptChatScrollRequest(reading, 'measurement-anchor')).toBe(false)
    expect(canAcceptChatScrollRequest(reading, 'history-prepend')).toBe(false)

    const idleReading = reduceChatScrollState(reading, { type: 'user-gesture-end' })
    expect(canAcceptChatScrollRequest(idleReading, 'measurement-anchor')).toBe(true)
    expect(canAcceptChatScrollRequest(idleReading, 'history-prepend')).toBe(true)
  })

  it('rejects a late session restore once the user explicitly navigated', () => {
    const navigating = reduceChatScrollState(createChatScrollState(1), {
      type: 'explicit-navigation-start'
    })
    expect(canAcceptChatScrollRequest(navigating, 'session-restore')).toBe(false)

    const navigated = reduceChatScrollState(navigating, { type: 'explicit-navigation-complete' })
    expect(navigated.mode).toBe('following')
    expect(canAcceptChatScrollRequest(navigated, 'session-restore')).toBe(false)
    expect(canAcceptChatScrollRequest(navigated, 'auto-follow')).toBe(true)

    const nextSession = reduceChatScrollState(navigated, { type: 'begin-session', sessionEpoch: 2 })
    expect(canAcceptChatScrollRequest(nextSession, 'session-restore')).toBe(true)
  })
})

describe('ChatScrollRequestQueue', () => {
  const request = (
    id: number,
    reason: ChatScrollRequest['reason'],
    sessionEpoch = 1
  ): ChatScrollRequest => ({
    id,
    sessionEpoch,
    reason,
    target: { kind: 'absolute', top: id * 10 }
  })

  it('keeps only the highest-priority request for one frame', () => {
    const queue = new ChatScrollRequestQueue()
    queue.enqueue(request(1, 'measurement-anchor'))
    queue.enqueue(request(2, 'auto-follow'))
    queue.enqueue(request(3, 'search-navigation'))
    queue.enqueue(request(4, 'history-prepend'))

    expect(queue.take(1)?.id).toBe(3)
    expect(queue.take(1)).toBeNull()
  })

  it('uses the latest request when priorities are equal', () => {
    const queue = new ChatScrollRequestQueue()
    queue.enqueue(request(1, 'auto-follow'))
    queue.enqueue(request(2, 'auto-follow'))

    expect(queue.take(1)?.id).toBe(2)
  })

  it('discards requests from stale session epochs', () => {
    const queue = new ChatScrollRequestQueue()
    queue.enqueue(request(1, 'search-navigation', 1))
    queue.enqueue(request(2, 'auto-follow', 2))

    expect(queue.take(2)?.id).toBe(2)
    expect(queue.take(1)).toBeNull()
  })

  it('does not let stale enqueue or take calls erase newer-session work', () => {
    const queue = new ChatScrollRequestQueue()
    queue.enqueue(request(2, 'auto-follow', 2))
    queue.enqueue(request(1, 'search-navigation', 1))

    expect(queue.take(1)).toBeNull()
    expect(queue.take(2)?.id).toBe(2)
  })

  it('cancels queued requests explicitly', () => {
    const queue = new ChatScrollRequestQueue()
    queue.enqueue(request(1, 'spotlight-navigation'))
    queue.cancel(1)

    expect(queue.take(1)).toBeNull()
  })
})

describe('ChatScrollOperationArbiter', () => {
  const request = (
    id: number,
    reason: ChatScrollRequest['reason'],
    sessionEpoch = 1
  ): ChatScrollRequest => ({
    id,
    sessionEpoch,
    reason,
    target: { kind: 'absolute', top: id * 100 }
  })

  it('allows only one active scroll operation at a time', () => {
    const arbiter = new ChatScrollOperationArbiter()

    expect(arbiter.offer(request(1, 'auto-follow')).accepted).toBe(true)
    expect(arbiter.offer(request(2, 'measurement-anchor')).accepted).toBe(false)
    expect(arbiter.active?.id).toBe(1)
  })

  it('coalesces repeated requests from the same owner without creating a second operation', () => {
    const arbiter = new ChatScrollOperationArbiter()
    arbiter.offer(request(1, 'auto-follow'))

    const result = arbiter.offer(request(2, 'auto-follow'))

    expect(result.accepted).toBe(true)
    expect(result.replacedRequestId).toBeNull()
    expect(arbiter.active?.id).toBe(2)
    expect(arbiter.active?.target).toEqual({ kind: 'absolute', top: 200 })
  })

  it('atomically replaces a lower-priority operation instead of running both', () => {
    const arbiter = new ChatScrollOperationArbiter()
    arbiter.offer(request(1, 'auto-follow'))

    const result = arbiter.offer(request(2, 'search-navigation'))

    expect(result.accepted).toBe(true)
    expect(result.replacedRequestId).toBe(1)
    expect(arbiter.active?.id).toBe(2)
  })

  it('cancels the active operation and all deferred work on user gesture', () => {
    const arbiter = new ChatScrollOperationArbiter()
    arbiter.offer(request(1, 'session-restore'))
    arbiter.cancelAll()

    expect(arbiter.active).toBeNull()
    expect(arbiter.complete(1)).toBe(false)
  })

  it('rejects stale-session operations', () => {
    const arbiter = new ChatScrollOperationArbiter()
    arbiter.beginSession(2)

    expect(arbiter.offer(request(1, 'search-navigation', 1)).accepted).toBe(false)
    expect(arbiter.active).toBeNull()
  })
})
