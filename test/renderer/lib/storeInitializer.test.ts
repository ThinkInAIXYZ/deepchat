import { describe, expect, it, vi } from 'vitest'

describe('initAppStores', () => {
  it('only initializes cheap startup stores and connects workload tracking', async () => {
    vi.resetModules()

    const callOrder: string[] = []
    const startupWorkloadStore = {
      connect: vi.fn(() => {
        callOrder.push('workloadConnect')
      })
    }
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
    vi.doMock('@/stores/uiSettingsStore', () => ({
      useUiSettingsStore: () => uiSettingsStore
    }))
    vi.doMock('@/stores/providerStore', () => ({
      useProviderStore: () => providerStore
    }))
    vi.doMock('@/stores/startupWorkloadStore', () => ({
      useStartupWorkloadStore: () => startupWorkloadStore
    }))
    vi.doMock('@/stores/modelStore', () => ({
      useModelStore: () => ({})
    }))
    vi.doMock('@/stores/ollamaStore', () => ({
      useOllamaStore: () => ({})
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

    const { initAppStores } = await import('@/lib/storeInitializer')

    await initAppStores()

    expect(callOrder).toEqual(['workloadConnect', 'loadSettings', 'providerInitialize'])
    expect(startupWorkloadStore.connect).toHaveBeenCalledTimes(1)
  })
})
