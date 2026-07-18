import type { ComputedRef } from 'vue'
import type { usePendingInputStore } from '@/stores/ui/pendingInput'

type PendingInputStore = ReturnType<typeof usePendingInputStore>

type ToastFn = (options: {
  title: string
  description?: string
  variant?: 'destructive'
}) => unknown

type UsePendingInputActionsOptions = {
  sessionId: () => string
  isReadOnlySession: ComputedRef<boolean>
  isGenerating: ComputedRef<boolean>
  isAcpWorkdirMissing: ComputedRef<boolean>
  hasBlockingInteraction: () => boolean
  pendingInputStore: PendingInputStore
  beginPlanTurn: (sessionId: string) => void
  toast: ToastFn
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
      activeSkills: target.payload.activeSkills ?? [],
      inlineItems: target.payload.inlineItems ?? []
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
      options.toast({
        title: options.t('chat.pendingInput.steerFailed'),
        variant: 'destructive'
      })
    }
  }

  return {
    onPendingInputUpdate,
    onPendingInputMove,
    onPendingInputDelete,
    onPendingInputSteer
  }
}
