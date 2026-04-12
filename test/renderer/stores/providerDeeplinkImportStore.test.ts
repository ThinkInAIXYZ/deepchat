import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('providerDeeplinkImportStore', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.doUnmock('pinia')
    const { createPinia, setActivePinia } = await vi.importActual<typeof import('pinia')>('pinia')
    setActivePinia(createPinia())
  })

  it('increments preview token for each provider deeplink preview', async () => {
    const { useProviderDeeplinkImportStore } = await import('@/stores/providerDeeplinkImport')
    const store = useProviderDeeplinkImportStore()
    const firstPreview = {
      kind: 'builtin' as const,
      id: 'deepseek',
      baseUrl: 'https://deepseek.example.com/v1',
      apiKey: 'sk-deepseek-demo-key',
      maskedApiKey: 'sk-d...-key',
      iconModelId: 'deepseek',
      willOverwrite: true
    }

    store.openPreview(firstPreview)
    const firstToken = store.previewToken

    store.openPreview(firstPreview)

    expect(firstToken).toBe(1)
    expect(store.previewToken).toBe(2)
    expect(store.preview).toEqual(firstPreview)
    expect(store.preview).not.toBe(firstPreview)
  })
})
