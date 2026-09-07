import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RendererLanguageState } from '@/i18n/bootstrap'
import type { RendererLocaleMessages } from '@/i18n'

vi.mock('pinia', async () => vi.importActual('pinia'))
vi.mock('vue-i18n', async () => vi.importActual('vue-i18n'))

const languageMocks = vi.hoisted(() => ({
  getLanguageState: vi.fn(),
  setLanguage: vi.fn(),
  onLanguageChanged: vi.fn(),
  loadLocaleMessages: vi.fn(),
  listener: undefined as ((state: RendererLanguageState) => void) | undefined,
  removeListener: vi.fn()
}))

vi.mock('@api/ConfigClient', () => ({
  createConfigClient: () => ({
    getLanguageState: languageMocks.getLanguageState,
    setLanguage: languageMocks.setLanguage,
    onLanguageChanged: languageMocks.onLanguageChanged
  })
}))

vi.mock('@/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n')>()
  return {
    ...actual,
    loadLocaleMessages: languageMocks.loadLocaleMessages
  }
})

import { useLanguageStore } from '@/stores/language'

const ENGLISH_STATE: RendererLanguageState = {
  requestedLanguage: 'en-US',
  locale: 'en-US',
  direction: 'auto'
}

const createMessages = (locale: string): RendererLocaleMessages => ({
  common: {
    locale
  }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function mountLanguageStore() {
  const pinia = createPinia()
  const i18n = createI18n({
    legacy: false,
    locale: 'en-US',
    fallbackLocale: 'en-US',
    messages: {
      'en-US': createMessages('en-US')
    }
  })
  let store!: ReturnType<typeof useLanguageStore>

  const Harness = defineComponent({
    setup() {
      store = useLanguageStore()
      return () => h('div')
    }
  })

  const wrapper = mount(Harness, {
    global: {
      plugins: [pinia, i18n]
    }
  })

  return { i18n, store, wrapper }
}

describe('language store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    languageMocks.listener = undefined
    languageMocks.getLanguageState.mockResolvedValue(ENGLISH_STATE)
    languageMocks.setLanguage.mockImplementation(async (language: string) => ({
      requestedLanguage: language,
      locale: language,
      direction: language === 'fa-IR' || language === 'he-IL' ? 'rtl' : 'auto'
    }))
    languageMocks.loadLocaleMessages.mockImplementation(async (locale: string) =>
      createMessages(locale)
    )
    languageMocks.onLanguageChanged.mockImplementation(
      (listener: (state: RendererLanguageState) => void) => {
        languageMocks.listener = listener
        return languageMocks.removeListener
      }
    )
  })

  it('loads and registers the initial locale and cleans up its listener', async () => {
    languageMocks.getLanguageState.mockResolvedValue({
      requestedLanguage: 'fa-IR',
      locale: 'fa-IR',
      direction: 'rtl'
    })

    const { i18n, store, wrapper } = mountLanguageStore()
    await flushPromises()

    expect(languageMocks.loadLocaleMessages).toHaveBeenCalledWith('fa-IR')
    expect(i18n.global.getLocaleMessage('fa-IR')).toEqual(createMessages('fa-IR'))
    expect(i18n.global.locale.value).toBe('fa-IR')
    expect(store.language).toBe('fa-IR')
    expect(store.dir).toBe('rtl')

    wrapper.unmount()
    store.$dispose()
    expect(languageMocks.removeListener).toHaveBeenCalledOnce()
  })

  it('preserves system mode when the requested language is empty', async () => {
    languageMocks.getLanguageState.mockResolvedValue({
      requestedLanguage: '',
      locale: 'fr-FR',
      direction: 'auto'
    })

    const { i18n, store } = mountLanguageStore()
    await flushPromises()

    expect(i18n.global.locale.value).toBe('fr-FR')
    expect(store.language).toBe('system')
  })

  it('keeps the newest language event when an older load finishes later', async () => {
    const { i18n } = mountLanguageStore()
    await flushPromises()

    const frenchMessages = deferred<RendererLocaleMessages>()
    languageMocks.loadLocaleMessages.mockImplementation((locale: string) => {
      if (locale === 'fr-FR') return frenchMessages.promise
      return Promise.resolve(createMessages(locale))
    })

    languageMocks.listener?.({
      requestedLanguage: 'fr-FR',
      locale: 'fr-FR',
      direction: 'auto'
    })
    await Promise.resolve()
    expect(i18n.global.locale.value).toBe('en-US')

    languageMocks.listener?.({
      requestedLanguage: 'fa-IR',
      locale: 'fa-IR',
      direction: 'rtl'
    })
    await flushPromises()
    expect(i18n.global.locale.value).toBe('fa-IR')

    frenchMessages.resolve(createMessages('fr-FR'))
    await flushPromises()
    expect(i18n.global.locale.value).toBe('fa-IR')
  })

  it('ignores an older setLanguage response that resolves last', async () => {
    const { i18n, store } = mountLanguageStore()
    await flushPromises()

    const frenchState = deferred<RendererLanguageState>()
    const persianState = deferred<RendererLanguageState>()
    languageMocks.setLanguage.mockImplementation((language: string) =>
      language === 'fr-FR' ? frenchState.promise : persianState.promise
    )

    const frenchUpdate = store.updateLanguage('fr-FR')
    const persianUpdate = store.updateLanguage('fa-IR')

    persianState.resolve({
      requestedLanguage: 'fa-IR',
      locale: 'fa-IR',
      direction: 'rtl'
    })
    await persianUpdate

    frenchState.resolve({
      requestedLanguage: 'fr-FR',
      locale: 'fr-FR',
      direction: 'auto'
    })
    await frenchUpdate

    expect(i18n.global.locale.value).toBe('fa-IR')
    expect(store.language).toBe('fa-IR')
    expect(store.dir).toBe('rtl')
  })

  it('preserves an explicit ltr direction from the language state', async () => {
    const { store } = mountLanguageStore()
    await flushPromises()

    languageMocks.listener?.({
      requestedLanguage: 'en-US',
      locale: 'en-US',
      direction: 'ltr'
    })
    await flushPromises()

    expect(store.dir).toBe('ltr')
  })

  it('retries initial language initialization after a locale chunk fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    languageMocks.loadLocaleMessages
      .mockRejectedValueOnce(new Error('chunk unavailable'))
      .mockResolvedValueOnce(createMessages('en-US'))
    const { i18n, store } = mountLanguageStore()
    await flushPromises()

    expect(languageMocks.loadLocaleMessages).toHaveBeenCalledTimes(1)
    await store.initLanguage()

    expect(languageMocks.loadLocaleMessages).toHaveBeenCalledTimes(2)
    expect(i18n.global.locale.value).toBe('en-US')
    consoleError.mockRestore()
  })

  it('keeps the active locale when a new locale chunk fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { i18n, store } = mountLanguageStore()
    await flushPromises()

    languageMocks.loadLocaleMessages.mockRejectedValueOnce(new Error('chunk unavailable'))
    languageMocks.listener?.({
      requestedLanguage: 'fr-FR',
      locale: 'fr-FR',
      direction: 'auto'
    })
    await flushPromises()

    expect(i18n.global.locale.value).toBe('en-US')
    expect(store.language).toBe('en-US')
    expect(consoleError).toHaveBeenCalledWith('Failed to load locale fr-FR:', expect.any(Error))
    consoleError.mockRestore()
  })
})
