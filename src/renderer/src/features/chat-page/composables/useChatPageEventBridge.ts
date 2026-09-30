import type { ComputedRef, Ref } from 'vue'

type ChatInputHandle = {
  insertWorkspaceReference?: (targetPath: string) => boolean
}

type UseChatPageEventBridgeOptions = {
  sessionId: () => string
  isReadOnlySession: ComputedRef<boolean>
  chatInputRef: Ref<ChatInputHandle | null>
  setMessage: (text: string) => void
  onWindowKeydown: (event: KeyboardEvent) => void
  workspaceInsertReferenceEvent: string
}

/**
 * Owns the global event subscriptions that bridge ChatPage-local state to
 * browser events. Lifecycle stays explicit so ChatPage retains its
 * established mount/unmount ordering around viewport setup.
 */
export function useChatPageEventBridge(options: UseChatPageEventBridgeOptions) {
  let started = false

  const onContextMenuAskAI = (event: Event) => {
    if (options.isReadOnlySession.value) {
      return
    }

    const detail = (event as CustomEvent<string>).detail
    const text = typeof detail === 'string' ? detail.trim() : ''
    if (!text) {
      return
    }

    options.setMessage(text)
  }

  const onWorkspaceInsertReferenceRequested = (event: Event) => {
    if (options.isReadOnlySession.value) {
      return
    }

    const detail = (event as CustomEvent<{ sessionId?: unknown; filePath?: unknown }>).detail
    const sessionId = typeof detail?.sessionId === 'string' ? detail.sessionId.trim() : ''
    const filePath = typeof detail?.filePath === 'string' ? detail.filePath.trim() : ''
    if (sessionId !== options.sessionId() || !filePath) {
      return
    }

    options.chatInputRef.value?.insertWorkspaceReference?.(filePath)
  }

  function start() {
    if (started) {
      return
    }

    started = true
    window.addEventListener('context-menu-ask-ai', onContextMenuAskAI)
    window.addEventListener(
      options.workspaceInsertReferenceEvent,
      onWorkspaceInsertReferenceRequested
    )
    window.addEventListener('keydown', options.onWindowKeydown)
  }

  function stop() {
    if (!started) {
      return
    }

    started = false
    window.removeEventListener('context-menu-ask-ai', onContextMenuAskAI)
    window.removeEventListener(
      options.workspaceInsertReferenceEvent,
      onWorkspaceInsertReferenceRequested
    )
    window.removeEventListener('keydown', options.onWindowKeydown)
  }

  return { start, stop }
}
