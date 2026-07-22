export type ChatScrollMode =
  | 'restoring'
  | 'following'
  | 'reading'
  | 'navigating'
  | 'history-preserving'

export type ChatScrollReason =
  | 'session-restore'
  | 'auto-follow'
  | 'submit'
  | 'history-prepend'
  | 'measurement-anchor'
  | 'search-navigation'
  | 'spotlight-navigation'
  | 'user-return-to-bottom'

export type ChatScrollTarget =
  | { kind: 'bottom' }
  | { kind: 'absolute'; top: number }
  | {
      kind: 'message'
      messageId: string
      align: 'start' | 'center' | 'one-third'
    }

export type ChatScrollRequest = {
  id: number
  sessionEpoch: number
  reason: ChatScrollReason
  target: ChatScrollTarget
}

export type ChatScrollState = {
  sessionEpoch: number
  mode: ChatScrollMode
  userOwned: boolean
  nearBottom: boolean
  activeGesture: boolean
  lastCommittedRequestId: number
  resumeUserOwnedAfterNavigation: boolean
  /** True once the user explicitly navigated (search/spotlight) this session. */
  hasExplicitNavigation: boolean
}

export type ChatScrollEvent =
  | { type: 'begin-session'; sessionEpoch: number }
  | { type: 'user-gesture-start' }
  | { type: 'user-gesture-end' }
  | { type: 'bottom-proximity-changed'; nearBottom: boolean }
  | { type: 'return-to-bottom' }
  | { type: 'submit-started' }
  | { type: 'explicit-navigation-start' }
  | { type: 'explicit-navigation-complete' }
  | { type: 'history-preservation-start' }
  | { type: 'history-preservation-complete' }
  | { type: 'restore-requested' }
  | { type: 'restore-complete' }
  | { type: 'stream-updated' }
  | { type: 'viewport-resized' }
  | { type: 'measurements-committed' }
  | { type: 'request-committed'; requestId: number }

export function createChatScrollState(sessionEpoch = 0): ChatScrollState {
  return {
    sessionEpoch,
    mode: 'restoring',
    userOwned: false,
    nearBottom: true,
    activeGesture: false,
    lastCommittedRequestId: 0,
    resumeUserOwnedAfterNavigation: false,
    hasExplicitNavigation: false
  }
}

export function reduceChatScrollState(
  state: ChatScrollState,
  event: ChatScrollEvent
): ChatScrollState {
  switch (event.type) {
    case 'begin-session':
      return createChatScrollState(event.sessionEpoch)
    case 'user-gesture-start':
      return {
        ...state,
        mode: 'reading',
        userOwned: true,
        activeGesture: true,
        resumeUserOwnedAfterNavigation: false
      }
    case 'user-gesture-end':
      return { ...state, activeGesture: false }
    case 'bottom-proximity-changed':
      return { ...state, nearBottom: event.nearBottom }
    case 'return-to-bottom':
    case 'submit-started':
      return {
        ...state,
        mode: 'following',
        userOwned: false,
        nearBottom: true,
        resumeUserOwnedAfterNavigation: false
      }
    case 'explicit-navigation-start':
      return {
        ...state,
        mode: 'navigating',
        resumeUserOwnedAfterNavigation: state.resumeUserOwnedAfterNavigation || state.userOwned,
        userOwned: false,
        hasExplicitNavigation: true
      }
    case 'explicit-navigation-complete':
      return {
        ...state,
        mode: state.resumeUserOwnedAfterNavigation ? 'reading' : 'following',
        userOwned: state.resumeUserOwnedAfterNavigation,
        resumeUserOwnedAfterNavigation: false
      }
    case 'history-preservation-start':
      if (state.activeGesture) return state
      return { ...state, mode: 'history-preserving' }
    case 'history-preservation-complete':
      return { ...state, mode: state.userOwned ? 'reading' : 'following' }
    case 'restore-requested':
      return state.userOwned ? state : { ...state, mode: 'restoring' }
    case 'restore-complete':
      return state.userOwned ? state : { ...state, mode: 'following', nearBottom: true }
    case 'request-committed':
      return { ...state, lastCommittedRequestId: event.requestId }
    case 'stream-updated':
    case 'viewport-resized':
    case 'measurements-committed':
      return state
  }
}

export function getChatScrollRequestPriority(reason: ChatScrollReason): number {
  switch (reason) {
    case 'user-return-to-bottom':
    case 'search-navigation':
    case 'spotlight-navigation':
      return 100
    case 'submit':
      return 90
    case 'history-prepend':
      return 80
    case 'session-restore':
      return 70
    case 'auto-follow':
      return 60
    case 'measurement-anchor':
      return 50
  }
}

export function canAcceptChatScrollRequest(
  state: ChatScrollState,
  reason: ChatScrollReason
): boolean {
  switch (reason) {
    case 'search-navigation':
    case 'spotlight-navigation':
    case 'user-return-to-bottom':
    case 'submit':
      return true
    case 'session-restore':
      // A restore that lands after the user already jumped somewhere (search,
      // spotlight) must not yank the viewport back to the bottom.
      return (
        !state.userOwned &&
        !state.hasExplicitNavigation &&
        (state.mode === 'restoring' || state.mode === 'following')
      )
    case 'auto-follow':
      return !state.userOwned && (state.mode === 'restoring' || state.mode === 'following')
    case 'history-prepend':
      return (
        !state.activeGesture &&
        state.userOwned &&
        (state.mode === 'reading' || state.mode === 'history-preserving')
      )
    case 'measurement-anchor':
      return !state.activeGesture && state.userOwned && state.mode === 'reading'
  }
}
