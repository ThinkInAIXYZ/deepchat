import { describe, expect, it, vi } from 'vitest'

describe('initAppStores', () => {
  it('restores model and ollama store initialization after critical stores are ready', async () => {
    vi.resetModules()

    const pendingWarmup = () => new Promise<never>(() => {})
    const scheduleStartupDeferredTask = vi.fn((task: () => void | Promise<void>) => {
      void task()
      return () => {}
    })
    const callOrder: string[] = []
    const uiSettingsStore = {
      loadSettings: vi.fn(async () => {
        callOrder.push('loadSettings')
      })
    }
    const providerStore = {
      initialize: vi.fn(async () => {
        callOrder.push('providerInitialize')
      })
    }
    const modelStore = {
      initialize: vi.fn(() => {
        callOrder.push('modelInitialize')
        return pendingWarmup()
      })
    }
    const ollamaStore = {
      initialize: vi.fn(() => {
        callOrder.push('ollamaInitialize')
        return pendingWarmup()
      })
    }

    vi.doMock('@/stores/uiSettingsStore', () => ({
      useUiSettingsStore: () => uiSettingsStore
    }))
    vi.doMock('@/stores/providerStore', () => ({
      useProviderStore: () => providerStore
    }))
    vi.doMock('@/stores/modelStore', () => ({
      useModelStore: () => modelStore
    }))
    vi.doMock('@/stores/ollamaStore', () => ({
      useOllamaStore: () => ollamaStore
    }))
    vi.doMock('@/stores/mcp', () => ({
      useMcpStore: () => ({})
    }))
    vi.doMock('vue-router', () => ({
      useRouter: () => ({})
    }))
    vi.doMock('@/lib/ipcSubscription', () => ({
      createIpcSubscriptionScope: () => ({
        on: vi.fn(),
        cleanup: vi.fn()
      })
    }))
    vi.doMock('@/events', () => ({
      DEEPLINK_EVENTS: {
        MCP_INSTALL: 'mcp-install'
      }
    }))
    vi.doMock('@/lib/startupDeferred', () => ({
      scheduleStartupDeferredTask
    }))

    const { initAppStores } = await import('@/lib/storeInitializer')

    await initAppStores()

    expect(callOrder).toEqual([
      'loadSettings',
      'providerInitialize',
      'modelInitialize',
      'ollamaInitialize'
    ])
    expect(modelStore.initialize).toHaveBeenCalledTimes(1)
    expect(ollamaStore.initialize).toHaveBeenCalledTimes(1)
    expect(scheduleStartupDeferredTask).toHaveBeenCalledTimes(1)
  })
})
