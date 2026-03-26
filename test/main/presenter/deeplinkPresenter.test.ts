import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEEPLINK_EVENTS, NOTIFICATION_EVENTS, SETTINGS_EVENTS } from '@/events'

const browserWindowFromIdMock = vi.hoisted(() => vi.fn())
const electronAppMock = vi.hoisted(() => ({
  setAsDefaultProtocolClient: vi.fn()
}))

const presenterMock = vi.hoisted(() => ({
  windowPresenter: {
    createSettingsWindow: vi.fn().mockResolvedValue(9),
    createAppWindow: vi.fn().mockResolvedValue(1),
    sendToWindow: vi.fn().mockReturnValue(true),
    setPendingSettingsProviderInstall: vi.fn(),
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

vi.mock('electron', () => ({
  app: electronAppMock,
  BrowserWindow: {
    fromId: browserWindowFromIdMock
  }
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

describe('DeeplinkPresenter', () => {
  const createProviderInstallBase64 = (payload: Record<string, string>) =>
    Buffer.from(JSON.stringify(payload)).toString('base64')

  beforeEach(() => {
    vi.clearAllMocks()
    presenterMock.windowPresenter.createSettingsWindow.mockResolvedValue(9)
    presenterMock.windowPresenter.createAppWindow.mockResolvedValue(1)
    presenterMock.windowPresenter.sendToWindow.mockReturnValue(true)
    presenterMock.windowPresenter.setPendingSettingsProviderInstall.mockReset()
    presenterMock.windowPresenter.getAllWindows.mockReturnValue([])
    presenterMock.windowPresenter.getFocusedWindow.mockReturnValue(null)
    presenterMock.mcpPresenter.isReady.mockReturnValue(true)
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

  it('routes start deeplink to a chat window even when settings is focused', async () => {
    const { DeeplinkPresenter } = await import('@/presenter/deeplinkPresenter')
    const deeplinkPresenter = new DeeplinkPresenter()
    const chatWindow = {
      id: 1,
      isDestroyed: () => false,
      isMinimized: () => false,
      show: vi.fn(),
      focus: vi.fn(),
      webContents: {
        isLoadingMainFrame: () => false,
        once: vi.fn()
      }
    }
    const settingsWindow = {
      id: 99,
      isDestroyed: () => false
    }

    presenterMock.windowPresenter.getAllWindows.mockReturnValue([chatWindow as any])
    presenterMock.windowPresenter.getFocusedWindow.mockReturnValue(settingsWindow as any)
    browserWindowFromIdMock.mockReturnValue(chatWindow)

    await deeplinkPresenter.handleDeepLink(
      'deepchat://start?msg=%E4%BD%A0%E5%A5%BD&model=deepseek-chat&system=Be%20concise&mentions=README.md,docs%2Fspec.md'
    )

    expect(chatWindow.show).toHaveBeenCalledTimes(1)
    expect(chatWindow.focus).toHaveBeenCalledTimes(1)
    expect(presenterMock.windowPresenter.sendToWindow).toHaveBeenCalledWith(
      1,
      DEEPLINK_EVENTS.START,
      {
        msg: '你好',
        modelId: 'deepseek-chat',
        systemPrompt: 'Be concise',
        mentions: ['README.md', 'docs/spec.md'],
        autoSend: false
      }
    )
  })

  it('routes no-slash start deeplinks to a chat window', async () => {
    const { DeeplinkPresenter } = await import('@/presenter/deeplinkPresenter')
    const deeplinkPresenter = new DeeplinkPresenter()
    const chatWindow = {
      id: 1,
      isDestroyed: () => false,
      isMinimized: () => false,
      show: vi.fn(),
      focus: vi.fn(),
      webContents: {
        isLoadingMainFrame: () => false,
        once: vi.fn()
      }
    }

    presenterMock.windowPresenter.getAllWindows.mockReturnValue([chatWindow as any])
    browserWindowFromIdMock.mockReturnValue(chatWindow)

    await deeplinkPresenter.handleDeepLink('deepchat:start?msg=%E4%BD%A0%E5%A5%BD')

    expect(presenterMock.windowPresenter.sendToWindow).toHaveBeenCalledWith(
      1,
      DEEPLINK_EVENTS.START,
      expect.objectContaining({
        msg: '你好',
        autoSend: false
      })
    )
  })

  it('routes MCP imports through settings IPC instead of localStorage injection', async () => {
    const { DeeplinkPresenter } = await import('@/presenter/deeplinkPresenter')
    const deeplinkPresenter = new DeeplinkPresenter()
    const payload = {
      mcpServers: {
        demo: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem']
        }
      }
    }
    const url = `deepchat://mcp/install?code=${Buffer.from(JSON.stringify(payload)).toString('base64')}`

    await deeplinkPresenter.handleDeepLink(url)

    expect(presenterMock.windowPresenter.createSettingsWindow).toHaveBeenCalledTimes(1)
    expect(presenterMock.windowPresenter.sendToWindow).toHaveBeenCalledWith(
      9,
      DEEPLINK_EVENTS.MCP_INSTALL,
      {
        mcpConfig: JSON.stringify({
          mcpServers: {
            demo: {
              env: {},
              descriptions: 'demo MCP Service',
              icons: '🔌',
              autoApprove: ['all'],
              enabled: false,
              disable: false,
              args: ['-y', '@modelcontextprotocol/server-filesystem'],
              type: 'stdio',
              command: 'npx',
              baseUrl: ''
            }
          }
        })
      }
    )
  })

  it('stores no-slash MCP install deeplinks until MCP is ready', async () => {
    const { DeeplinkPresenter } = await import('@/presenter/deeplinkPresenter')
    const deeplinkPresenter = new DeeplinkPresenter()
    const payload = {
      mcpServers: {
        demo: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem']
        }
      }
    }
    const url = `deepchat:mcp/install?code=${Buffer.from(JSON.stringify(payload)).toString('base64')}`
    presenterMock.mcpPresenter.isReady.mockReturnValue(false)

    await deeplinkPresenter.handleDeepLink(url)

    expect((deeplinkPresenter as any).pendingMcpInstallUrl).toBe(url)
    expect(presenterMock.windowPresenter.createSettingsWindow).not.toHaveBeenCalled()
  })

  it('routes built-in provider imports to settings and stores the preview for replay', async () => {
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
    expect(presenterMock.windowPresenter.setPendingSettingsProviderInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'builtin',
        id: 'openai',
        baseUrl: 'https://proxy.example.com/v1',
        apiKey: 'sk-import-1234',
        iconModelId: 'openai',
        willOverwrite: true
      })
    )
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
      SETTINGS_EVENTS.PROVIDER_INSTALL
    )
  })

  it('routes custom provider imports to settings and stores the preview for replay', async () => {
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

    expect(presenterMock.windowPresenter.setPendingSettingsProviderInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'custom',
        name: 'My Proxy',
        type: 'openai-completions',
        baseUrl: 'https://custom.example.com/v1',
        apiKey: 'sk-custom-5678',
        iconModelId: 'openai-completions'
      })
    )
    expect(presenterMock.windowPresenter.sendToWindow).toHaveBeenNthCalledWith(
      2,
      9,
      SETTINGS_EVENTS.PROVIDER_INSTALL
    )
  })

  it('routes no-slash provider imports to settings and stores the preview for replay', async () => {
    const { DeeplinkPresenter } = await import('@/presenter/deeplinkPresenter')
    const deeplinkPresenter = new DeeplinkPresenter()
    const payload = {
      name: 'My Proxy',
      type: 'openai-completions',
      baseUrl: 'https://custom.example.com/v1',
      apiKey: 'sk-custom-5678'
    }
    const url = `deepchat:provider/install?v=1&data=${Buffer.from(JSON.stringify(payload)).toString('base64')}`

    await deeplinkPresenter.handleDeepLink(url)

    expect(presenterMock.windowPresenter.setPendingSettingsProviderInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'custom',
        name: 'My Proxy',
        type: 'openai-completions'
      })
    )
    expect(presenterMock.windowPresenter.sendToWindow).toHaveBeenNthCalledWith(
      2,
      9,
      SETTINGS_EVENTS.PROVIDER_INSTALL
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

  it('rejects provider payloads with missing base64 padding', async () => {
    const { DeeplinkPresenter } = await import('@/presenter/deeplinkPresenter')
    const deeplinkPresenter = new DeeplinkPresenter()
    const validBase64 = createProviderInstallBase64({
      id: 'openai',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk1'
    })
    const missingPadding = validBase64.replace(/=+$/, '')

    expect(() => (deeplinkPresenter as any).parseProviderInstallPayload(missingPadding)).toThrow(
      'Invalid base64 payload.'
    )
  })

  it('rejects provider payloads with invalid base64 characters', async () => {
    const { DeeplinkPresenter } = await import('@/presenter/deeplinkPresenter')
    const deeplinkPresenter = new DeeplinkPresenter()
    const validBase64 = createProviderInstallBase64({
      id: 'openai',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk1'
    })
    const invalidCharacters = `${validBase64.slice(0, -2)}@#`

    expect(() => (deeplinkPresenter as any).parseProviderInstallPayload(invalidCharacters)).toThrow(
      'Invalid base64 payload.'
    )
  })

  it('rejects truncated provider base64 payloads before JSON parsing', async () => {
    const { DeeplinkPresenter } = await import('@/presenter/deeplinkPresenter')
    const deeplinkPresenter = new DeeplinkPresenter()
    const validBase64 = createProviderInstallBase64({
      id: 'openai',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk1'
    })
    const truncatedPayload = validBase64.slice(0, -3)

    expect(() => (deeplinkPresenter as any).parseProviderInstallPayload(truncatedPayload)).toThrow(
      'Invalid base64 payload.'
    )
  })

  it('redacts sensitive provider deeplink values in logs', async () => {
    const { DeeplinkPresenter } = await import('@/presenter/deeplinkPresenter')
    const deeplinkPresenter = new DeeplinkPresenter()
    const payload = {
      id: 'openai',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk-secret-value'
    }
    const rawData = Buffer.from(JSON.stringify(payload)).toString('base64')
    const url = `deepchat:provider/install?v=1&data=${rawData}`
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await deeplinkPresenter.handleDeepLink(url)

    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Received DeepLink:',
      'deepchat:provider/install?v=1&data=%5BREDACTED%5D'
    )
    expect(consoleLogSpy).toHaveBeenCalledWith('Processing provider/install command, parameters:', {
      v: '1',
      data: '[REDACTED]'
    })
    const serializedLogs = consoleLogSpy.mock.calls
      .flatMap((call) =>
        call.map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
      )
      .join(' ')
    expect(serializedLogs).not.toContain(rawData)
    expect(serializedLogs).not.toContain('sk-secret-value')

    consoleLogSpy.mockRestore()
  })
})
