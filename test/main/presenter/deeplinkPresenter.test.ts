import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NOTIFICATION_EVENTS, SETTINGS_EVENTS } from '@/events'

const presenterMock = vi.hoisted(() => ({
  windowPresenter: {
    createSettingsWindow: vi.fn().mockResolvedValue(9),
    sendToWindow: vi.fn(),
    getAllWindows: vi.fn().mockReturnValue([]),
    getFocusedWindow: vi.fn().mockReturnValue(null)
  },
  configPresenter: {
    getProviderById: vi.fn()
  },
  mcpPresenter: {
    isReady: vi.fn().mockReturnValue(true)
  }
}))

const eventBusMock = vi.hoisted(() => ({
  once: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  sendToRenderer: vi.fn()
}))

vi.mock('@/presenter', () => ({
  presenter: presenterMock
}))

vi.mock('@/eventbus', () => ({
  eventBus: eventBusMock,
  SendTarget: {
    ALL_WINDOWS: 'all_windows'
  }
}))

describe('DeeplinkPresenter provider install', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    presenterMock.windowPresenter.createSettingsWindow.mockResolvedValue(9)
    presenterMock.configPresenter.getProviderById.mockImplementation((providerId: string) => {
      if (providerId === 'openai') {
        return {
          id: 'openai',
          name: 'OpenAI',
          apiType: 'openai',
          apiKey: '',
          baseUrl: 'https://api.openai.com/v1',
          enable: false
        }
      }

      return undefined
    })
  })

  it('routes built-in provider imports to settings and sends preview payload', async () => {
    const { DeeplinkPresenter } = await import('@/presenter/deeplinkPresenter')
    const deeplinkPresenter = new DeeplinkPresenter()
    const payload = {
      id: 'openai',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk-import-1234'
    }
    const url = `deepchat://provider/install?v=1&data=${Buffer.from(JSON.stringify(payload)).toString('base64')}`

    await deeplinkPresenter.handleDeepLink(url)

    expect(presenterMock.windowPresenter.createSettingsWindow).toHaveBeenCalledTimes(1)
    expect(presenterMock.windowPresenter.sendToWindow).toHaveBeenNthCalledWith(
      1,
      9,
      SETTINGS_EVENTS.NAVIGATE,
      {
        routeName: 'settings-provider'
      }
    )
    expect(presenterMock.windowPresenter.sendToWindow).toHaveBeenNthCalledWith(
      2,
      9,
      SETTINGS_EVENTS.PROVIDER_INSTALL,
      expect.objectContaining({
        kind: 'builtin',
        id: 'openai',
        baseUrl: 'https://proxy.example.com/v1',
        apiKey: 'sk-import-1234',
        iconModelId: 'openai',
        willOverwrite: true
      })
    )
  })

  it('routes custom provider imports to settings and sends preview payload', async () => {
    const { DeeplinkPresenter } = await import('@/presenter/deeplinkPresenter')
    const deeplinkPresenter = new DeeplinkPresenter()
    const payload = {
      name: 'My Proxy',
      type: 'openai-completions',
      baseUrl: 'https://custom.example.com/v1',
      apiKey: 'sk-custom-5678'
    }
    const url = `deepchat://provider/install?v=1&data=${Buffer.from(JSON.stringify(payload)).toString('base64')}`

    await deeplinkPresenter.handleDeepLink(url)

    expect(presenterMock.windowPresenter.sendToWindow).toHaveBeenNthCalledWith(
      2,
      9,
      SETTINGS_EVENTS.PROVIDER_INSTALL,
      expect.objectContaining({
        kind: 'custom',
        name: 'My Proxy',
        type: 'openai-completions',
        baseUrl: 'https://custom.example.com/v1',
        apiKey: 'sk-custom-5678',
        iconModelId: 'openai-completions'
      })
    )
  })

  it('rejects invalid provider payloads and emits an error notification', async () => {
    const { DeeplinkPresenter } = await import('@/presenter/deeplinkPresenter')
    const deeplinkPresenter = new DeeplinkPresenter()
    const payload = {
      id: 'openai',
      type: 'openai-completions',
      name: 'invalid',
      baseUrl: 'https://invalid.example.com/v1',
      apiKey: 'sk-invalid'
    }
    const url = `deepchat://provider/install?v=1&data=${Buffer.from(JSON.stringify(payload)).toString('base64')}`

    await deeplinkPresenter.handleDeepLink(url)

    expect(presenterMock.windowPresenter.createSettingsWindow).not.toHaveBeenCalled()
    expect(eventBusMock.sendToRenderer).toHaveBeenCalledWith(
      NOTIFICATION_EVENTS.SHOW_ERROR,
      'all_windows',
      expect.objectContaining({
        title: 'Provider Deeplink',
        type: 'error'
      })
    )
  })
})
