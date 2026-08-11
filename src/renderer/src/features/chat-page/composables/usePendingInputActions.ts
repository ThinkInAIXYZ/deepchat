import type { ComputedRef } from 'vue'
import type { usePendingInputStore } from '@/stores/ui/pendingInput'
import type { RendererNotificationNotifier } from '@renderer-notifications/rendererNotificationPort'

type PendingInputStore = ReturnType<typeof usePendingInputStore>

type UsePendingInputActionsOptions = {
  sessionId: () => string
  isReadOnlySession: ComputedRef<boolean>
  isGenerating: ComputedRef<boolean>
  isAcpWorkdirMissing: ComputedRef<boolean>
  hasBlockingInteraction: () => boolean
  pendingInputStore: PendingInputStore
  beginPlanTurn: (sessionId: string) => void
  notify: RendererNotificationNotifier
  t: (key: string) => string
}

/**
 * Owns operations on already-queued composer input. It intentionally stays
 * separate from useComposerSubmit, which owns creating new drafts and submit
 * dispatch, so queue-item mutations retain a narrow dependency surface.
 */
export function usePendingInputActions(options: UsePendingInputActionsOptions) {
  async function onPendingInputUpdate(payload: { itemId: string; text: string }) {
    if (options.isReadOnlySession.value) return

    const target = options.pendingInputStore.queueItems.find((item) => item.id === payload.itemId)
    if (!target) {
      return
    }

    await options.pendingInputStore.updateQueueInput(options.sessionId(), payload.itemId, {
      text: payload.text,
      files: target.payload.files ?? [],
      search: target.payload.search === true,
      activeSkills: target.payload.activeSkills ?? [],
      inlineItems: target.payload.inlineItems ?? [],
      attachmentFallbackPolicy: target.payload.attachmentFallbackPolicy
    })
  }

  async function onPendingInputMove(payload: { itemId: string; toIndex: number }) {
    if (options.isReadOnlySession.value) return
    await options.pendingInputStore.moveQueueInput(
      options.sessionId(),
      payload.itemId,
      payload.toIndex
    )
  }

  async function onPendingInputDelete(itemId: string) {
    if (options.isReadOnlySession.value) return
    await options.pendingInputStore.deleteInput(options.sessionId(), itemId)
  }

  async function onPendingInputSteer(itemId: string) {
    if (options.isReadOnlySession.value) return
    if (!options.isGenerating.value) return
    if (options.isAcpWorkdirMissing.value) return
    if (options.hasBlockingInteraction()) return

    const sessionId = options.sessionId()
    try {
      await options.pendingInputStore.steerPendingInput(sessionId, itemId)
      options.beginPlanTurn(sessionId)
    } catch (error) {
      console.error('[ChatPage] steer queued input failed:', error)
      options.notify({
        kind: 'error',
        code: 'chat.pendingInput.steerFailed',
        title: options.t('chat.pendingInput.steerFailed')
      })
    }
  }

  async function onPendingInputResume() {
    if (options.isReadOnlySession.value || options.isGenerating.value) return
    if (options.hasBlockingInteraction()) return
    if (options.pendingInputStore.queueItems.some((item) => item.state === 'blocked')) return

    const sessionId = options.sessionId()
    try {
      const started = await options.pendingInputStore.resumeQueue(sessionId)
      if (started) {
        options.beginPlanTurn(sessionId)
      }
    } catch (error) {
      console.error('[ChatPage] resume queued inputs failed:', error)
      options.notify({
        kind: 'error',
        code: 'chat.pendingInput.resumeFailed',
        title: options.t('chat.pendingInput.resumeFailed')
      })
    }
  }

  async function onPendingInputRetry(itemId: string) {
    if (options.isReadOnlySession.value) return
    const target = options.pendingInputStore.queueItems.find((item) => item.id === itemId)
    if (target?.state !== 'retry_required') return

    const sessionId = options.sessionId()
    try {
      const result = await options.pendingInputStore.retryQueueInput(sessionId, itemId)
      if (result.started) {
        options.beginPlanTurn(sessionId)
      }
    } catch (error) {
      console.error('[ChatPage] retry queued input failed:', error)
      options.notify({
        kind: 'error',
        code: 'chat.pendingInput.retryFailed',
        title: options.t('chat.pendingInput.retryFailed')
      })
    }
  }

  async function onPendingInputResolve(payload: {
    itemId: string
    action: 'retry' | 'send_without_image_content'
  }) {
    if (options.isReadOnlySession.value) return
    const target = options.pendingInputStore.items.find((item) => item.id === payload.itemId)
    if (!target || target.state !== 'blocked') {
      return
    }

    try {
      await options.pendingInputStore.resolveBlockedInput(
        options.sessionId(),
        payload.itemId,
        payload.action
      )
    } catch (error) {
      console.error('[ChatPage] resolve blocked input failed:', error)
      options.notify({
        kind: 'error',
        code: 'chat.pendingInput.resolveFailed',
        title: options.t('chat.attachments.pending.resolveFailed')
      })
    }
  }

  return {
    onPendingInputUpdate,
    onPendingInputMove,
    onPendingInputDelete,
    onPendingInputSteer,
    onPendingInputResume,
    onPendingInputRetry,
    onPendingInputResolve
  }
}
