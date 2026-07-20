import { beforeEach, describe, expect, it, vi } from 'vitest'

const setupStore = async () => {
  vi.resetModules()

  const languageListeners: Array<
    (payload: {
      requestedLanguage: string
      locale: string
      direction: 'auto' | 'rtl' | 'ltr'
      version: number
    }) => void
  > = []
  const locale = { value: 'en-US' }
  const configClient = {
    getLanguageState: vi.fn().mockResolvedValue({
      requestedLanguage: 'system',
      locale: 'en-US',
      direction: 'auto'
    }),
    setLanguage: vi.fn().mockResolvedValue(undefined),
    onLanguageChanged: vi.fn((listener) => {
      languageListeners.push(listener)
      return () => undefined
    })
  }

  vi.doMock('pinia', () => ({
    defineStore: (_id: string, setup: () => unknown) => setup
  }))
  vi.doMock('vue', () => ({
    ref: <T>(value: T) => ({ value }),
    onMounted: () => undefined,
    onScopeDispose: () => undefined
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({ locale })
  }))
  vi.doMock('../../../src/renderer/api/ConfigClient', () => ({
    createConfigClient: vi.fn(() => configClient)
  }))

  const { useLanguageStore } = await import('@/stores/language')
  return {
    store: useLanguageStore() as ReturnType<typeof useLanguageStore>,
    configClient,
    emitLanguage: (payload: Parameters<(typeof languageListeners)[number]>[0]) => {
      for (const listener of languageListeners) listener(payload)
    }
  }
}

describe('language store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves an ltr direction supplied by the language IPC event', async () => {
    const { store, emitLanguage } = await setupStore()
    await store.initLanguage()

    emitLanguage({
      requestedLanguage: 'en-US',
      locale: 'en-US',
      direction: 'ltr',
      version: 1
    })

    expect(store.dir.value).toBe('ltr')
  })
})
