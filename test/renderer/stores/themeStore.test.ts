import { beforeEach, describe, expect, it, vi } from 'vitest'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const setupStore = async () => {
  vi.resetModules()

  const themeListeners: Array<
    (payload: { theme: 'dark' | 'light' | 'system'; isDark: boolean }) => void
  > = []
  const systemThemeListeners: Array<(payload: { isDark: boolean }) => void> = []
  const snapshot = deferred<{ theme: 'dark' | 'light' | 'system'; isDark: boolean }>()
  const configClient = {
    getThemeState: vi.fn(() => snapshot.promise),
    setTheme: vi.fn().mockResolvedValue(false),
    onThemeChanged: vi.fn((listener) => {
      themeListeners.push(listener)
      return () => undefined
    }),
    onSystemThemeChanged: vi.fn((listener) => {
      systemThemeListeners.push(listener)
      return () => undefined
    })
  }

  vi.doMock('pinia', () => ({
    defineStore: (_id: string, setup: () => unknown) => setup
  }))
  vi.doMock('@vueuse/core', () => ({
    useDark: () => ({ value: false }),
    useToggle: (state: { value: boolean }) => (value: boolean) => {
      state.value = value
    }
  }))
  vi.doMock('vue', () => ({
    ref: <T>(value: T) => ({ value }),
    onScopeDispose: () => undefined
  }))
  vi.doMock('../../../src/renderer/api/ConfigClient', () => ({
    createConfigClient: vi.fn(() => configClient)
  }))

  const { useThemeStore } = await import('@/stores/theme')
  return {
    store: useThemeStore() as ReturnType<typeof useThemeStore>,
    configClient,
    snapshot,
    emitTheme: (payload: { theme: 'dark' | 'light' | 'system'; isDark: boolean }) => {
      for (const listener of themeListeners) listener(payload)
    },
    emitSystemTheme: (payload: { isDark: boolean }) => {
      for (const listener of systemThemeListeners) listener(payload)
    }
  }
}

describe('theme store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers listeners before the initial snapshot and does not let it overwrite newer events', async () => {
    const { store, configClient, snapshot, emitTheme, emitSystemTheme } = await setupStore()

    expect(configClient.onThemeChanged).toHaveBeenCalledTimes(1)
    expect(configClient.onSystemThemeChanged).toHaveBeenCalledTimes(1)
    expect(configClient.getThemeState).toHaveBeenCalledTimes(1)

    emitTheme({ theme: 'dark', isDark: true })
    emitTheme({ theme: 'light', isDark: false })
    emitSystemTheme({ isDark: true })
    snapshot.resolve({ theme: 'system', isDark: true })
    await store.initTheme()

    expect(store.themeMode.value).toBe('light')
    expect(store.isDark.value).toBe(false)
  })

  it('uses the user-theme event payload instead of a follow-up snapshot read', async () => {
    const { store, snapshot, emitTheme } = await setupStore()

    snapshot.resolve({ theme: 'system', isDark: false })
    await store.initTheme()
    emitTheme({ theme: 'dark', isDark: true })

    expect(store.themeMode.value).toBe('dark')
    expect(store.isDark.value).toBe(true)
  })
})
