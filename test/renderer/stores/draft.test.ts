import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('draft store generation settings', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('pinia', async () => {
      const actual = await vi.importActual<typeof import('pinia')>('pinia')
      return actual
    })
  })

  it('includes topP overrides in new session input', async () => {
    const { setActivePinia, createPinia } = await import('pinia')
    setActivePinia(createPinia())
    const { useDraftStore } = await import('@/stores/ui/draft')
    const draftStore = useDraftStore()

    draftStore.updateGenerationSettings({ topP: 0.72 })

    expect(draftStore.toCreateInput('hello').generationSettings).toEqual({ topP: 0.72 })
  })

  it('omits topP after clearing the override', async () => {
    const { setActivePinia, createPinia } = await import('pinia')
    setActivePinia(createPinia())
    const { useDraftStore } = await import('@/stores/ui/draft')
    const draftStore = useDraftStore()

    draftStore.updateGenerationSettings({ topP: 0.72 })
    draftStore.updateGenerationSettings({ topP: undefined })

    expect(draftStore.toCreateInput('hello').generationSettings).toBeUndefined()
  })
})
