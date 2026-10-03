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

  it('preserves explicit reasoning clears through creation without clearing untouched fields', async () => {
    const { setActivePinia, createPinia } = await import('pinia')
    setActivePinia(createPinia())
    const { useDraftStore } = await import('@/stores/ui/draft')
    const { CreateSessionInputSchema } = await import('@shared/contracts/routes/sessions.routes')
    const draftStore = useDraftStore()
    draftStore.providerId = 'dashscope'
    draftStore.modelId = 'qwen3.8-max'
    expect(draftStore.toCreateInput('hello').generationSettings).toBeUndefined()

    draftStore.updateGenerationSettings({ thinkingBudget: 8192 })
    expect(draftStore.toGenerationSettings()).toStrictEqual({ thinkingBudget: 8192 })
    draftStore.updateGenerationSettings({ thinkingBudget: undefined, reasoningEffort: undefined })
    const input = CreateSessionInputSchema.parse(structuredClone(draftStore.toCreateInput('hello')))
    expect(input.generationSettings).toStrictEqual({
      thinkingBudget: undefined,
      reasoningEffort: undefined
    })

    // A new model must inherit its own defaults, even when submitted in the same tick.
    draftStore.modelId = 'qwen3.8-flash'
    expect(draftStore.toGenerationSettings()).toBeUndefined()
    draftStore.updateGenerationSettings({ reasoningEffort: undefined })
    draftStore.resetGenerationSettings()
    expect(draftStore.toGenerationSettings()).toBeUndefined()
  })

  it('carries proactive policy into session creation and resets it to explicit', async () => {
    const { setActivePinia, createPinia } = await import('pinia')
    setActivePinia(createPinia())
    const { useDraftStore } = await import('@/stores/ui/draft')
    const draftStore = useDraftStore()

    draftStore.orchestrationPolicy = 'proactive'
    expect(draftStore.toCreateInput('hello').orchestrationPolicy).toBe('proactive')

    draftStore.reset()
    expect(draftStore.orchestrationPolicy).toBe('explicit')
  })
})
