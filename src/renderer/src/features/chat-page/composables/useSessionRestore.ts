import type { useMessageStore } from '@/stores/ui/message'
import type { useSessionStore } from '@/stores/ui/session'
import type { usePendingInputStore } from '@/stores/ui/pendingInput'
import { scheduleStartupDeferredTask } from '@/lib/startupDeferred'

type MessageStore = ReturnType<typeof useMessageStore>
type SessionStore = ReturnType<typeof useSessionStore>
type PendingInputStore = ReturnType<typeof usePendingInputStore>

type UseSessionRestoreOptions = {
  sessionId: () => string
  messageStore: MessageStore
  sessionStore: SessionStore
  pendingInputStore: PendingInputStore
  /** How many messages the initial restore of a session fetches. */
  initialRestoreCount: number
  /** Fired when pending inputs finish loading while the restore is still current. */
  onSecondaryStateReady: (sessionId: string) => void
}

/**
 * Owns the session-restore epoch. Every async write into the session view must
 * capture `currentRestoreRequestId()` before its first await and re-check via
 * `canWriteSessionView` after each one; `beginSessionChange` / `deactivate`
 * bump the epoch so captured tokens from a previous session (or an unmounted
 * page) can never win the race. The first restore after startup is deferred
 * until the window is idle; later session switches restore immediately.
 */
export function useSessionRestore(options: UseSessionRestoreOptions) {
  const { messageStore, sessionStore, pendingInputStore } = options

  let restoreRequestId = 0
  let isViewActive = true
  let cancelScheduledRestore: (() => void) | null = null
  let hasScheduledInitialRestore = false

  const applyRestoredSessionSummary = (session: unknown) => {
    const applyRestoredSession = (
      sessionStore as typeof sessionStore & {
        applyRestoredSession?: (session: unknown) => void
      }
    ).applyRestoredSession

    if (typeof applyRestoredSession === 'function') {
      applyRestoredSession(session)
    }
  }

  async function loadMessagesForSession(sessionId: string, count?: number) {
    const restoredSession = await messageStore.loadMessages(sessionId, count)
    return restoredSession
  }

  async function restoreSessionMessages(id: string, requestId: number) {
    console.info(`[Startup][Renderer] ChatPage restoring session ${id}`)
    const pendingInputsPromise = pendingInputStore.loadPendingInputs(id)
    const restoredSession = await loadMessagesForSession(id, options.initialRestoreCount)

    if (requestId !== restoreRequestId) {
      return
    }

    if (restoredSession !== null) {
      applyRestoredSessionSummary(restoredSession)
    }
    void pendingInputsPromise.then(() => {
      if (requestId === restoreRequestId) {
        options.onSecondaryStateReady(id)
      }
    })
  }

  function currentRestoreRequestId(): number {
    return restoreRequestId
  }

  function canWriteSessionView(sessionId: string, requestId: number): boolean {
    return (
      isViewActive &&
      restoreRequestId === requestId &&
      options.sessionId() === sessionId &&
      messageStore.currentSessionId === sessionId &&
      messageStore.committedSessionId === sessionId
    )
  }

  /** Invalidates in-flight restores and drops any still-deferred restore task. */
  function beginSessionChange(): void {
    restoreRequestId += 1
    cancelScheduledRestore?.()
    cancelScheduledRestore = null
  }

  function scheduleRestore(id: string): void {
    const requestId = restoreRequestId
    const runRestore = () => restoreSessionMessages(id, requestId)
    if (!hasScheduledInitialRestore) {
      hasScheduledInitialRestore = true
      cancelScheduledRestore = scheduleStartupDeferredTask(runRestore)
    } else {
      void runRestore()
    }
  }

  /** Unmount path: closes the write gate for every captured token. */
  function deactivate(): void {
    isViewActive = false
    restoreRequestId += 1
    cancelScheduledRestore?.()
    cancelScheduledRestore = null
  }

  return {
    applyRestoredSessionSummary,
    loadMessagesForSession,
    currentRestoreRequestId,
    canWriteSessionView,
    beginSessionChange,
    scheduleRestore,
    deactivate
  }
}
