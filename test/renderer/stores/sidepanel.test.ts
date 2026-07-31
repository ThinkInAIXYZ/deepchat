import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

describe('sidepanel store', () => {
  const setupSidepanelStore = async (innerWidth: number) => {
    vi.resetModules()
    vi.doUnmock('pinia')

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: innerWidth
    })

    const storageRef = ref(520)

    vi.doMock('@vueuse/core', () => ({
      useStorage: () => storageRef,
      useEventListener: (
        target: EventTarget,
        event: string,
        listener: EventListenerOrEventListenerObject
      ) => {
        target.addEventListener(event, listener)
        return () => target.removeEventListener(event, listener)
      }
    }))

    const { createPinia, setActivePinia } = await vi.importActual<typeof import('pinia')>('pinia')
    setActivePinia(createPinia())

    const { useSidepanelStore } = await import('@/stores/ui/sidepanel')
    return {
      store: useSidepanelStore(),
      storageRef
    }
  }

  it('clamps width to the resolved maximum on narrow viewports', async () => {
    const { store, storageRef } = await setupSidepanelStore(500)

    store.setWidth(640)
    expect(storageRef.value).toBe(310)
    expect(store.width).toBe(310)
  })

  it('reclamps width when the viewport shrinks', async () => {
    const { store, storageRef } = await setupSidepanelStore(1200)

    store.setWidth(640)
    expect(storageRef.value).toBe(640)

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 500
    })

    window.dispatchEvent(new Event('resize'))

    expect(storageRef.value).toBe(310)
    expect(store.width).toBe(310)
  })

  it('opens and expands the Workflow section for a session', async () => {
    const { store } = await setupSidepanelStore(1200)
    const sessionState = store.ensureSessionState('session-1')
    sessionState.sections.workflows = false
    store.openBrowser()

    store.openWorkflow('session-1', 'run-1')

    expect(store.open).toBe(true)
    expect(store.activeTab).toBe('workspace')
    expect(sessionState.sections.workflows).toBe(true)
    expect(sessionState.selectedWorkflowRunId).toBe('run-1')
  })

  it('keeps saved Workflow invocation requests until the matching consumer acknowledges them', async () => {
    const { store } = await setupSidepanelStore(1200)
    store.openBrowser()

    store.requestSavedWorkflow('session-1', ' review ', '  ')

    const sessionState = store.ensureSessionState('session-1')
    const request = sessionState.savedWorkflowInvocationRequest
    expect(store.open).toBe(true)
    expect(store.activeTab).toBe('workspace')
    expect(sessionState.sections.workflows).toBe(true)
    expect(request).toMatchObject({
      name: 'review',
      argsText: '{}'
    })

    store.consumeSavedWorkflowRequest('session-1', (request?.id ?? 0) + 1)
    expect(sessionState.savedWorkflowInvocationRequest).toEqual(request)

    store.consumeSavedWorkflowRequest('session-1', request!.id)
    expect(sessionState.savedWorkflowInvocationRequest).toBeNull()
  })
})
