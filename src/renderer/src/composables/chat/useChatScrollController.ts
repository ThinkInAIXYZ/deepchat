import { readonly, shallowRef, type ShallowRef } from 'vue'
import { ChatScrollOperationArbiter } from './chatScrollOperationArbiter'
import { ChatScrollRequestQueue } from './chatScrollRequestQueue'
import {
  canAcceptChatScrollRequest,
  createChatScrollState,
  reduceChatScrollState,
  type ChatScrollReason,
  type ChatScrollRequest,
  type ChatScrollState,
  type ChatScrollTarget
} from './chatScrollState'

type ChatScrollControllerOptions = {
  viewport: Readonly<ShallowRef<HTMLElement | null>>
  resolveMessageTop: (messageId: string) => number | null
  bottomThreshold?: number
  canAutoFollow?: () => boolean
  onCommitted?: (top: number, request: ChatScrollRequest) => void
}

type RequestInput = {
  sessionEpoch: number
  reason: ChatScrollReason
  target: ChatScrollTarget
}

export type ChatViewportScrollSource = 'programmatic' | 'user' | 'native'

export function useChatScrollController(options: ChatScrollControllerOptions) {
  const bottomThreshold = options.bottomThreshold ?? 80
  const state = shallowRef<ChatScrollState>(createChatScrollState())
  const activeOperation = shallowRef<ChatScrollRequest | null>(null)
  const queue = new ChatScrollRequestQueue()
  const arbiter = new ChatScrollOperationArbiter()

  let nextRequestId = 1
  let nextSessionEpoch = 1
  let activeSessionId = ''
  let commitFrame: number | null = null
  let verifyFrame: number | null = null
  let writeCommittedThisFrame = false
  let committedScroll: {
    request: ChatScrollRequest
    expectedTop: number
  } | null = null

  const updateState = (event: Parameters<typeof reduceChatScrollState>[1]) => {
    state.value = reduceChatScrollState(state.value, event)
  }

  const cancelFrames = () => {
    if (commitFrame !== null) {
      window.cancelAnimationFrame(commitFrame)
      commitFrame = null
    }
    if (verifyFrame !== null) {
      window.cancelAnimationFrame(verifyFrame)
      verifyFrame = null
    }
    writeCommittedThisFrame = false
  }

  const syncActiveOperation = () => {
    activeOperation.value = arbiter.active
  }

  const completeStateForReason = (reason: ChatScrollReason) => {
    switch (reason) {
      case 'session-restore':
        updateState({ type: 'restore-complete' })
        break
      case 'history-prepend':
        updateState({ type: 'history-preservation-complete' })
        break
      case 'search-navigation':
      case 'spotlight-navigation':
        updateState({ type: 'explicit-navigation-complete' })
        break
      default:
        break
    }
  }

  const completeOperation = (request: ChatScrollRequest) => {
    if (!arbiter.complete(request.id)) return
    completeStateForReason(request.reason)
    syncActiveOperation()
  }

  const resolveTargetTop = (request: ChatScrollRequest, viewport: HTMLElement): number | null => {
    const maxTop = Math.max(viewport.scrollHeight - viewport.clientHeight, 0)
    switch (request.target.kind) {
      case 'bottom':
        return maxTop
      case 'absolute':
        return Math.min(Math.max(request.target.top, 0), maxTop)
      case 'message': {
        const messageTop = options.resolveMessageTop(request.target.messageId)
        if (messageTop === null) return null
        const offset =
          request.target.align === 'center'
            ? Math.round(viewport.clientHeight / 2)
            : request.target.align === 'one-third'
              ? Math.round(viewport.clientHeight / 3)
              : 0
        return Math.min(Math.max(messageTop - offset, 0), maxTop)
      }
    }
  }

  const scheduleVerification = (request: ChatScrollRequest) => {
    if (verifyFrame !== null) {
      window.cancelAnimationFrame(verifyFrame)
    }
    verifyFrame = window.requestAnimationFrame(() => {
      verifyFrame = null
      completeOperation(request)
    })
  }

  const commitQueuedOperation = (atAnimationFrameBoundary = false) => {
    commitFrame = null
    if (atAnimationFrameBoundary) {
      writeCommittedThisFrame = false
    } else if (writeCommittedThisFrame) {
      scheduleCommit()
      return
    }

    const request = queue.take(state.value.sessionEpoch)
    if (!request || arbiter.active?.id !== request.id) return

    const viewport = options.viewport.value
    if (!viewport) {
      completeOperation(request)
      return
    }

    const targetTop = resolveTargetTop(request, viewport)
    if (targetTop === null) {
      completeOperation(request)
      return
    }

    updateState({ type: 'request-committed', requestId: request.id })
    options.onCommitted?.(targetTop, request)
    if (Math.abs(viewport.scrollTop - targetTop) < 1) {
      committedScroll = null
      scheduleVerification(request)
      return
    }

    writeCommittedThisFrame = true
    committedScroll = { request, expectedTop: targetTop }
    viewport.scrollTop = targetTop
    scheduleVerification(request)
    // Expire the immediate-write guard at the next frame boundary even when
    // there is no second request waiting to be committed.
    scheduleCommit()
  }

  const scheduleCommit = () => {
    if (commitFrame !== null) return
    commitFrame = window.requestAnimationFrame(() => commitQueuedOperation(true))
  }

  const transitionForAcceptedRequest = (reason: ChatScrollReason) => {
    switch (reason) {
      case 'session-restore':
        updateState({ type: 'restore-requested' })
        break
      case 'submit':
      case 'user-return-to-bottom':
        updateState({ type: reason === 'submit' ? 'submit-started' : 'return-to-bottom' })
        break
      case 'history-prepend':
        updateState({ type: 'history-preservation-start' })
        break
      case 'search-navigation':
      case 'spotlight-navigation':
        updateState({ type: 'explicit-navigation-start' })
        break
      default:
        break
    }
  }

  const beginSession = (sessionId: string): number => {
    cancelFrames()
    queue.clear()
    const sessionEpoch = nextSessionEpoch
    nextSessionEpoch += 1
    activeSessionId = sessionId
    committedScroll = null
    arbiter.beginSession(sessionEpoch)
    activeOperation.value = null
    updateState({ type: 'begin-session', sessionEpoch })
    return sessionEpoch
  }

  const acceptRequest = (input: RequestInput, commitImmediately: boolean): number | null => {
    if (input.sessionEpoch !== state.value.sessionEpoch || !activeSessionId) return null
    if (input.reason === 'auto-follow' && options.canAutoFollow?.() === false) return null
    if (!canAcceptChatScrollRequest(state.value, input.reason)) return null

    const request: ChatScrollRequest = { ...input, id: nextRequestId }
    nextRequestId += 1
    const offer = arbiter.offer(request)
    if (!offer.accepted) return null

    transitionForAcceptedRequest(input.reason)
    queue.enqueue(request)
    syncActiveOperation()
    if (commitImmediately && !writeCommittedThisFrame) {
      if (commitFrame !== null) {
        window.cancelAnimationFrame(commitFrame)
        commitFrame = null
      }
      commitQueuedOperation()
    } else {
      scheduleCommit()
    }
    return request.id
  }

  const request = (input: RequestInput): number | null => acceptRequest(input, false)

  const requestImmediate = (input: RequestInput): number | null => acceptRequest(input, true)

  const notifyUserGestureStart = (_kind: 'wheel' | 'touch' | 'pointer' | 'keyboard') => {
    cancelFrames()
    queue.clear()
    arbiter.cancelAll()
    committedScroll = null
    activeOperation.value = null
    updateState({ type: 'user-gesture-start' })
  }

  const notifyUserGestureEnd = () => {
    updateState({ type: 'user-gesture-end' })
  }

  const notifyViewportScroll = (): ChatViewportScrollSource => {
    const viewport = options.viewport.value
    if (!viewport) return 'native'
    const nearBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= bottomThreshold
    updateState({ type: 'bottom-proximity-changed', nearBottom })

    const committed = committedScroll
    if (committed && Math.abs(viewport.scrollTop - committed.expectedTop) < 1) {
      committedScroll = null
      completeOperation(committed.request)
      return 'programmatic'
    }

    const userOwnedBeforeTransition = state.value.userOwned || state.value.activeGesture
    if (nearBottom && state.value.userOwned && state.value.activeGesture) {
      updateState({ type: 'return-to-bottom' })
    }
    return userOwnedBeforeTransition ? 'user' : 'native'
  }

  const notifyViewportResize = (): number | null => {
    updateState({ type: 'viewport-resized' })
    if (state.value.userOwned || state.value.activeGesture) return null
    if (options.canAutoFollow?.() === false) return null
    if (state.value.mode === 'restoring') {
      return request({
        sessionEpoch: state.value.sessionEpoch,
        reason: 'session-restore',
        target: { kind: 'bottom' }
      })
    }
    if (state.value.mode === 'following') {
      return request({
        sessionEpoch: state.value.sessionEpoch,
        reason: 'auto-follow',
        target: { kind: 'bottom' }
      })
    }
    return null
  }

  const dispose = () => {
    cancelFrames()
    queue.clear()
    arbiter.cancelAll()
    activeOperation.value = null
    activeSessionId = ''
    committedScroll = null
  }

  return {
    state: readonly(state),
    activeOperation: readonly(activeOperation),
    beginSession,
    request,
    requestImmediate,
    notifyUserGestureStart,
    notifyUserGestureEnd,
    notifyViewportScroll,
    notifyViewportResize,
    dispose
  }
}
