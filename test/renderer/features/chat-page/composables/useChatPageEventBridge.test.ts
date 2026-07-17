import { computed, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatPageEventBridge } from '@/features/chat-page/composables/useChatPageEventBridge'

function createHarness() {
  const sessionId = ref('s1')
  const isReadOnly = ref(false)
  const insertWorkspaceReference = vi.fn()
  const chatInputRef = ref({ insertWorkspaceReference })
  const setMessage = vi.fn()
  const onWindowKeydown = vi.fn()
  const onPlanUpdated = vi.fn()
  let planListener: ((payload: { sessionId: string }) => void) | null = null
  const unsubscribe = vi.fn(() => {
    planListener = null
  })
  const chatClient = {
    onPlanUpdated: vi.fn((listener) => {
      planListener = listener
      return unsubscribe
    })
  }
  const bridge = useChatPageEventBridge({
    sessionId: () => sessionId.value,
    isReadOnlySession: computed(() => isReadOnly.value),
    chatInputRef,
    setMessage,
    onWindowKeydown,
    onPlanUpdated,
    chatClient: chatClient as any,
    workspaceInsertReferenceEvent: 'workspace-insert-reference-requested'
  })

  return {
    bridge,
    sessionId,
    isReadOnly,
    insertWorkspaceReference,
    setMessage,
    onWindowKeydown,
    onPlanUpdated,
    chatClient,
    unsubscribe,
    emitPlanUpdated: (payload: { sessionId: string }) => planListener?.(payload)
  }
}

describe('useChatPageEventBridge', () => {
  let harness: ReturnType<typeof createHarness> | null = null

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    harness?.bridge.stop()
    harness = null
  })

  it('bridges validated global events using the latest session getter', () => {
    harness = createHarness()
    harness.bridge.start()

    window.dispatchEvent(new CustomEvent('context-menu-ask-ai', { detail: '  ask this  ' }))
    expect(harness.setMessage).toHaveBeenCalledWith('ask this')

    window.dispatchEvent(
      new CustomEvent('workspace-insert-reference-requested', {
        detail: { sessionId: 'other', filePath: '/ignored.ts' }
      })
    )
    expect(harness.insertWorkspaceReference).not.toHaveBeenCalled()

    harness.sessionId.value = 's2'
    window.dispatchEvent(
      new CustomEvent('workspace-insert-reference-requested', {
        detail: { sessionId: 's2', filePath: ' /active.ts ' }
      })
    )
    expect(harness.insertWorkspaceReference).toHaveBeenCalledWith('/active.ts')

    harness.isReadOnly.value = true
    window.dispatchEvent(new CustomEvent('context-menu-ask-ai', { detail: 'ignored' }))
    expect(harness.setMessage).toHaveBeenCalledTimes(1)
  })

  it('subscribes once and fully detaches global and plan listeners', () => {
    harness = createHarness()
    harness.bridge.start()
    harness.bridge.start()

    expect(harness.chatClient.onPlanUpdated).toHaveBeenCalledTimes(1)
    harness.emitPlanUpdated({ sessionId: 's1' })
    expect(harness.onPlanUpdated).toHaveBeenCalledWith({ sessionId: 's1' })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    expect(harness.onWindowKeydown).toHaveBeenCalledTimes(1)

    harness.bridge.stop()
    harness.bridge.stop()
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1)

    harness.emitPlanUpdated({ sessionId: 's2' })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    expect(harness.onPlanUpdated).toHaveBeenCalledTimes(1)
    expect(harness.onWindowKeydown).toHaveBeenCalledTimes(1)
  })
})
