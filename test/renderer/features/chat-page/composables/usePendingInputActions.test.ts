import { computed, effectScope, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePendingInputActions } from '@/features/chat-page/composables/usePendingInputActions'

function createHarness() {
  const sessionId = ref('s1')
  const isReadOnly = ref(false)
  const isGenerating = ref(true)
  const isAcpWorkdirMissing = ref(false)
  const isBlocking = ref(false)
  const pendingInputStore = {
    items: [
      {
        id: 'blocked-1',
        state: 'blocked',
        payload: { text: '', files: [] }
      }
    ],
    queueItems: [
      {
        id: 'item-1',
        payload: {
          text: 'draft',
          files: [{ name: 'file.txt' }],
          search: true,
          activeSkills: ['skill-a'],
          inlineItems: [{ type: 'file', path: 'workspace://file.txt' }]
        }
      }
    ],
    updateQueueInput: vi.fn().mockResolvedValue(undefined),
    moveQueueInput: vi.fn().mockResolvedValue(undefined),
    deleteInput: vi.fn().mockResolvedValue(undefined),
    steerPendingInput: vi.fn().mockResolvedValue(undefined),
    resolveBlockedInput: vi.fn().mockResolvedValue(undefined)
  }
  const beginPlanTurn = vi.fn()
  const notify = vi.fn()
  const scope = effectScope()
  let actions!: ReturnType<typeof usePendingInputActions>

  scope.run(() => {
    actions = usePendingInputActions({
      sessionId: () => sessionId.value,
      isReadOnlySession: computed(() => isReadOnly.value),
      isGenerating: computed(() => isGenerating.value),
      isAcpWorkdirMissing: computed(() => isAcpWorkdirMissing.value),
      hasBlockingInteraction: () => isBlocking.value,
      pendingInputStore: pendingInputStore as any,
      beginPlanTurn,
      notify,
      t: (key) => key
    })
  })

  return {
    actions,
    sessionId,
    isReadOnly,
    isGenerating,
    isAcpWorkdirMissing,
    isBlocking,
    pendingInputStore,
    beginPlanTurn,
    notify,
    stop: () => scope.stop()
  }
}

describe('usePendingInputActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates an existing queue item without dropping files, search, or skills', async () => {
    const harness = createHarness()

    await harness.actions.onPendingInputUpdate({ itemId: 'item-1', text: 'updated' })

    expect(harness.pendingInputStore.updateQueueInput).toHaveBeenCalledWith('s1', 'item-1', {
      text: 'updated',
      files: [{ name: 'file.txt' }],
      search: true,
      activeSkills: ['skill-a'],
      inlineItems: [{ type: 'file', path: 'workspace://file.txt' }]
    })

    await harness.actions.onPendingInputUpdate({ itemId: 'missing', text: 'ignored' })
    expect(harness.pendingInputStore.updateQueueInput).toHaveBeenCalledTimes(1)
    harness.stop()
  })

  it('delegates move and delete only when writable', async () => {
    const harness = createHarness()

    await harness.actions.onPendingInputMove({ itemId: 'item-1', toIndex: 2 })
    await harness.actions.onPendingInputDelete('item-1')
    expect(harness.pendingInputStore.moveQueueInput).toHaveBeenCalledWith('s1', 'item-1', 2)
    expect(harness.pendingInputStore.deleteInput).toHaveBeenCalledWith('s1', 'item-1')

    harness.isReadOnly.value = true
    await harness.actions.onPendingInputMove({ itemId: 'item-1', toIndex: 3 })
    await harness.actions.onPendingInputDelete('item-1')
    expect(harness.pendingInputStore.moveQueueInput).toHaveBeenCalledTimes(1)
    expect(harness.pendingInputStore.deleteInput).toHaveBeenCalledTimes(1)
    harness.stop()
  })

  it('keeps queued-input steering and plan state bound to one session', async () => {
    const harness = createHarness()
    let resolveSteer!: () => void
    harness.pendingInputStore.steerPendingInput.mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveSteer = resolve))
    )

    const steer = harness.actions.onPendingInputSteer('item-1')
    await vi.waitFor(() =>
      expect(harness.pendingInputStore.steerPendingInput).toHaveBeenCalledTimes(1)
    )
    harness.sessionId.value = 's2'
    resolveSteer()
    await steer

    expect(harness.pendingInputStore.steerPendingInput).toHaveBeenCalledWith('s1', 'item-1')
    expect(harness.beginPlanTurn).toHaveBeenCalledWith('s1')
    harness.stop()
  })

  it('steers only after all gates pass and preserves plan state on failure', async () => {
    const harness = createHarness()

    harness.isGenerating.value = false
    await harness.actions.onPendingInputSteer('item-1')
    expect(harness.pendingInputStore.steerPendingInput).not.toHaveBeenCalled()

    harness.isGenerating.value = true
    harness.isAcpWorkdirMissing.value = true
    await harness.actions.onPendingInputSteer('item-1')
    expect(harness.pendingInputStore.steerPendingInput).not.toHaveBeenCalled()

    harness.isAcpWorkdirMissing.value = false
    harness.isBlocking.value = true
    await harness.actions.onPendingInputSteer('item-1')
    expect(harness.pendingInputStore.steerPendingInput).not.toHaveBeenCalled()

    harness.isBlocking.value = false
    await harness.actions.onPendingInputSteer('item-1')
    expect(harness.pendingInputStore.steerPendingInput).toHaveBeenCalledWith('s1', 'item-1')
    expect(harness.beginPlanTurn).toHaveBeenCalledWith('s1')

    const error = new Error('steer failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    harness.pendingInputStore.steerPendingInput.mockRejectedValueOnce(error)
    await harness.actions.onPendingInputSteer('item-1')

    expect(harness.notify).toHaveBeenCalledWith({
      kind: 'error',
      code: 'chat.pendingInput.steerFailed',
      title: 'chat.pendingInput.steerFailed'
    })
    expect(harness.beginPlanTurn).toHaveBeenCalledTimes(1)
    consoleError.mockRestore()
    harness.stop()
  })

  it('resolves only blocked items and reports mutation failures', async () => {
    const harness = createHarness()

    await harness.actions.onPendingInputResolve({
      itemId: 'blocked-1',
      action: 'send_without_image_content'
    })
    expect(harness.pendingInputStore.resolveBlockedInput).toHaveBeenCalledWith(
      's1',
      'blocked-1',
      'send_without_image_content'
    )

    await harness.actions.onPendingInputResolve({ itemId: 'missing', action: 'retry' })
    expect(harness.pendingInputStore.resolveBlockedInput).toHaveBeenCalledTimes(1)

    const error = new Error('resolve failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    harness.pendingInputStore.resolveBlockedInput.mockRejectedValueOnce(error)
    await harness.actions.onPendingInputResolve({ itemId: 'blocked-1', action: 'retry' })

    expect(harness.notify).toHaveBeenCalledWith({
      kind: 'error',
      code: 'chat.pendingInput.resolveFailed',
      title: 'chat.attachments.pending.resolveFailed'
    })
    consoleError.mockRestore()
    harness.stop()
  })
})
