import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProviderDeeplinkImportStore } from '@/stores/providerDeeplinkImport'

describe('providerDeeplinkImportStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('increments preview token for each provider deeplink preview', () => {
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
