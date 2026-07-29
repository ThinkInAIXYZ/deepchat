import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEEPLINK_EVENTS } from '@/events'
import { DEEPCHAT_EVENT_CHANNEL } from '@shared/contracts/channels'
import logger from '@shared/logger'
import { storeStartupDeepLink } from '@/lib/startupDeepLink'

const browserWindowFromIdMock = vi.hoisted(() => vi.fn())
const electronAppMock = vi.hoisted(() => ({
  setAsDefaultProtocolClient: vi.fn()
}))

const presenterMock = vi.hoisted(() => ({
  windowPresenter: {
    createSettingsWindow: vi.fn().mockResolvedValue(9),
    createAppWindow: vi.fn().mockResolvedValue(1),
    sendToWindow: vi.fn().mockReturnValue(true),
    sendSettingsNavigation: vi.fn().mockReturnValue(true),
    setPendingSettingsProviderInstall: vi.fn(),
    getAllWindows: vi.fn().mockReturnValue([]),
    getFocusedWindow: vi.fn().mockReturnValue(null)
  },
  providerSettings: {
    getProviderById: vi.fn()
  },
  mcpService: {
    isReady: vi.fn().mockReturnValue(true)
  },
  semanticNotifications: {
    occur: vi.fn(),
    recover: vi.fn()
  }
}))

vi.mock('electron', () => ({
  app: electronAppMock,
  BrowserWindow: {
    fromId: browserWindowFromIdMock
  }
}))

describe('DeeplinkService', () => {
  const createProviderInstallBase64 = (payload: Record<string, string>) =>
    Buffer.from(JSON.stringify(payload)).toString('base64')

  const createDeeplinkService = async () => {
    const { createDeeplinkActions } = await import('@/deeplink/actions')
    const { DeeplinkService } = await import('@/deeplink')
    const actions = createDeeplinkActions({
      window: presenterMock.windowPresenter as any,
      config: presenterMock.providerSettings as any,
      mcp: presenterMock.mcpService as any,
      notifications: presenterMock.semanticNotifications
    })
    return new DeeplinkService(actions.desktop, actions.mcp, actions.provider)
  }

  beforeEach(async () => {
    vi.restoreAllMocks()
    presenterMock.windowPresenter.createSettingsWindow.mockResolvedValue(9)
    presenterMock.windowPresenter.createAppWindow.mockResolvedValue(1)
    presenterMock.windowPresenter.sendToWindow.mockReturnValue(true)
    presenterMock.semanticNotifications.occur.mockReset()
    presenterMock.semanticNotifications.recover.mockReset()
    presenterMock.windowPresenter.sendSettingsNavigation.mockReturnValue(true)
    presenterMock.windowPresenter.setPendingSettingsProviderInstall.mockReset()
    presenterMock.windowPresenter.getAllWindows.mockReturnValue([])
    presenterMock.windowPresenter.getFocusedWindow.mockReturnValue(null)
    presenterMock.mcpService.isReady.mockReturnValue(true)
    presenterMock.providerSettings.getProviderById.mockImplementation((providerId: string) => {
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

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('processes the startup deeplink only when the app reports first content loaded', async () => {
    const deeplinkService = await createDeeplinkService()
    const handleDeepLink = vi.spyOn(deeplinkService, 'handleDeepLink').mockResolvedValue()
    storeStartupDeepLink('deepchat://start?msg=hello')

    deeplinkService.init()

    expect(handleDeepLink).not.toHaveBeenCalled()

    deeplinkService.processStartupUrl()
    deeplinkService.processStartupUrl()

    expect(handleDeepLink).toHaveBeenCalledTimes(1)
    expect(handleDeepLink).toHaveBeenCalledWith('deepchat://start?msg=hello')
  })

  it('routes start deeplink to a chat window even when settings is focused', async () => {
    const deeplinkService = await createDeeplinkService()
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

    await deeplinkService.handleDeepLink(
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
    const deeplinkService = await createDeeplinkService()
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

    await deeplinkService.handleDeepLink('deepchat:start?msg=%E4%BD%A0%E5%A5%BD')

    expect(presenterMock.windowPresenter.sendToWindow).toHaveBeenCalledWith(
      1,
      DEEPLINK_EVENTS.START,
      expect.objectContaining({
        msg: '你好',
        autoSend: false
      })
    )
  })

  it('routes MCP imports through the chat window IPC', async () => {
    const deeplinkService = await createDeeplinkService()
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
    const payload = {
      mcpServers: {
        demo: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem']
        }
      }
    }
    const url = `deepchat://mcp/install?code=${Buffer.from(JSON.stringify(payload)).toString('base64')}`
    presenterMock.windowPresenter.getAllWindows.mockReturnValue([chatWindow as any])
    browserWindowFromIdMock.mockReturnValue(chatWindow)

    await deeplinkService.handleDeepLink(url)

    expect(presenterMock.windowPresenter.createSettingsWindow).not.toHaveBeenCalled()
    expect(presenterMock.windowPresenter.sendToWindow).toHaveBeenCalledWith(
      1,
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
    const deeplinkService = await createDeeplinkService()
    const handleDeepLink = vi.spyOn(deeplinkService, 'handleDeepLink')
    const payload = {
      mcpServers: {
        demo: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem']
        }
      }
    }
    const url = `deepchat:mcp/install?code=${Buffer.from(JSON.stringify(payload)).toString('base64')}`
    presenterMock.mcpService.isReady.mockReturnValue(false)

    await deeplinkService.handleDeepLink(url)

    expect((deeplinkService as any).pendingMcpInstallUrl).toBe(url)
    expect(presenterMock.windowPresenter.createSettingsWindow).not.toHaveBeenCalled()

    presenterMock.mcpService.isReady.mockReturnValue(true)
    deeplinkService.processPendingMcpInstall()

    expect(handleDeepLink).toHaveBeenNthCalledWith(2, url)
    expect((deeplinkService as any).pendingMcpInstallUrl).toBeNull()
  })

  it('routes built-in provider imports to settings and stores the preview for replay', async () => {
    const deeplinkService = await createDeeplinkService()
    const payload = {
      id: 'openai',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk-import-1234'
    }
    const url = `deepchat://provider/install?v=1&data=${Buffer.from(JSON.stringify(payload)).toString('base64')}`

    await deeplinkService.handleDeepLink(url)

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
    expect(presenterMock.windowPresenter.sendSettingsNavigation).toHaveBeenCalledWith(9, {
      routeName: 'settings-provider'
    })
    expect(presenterMock.windowPresenter.sendToWindow).toHaveBeenCalledWith(
      9,
      DEEPCHAT_EVENT_CHANNEL,
      expect.objectContaining({
        name: 'settings.providerInstallRequested'
      })
    )
  })

  it('routes custom provider imports to settings and stores the preview for replay', async () => {
    const deeplinkService = await createDeeplinkService()
    const payload = {
      name: 'My Proxy',
      type: 'openai-completions',
      baseUrl: 'https://custom.example.com/v1',
      apiKey: 'sk-custom-5678'
    }
    const url = `deepchat://provider/install?v=1&data=${Buffer.from(JSON.stringify(payload)).toString('base64')}`

    await deeplinkService.handleDeepLink(url)

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
    expect(presenterMock.windowPresenter.sendSettingsNavigation).toHaveBeenCalledWith(9, {
      routeName: 'settings-provider'
    })
    expect(presenterMock.windowPresenter.sendToWindow).toHaveBeenCalledWith(
      9,
      DEEPCHAT_EVENT_CHANNEL,
      expect.objectContaining({
        name: 'settings.providerInstallRequested'
      })
    )
  })

  it('routes no-slash provider imports to settings and stores the preview for replay', async () => {
    const deeplinkService = await createDeeplinkService()
    const payload = {
      name: 'My Proxy',
      type: 'openai-completions',
      baseUrl: 'https://custom.example.com/v1',
      apiKey: 'sk-custom-5678'
    }
    const url = `deepchat:provider/install?v=1&data=${Buffer.from(JSON.stringify(payload)).toString('base64')}`

    await deeplinkService.handleDeepLink(url)

    expect(presenterMock.windowPresenter.setPendingSettingsProviderInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'custom',
        name: 'My Proxy',
        type: 'openai-completions'
      })
    )
    expect(presenterMock.windowPresenter.sendSettingsNavigation).toHaveBeenCalledWith(9, {
      routeName: 'settings-provider'
    })
    expect(presenterMock.windowPresenter.sendToWindow).toHaveBeenCalledWith(
      9,
      DEEPCHAT_EVENT_CHANNEL,
      expect.objectContaining({
        name: 'settings.providerInstallRequested'
      })
    )
  })

  it('classifies invalid provider payloads without forwarding exception copy', async () => {
    const deeplinkService = await createDeeplinkService()
    const payload = {
      id: 'openai',
      type: 'openai-completions',
      name: 'invalid',
      baseUrl: 'https://invalid.example.com/v1',
      apiKey: 'sk-invalid'
    }
    const url = `deepchat://provider/install?v=1&data=${Buffer.from(JSON.stringify(payload)).toString('base64')}`

    await deeplinkService.handleDeepLink(url)

    expect(presenterMock.windowPresenter.createSettingsWindow).not.toHaveBeenCalled()
    expect(presenterMock.semanticNotifications.occur).toHaveBeenCalledWith({
      code: 'providerDeeplink.failed',
      reason: 'invalid-payload'
    })
  })

  it('classifies unsupported provider deeplink versions', async () => {
    const deeplinkService = await createDeeplinkService()

    await deeplinkService.handleDeepLink('deepchat://provider/install?v=2&data=ignored')

    expect(presenterMock.semanticNotifications.occur).toHaveBeenCalledWith({
      code: 'providerDeeplink.failed',
      reason: 'unsupported-version'
    })
  })

  it('classifies provider ids that are absent from the catalog', async () => {
    const deeplinkService = await createDeeplinkService()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const data = createProviderInstallBase64({
      id: 'missing-provider',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk1'
    })

    await deeplinkService.handleDeepLink(`deepchat://provider/install?v=1&data=${data}`)

    expect(presenterMock.semanticNotifications.occur).toHaveBeenCalledWith({
      code: 'providerDeeplink.failed',
      reason: 'provider-not-found'
    })
    expect(consoleError).toHaveBeenCalledWith('Rejected provider install deeplink:', {
      reason: 'provider-not-found'
    })
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('missing-provider')
  })

  it('classifies provider kinds that cannot be imported', async () => {
    const deeplinkService = await createDeeplinkService()
    const data = createProviderInstallBase64({
      name: 'ACP',
      type: 'acp',
      baseUrl: '',
      apiKey: ''
    })

    await deeplinkService.handleDeepLink(`deepchat://provider/install?v=1&data=${data}`)

    expect(presenterMock.semanticNotifications.occur).toHaveBeenCalledWith({
      code: 'providerDeeplink.failed',
      reason: 'unsupported-provider'
    })
  })

  it('classifies a missing settings target separately from payload failures', async () => {
    const deeplinkService = await createDeeplinkService()
    presenterMock.windowPresenter.createSettingsWindow.mockResolvedValue(null)
    const data = createProviderInstallBase64({
      id: 'openai',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk1'
    })

    await deeplinkService.handleDeepLink(`deepchat://provider/install?v=1&data=${data}`)

    expect(presenterMock.semanticNotifications.occur).toHaveBeenCalledWith({
      code: 'providerDeeplink.failed',
      reason: 'settings-unavailable'
    })
  })

  it('classifies an unexpected settings failure separately from payload failures', async () => {
    const deeplinkService = await createDeeplinkService()
    presenterMock.windowPresenter.createSettingsWindow.mockRejectedValue(
      new Error('window creation failed')
    )
    const data = createProviderInstallBase64({
      id: 'openai',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk1'
    })

    await deeplinkService.handleDeepLink(`deepchat://provider/install?v=1&data=${data}`)

    expect(presenterMock.semanticNotifications.occur).toHaveBeenCalledWith({
      code: 'providerDeeplink.failed',
      reason: 'settings-unavailable'
    })
  })

  it('rejects provider payloads with missing base64 padding', async () => {
    const deeplinkService = await createDeeplinkService()
    const validBase64 = createProviderInstallBase64({
      id: 'openai',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk1'
    })
    const missingPadding = validBase64.replace(/=+$/, '')

    expect(() => (deeplinkService as any).parseProviderInstallPayload(missingPadding)).toThrow(
      'Invalid base64 payload.'
    )
  })

  it('rejects provider payloads with invalid base64 characters', async () => {
    const deeplinkService = await createDeeplinkService()
    const validBase64 = createProviderInstallBase64({
      id: 'openai',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk1'
    })
    const invalidCharacters = `${validBase64.slice(0, -2)}@#`

    expect(() => (deeplinkService as any).parseProviderInstallPayload(invalidCharacters)).toThrow(
      'Invalid base64 payload.'
    )
  })

  it('rejects truncated provider base64 payloads before JSON parsing', async () => {
    const deeplinkService = await createDeeplinkService()
    const validBase64 = createProviderInstallBase64({
      id: 'openai',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk1'
    })
    const truncatedPayload = validBase64.slice(0, -3)

    expect(() => (deeplinkService as any).parseProviderInstallPayload(truncatedPayload)).toThrow(
      'Invalid base64 payload.'
    )
  })

  it('redacts sensitive provider deeplink values in logs', async () => {
    const deeplinkService = await createDeeplinkService()
    const payload = {
      id: 'openai',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk-secret-value'
    }
    const rawData = Buffer.from(JSON.stringify(payload)).toString('base64')
    const url = `deepchat:provider/install?v=1&data=${rawData}`
    const loggerInfoMock = vi.mocked(logger.info)

    await deeplinkService.handleDeepLink(url)

    expect(loggerInfoMock).toHaveBeenCalledWith(
      'Received DeepLink:',
      'deepchat:provider/install?v=1&data=%5BREDACTED%5D'
    )
    expect(loggerInfoMock).toHaveBeenCalledWith(
      'Processing provider/install command, parameters:',
      {
        v: '1',
        data: '[REDACTED]'
      }
    )
    const serializedLogs = loggerInfoMock.mock.calls
      .flatMap((call) =>
        call.map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
      )
      .join(' ')
    expect(serializedLogs).not.toContain(rawData)
    expect(serializedLogs).not.toContain('sk-secret-value')
  })
})
