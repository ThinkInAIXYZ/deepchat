import { describe, expect, it, vi } from 'vitest'

describe('artifact store', () => {
  const setupArtifactStore = async () => {
    vi.resetModules()

    const sessionState = {
      selectedArtifactContext: null
    }
    const sidepanelStore = {
      open: true,
      activeTab: 'workspace',
      getSessionState: vi.fn(() => sessionState),
      selectArtifact: vi.fn((_sessionId: string, context: unknown) => {
        sessionState.selectedArtifactContext = context
      }),
      clearArtifact: vi.fn(),
      setViewMode: vi.fn()
    }

    vi.doMock('pinia', () => ({
      defineStore: (_id: string, setup: () => unknown) => setup
    }))

    vi.doMock('@/stores/ui/sidepanel', () => ({
      useSidepanelStore: () => sidepanelStore
    }))

    const { useArtifactStore } = await import('@/stores/artifact')
    return {
      store: useArtifactStore(),
      sidepanelStore
    }
  }

  it('does not force preview mode again for an already completed artifact context', async () => {
    const { store, sidepanelStore } = await setupArtifactStore()
    const artifact = {
      id: 'artifact-1',
      type: 'text/plain',
      title: 'Artifact',
      content: 'content',
      status: 'loaded' as const
    }

    store.showArtifact(artifact, 'message-1', 'thread-1', {
      open: false,
      viewMode: 'code'
    })

    store.completeArtifact(artifact, 'message-1', 'thread-1')
    expect(sidepanelStore.setViewMode).toHaveBeenCalledWith('thread-1', 'preview')

    sidepanelStore.setViewMode.mockClear()
    store.completeArtifact(artifact, 'message-1', 'thread-1')
    expect(sidepanelStore.setViewMode).not.toHaveBeenCalled()
  })
})
