import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

const refetch = vi.hoisted(() => vi.fn())

vi.mock('pinia', async () => vi.importActual<typeof import('pinia')>('pinia'))
vi.mock('@/composables/useIpcQuery', () => ({
  useIpcQuery: () => ({
    data: computed(() => []),
    refetch
  })
}))
vi.mock('@/composables/useIpcMutation', () => ({
  useIpcMutation: () => ({
    mutateAsync: vi.fn()
  })
}))
vi.mock('../../../src/renderer/api/ConfigClient', () => ({
  createConfigClient: () => ({})
}))

describe('prompts store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    refetch.mockReset()
  })

  it('returns the canonical refetch payload and requests error propagation', async () => {
    const prompts = [{ id: 'prompt-1', name: 'Writer', description: '' }]
    refetch.mockResolvedValue({
      status: 'success',
      data: prompts,
      error: null
    })
    const { usePromptsStore } = await import('../../../src/renderer/src/stores/prompts')

    await expect(usePromptsStore().loadPrompts()).resolves.toEqual(prompts)
    expect(refetch).toHaveBeenCalledWith(true)
  })

  it('does not turn a failed canonical load into an empty writable list', async () => {
    const failure = new Error('load failed')
    refetch.mockRejectedValue(failure)
    const { usePromptsStore } = await import('../../../src/renderer/src/stores/prompts')

    await expect(usePromptsStore().loadPrompts()).rejects.toBe(failure)
  })
})
