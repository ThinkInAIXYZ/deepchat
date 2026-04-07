import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  IConfigPresenter,
  ISQLitePresenter,
  LLM_PROVIDER
} from '../../../../src/shared/presenter'
import { LLMProviderPresenter } from '../../../../src/main/presenter/llmProviderPresenter'
import { OpenAICompatibleProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/openAICompatibleProvider'

const eventState = vi.hoisted(() => ({
  handlers: new Map<string, Array<(...args: unknown[]) => void>>()
}))

const { mockModelsList, mockGetProxyUrl } = vi.hoisted(() => ({
  mockModelsList: vi.fn().mockResolvedValue({ data: [] }),
  mockGetProxyUrl: vi.fn().mockReturnValue(null)
}))

vi.mock('electron', () => ({
  app: {
    getName: vi.fn(() => 'DeepChat'),
    getVersion: vi.fn(() => '0.0.0-test'),
    getPath: vi.fn(() => '/mock/path'),
    isReady: vi.fn(() => true),
    on: vi.fn()
  },
  session: {},
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
    removeHandler: vi.fn()
  },
  BrowserWindow: vi.fn(() => ({
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
    webContents: { send: vi.fn(), on: vi.fn(), isDestroyed: vi.fn(() => false) },
    isDestroyed: vi.fn(() => false),
    close: vi.fn(),
    show: vi.fn(),
    hide: vi.fn()
  })),
  dialog: {
    showOpenDialog: vi.fn()
  },
  shell: {
    openExternal: vi.fn()
  }
}))

vi.mock('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: vi.fn()
      }
    }
    models = {
      list: mockModelsList
    }
  }

  return {
    default: MockOpenAI,
    AzureOpenAI: MockOpenAI
  }
})

vi.mock('@/presenter', () => ({
  presenter: {
    devicePresenter: {
      cacheImage: vi.fn()
    }
  }
}))

vi.mock('@/eventbus', () => ({
  eventBus: {
    on: vi.fn((eventName: string, handler: (...args: unknown[]) => void) => {
      const handlers = eventState.handlers.get(eventName) ?? []
      handlers.push(handler)
      eventState.handlers.set(eventName, handlers)
    }),
    sendToRenderer: vi.fn(),
    sendToMain: vi.fn(),
    emit: vi.fn(),
    send: vi.fn()
  },
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
  }
}))

vi.mock('@/events', () => ({
  CONFIG_EVENTS: {
    PROXY_RESOLVED: 'config:proxy-resolved',
    PROVIDER_ATOMIC_UPDATE: 'config:provider-atomic-update',
    PROVIDER_BATCH_UPDATE: 'config:provider-batch-update',
    MODEL_LIST_CHANGED: 'config:model-list-changed'
  },
  PROVIDER_DB_EVENTS: {
    UPDATED: 'provider-db:updated'
  },
  NOTIFICATION_EVENTS: {
    SHOW_ERROR: 'notification:show-error'
  }
}))

vi.mock('../../../../src/main/presenter/proxyConfig', () => ({
  proxyConfig: {
    getProxyUrl: mockGetProxyUrl
  }
}))

vi.mock('../../../../src/main/presenter/configPresenter/modelCapabilities', () => ({
  modelCapabilities: {
    supportsReasoningEffort: vi.fn().mockReturnValue(false),
    supportsVerbosity: vi.fn().mockReturnValue(false),
    supportsReasoning: vi.fn().mockReturnValue(false),
    resolveProviderId: vi.fn((providerId: string) => providerId)
  }
}))

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'novita',
  name: 'Novita',
  apiType: 'openai-completions',
  apiKey: 'test-key',
  baseUrl: 'https://api.novita.ai/openai',
  enable: true,
  ...overrides
})

const createConfigPresenter = (provider = createProvider()) =>
  ({
    getProviders: vi.fn().mockReturnValue([provider]),
    getProviderById: vi.fn().mockReturnValue(provider),
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getModelConfig: vi.fn().mockReturnValue({
      maxTokens: 4096,
      contextLength: 8192,
      temperature: 0.7,
      vision: false,
      functionCall: false,
      reasoning: false,
      type: 'chat'
    }),
    getSetting: vi.fn().mockReturnValue(undefined),
    refreshProviderDb: vi.fn().mockResolvedValue({
      status: 'updated',
      lastUpdated: Date.now(),
      providersCount: 1
    }),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(true),
    updateCustomModel: vi.fn(),
    addCustomModel: vi.fn(),
    removeCustomModel: vi.fn()
  }) as unknown as IConfigPresenter

const mockSqlitePresenter = {
  getAcpSession: vi.fn().mockResolvedValue(null),
  upsertAcpSession: vi.fn().mockResolvedValue(undefined),
  updateAcpSessionId: vi.fn().mockResolvedValue(undefined),
  updateAcpWorkdir: vi.fn().mockResolvedValue(undefined),
  updateAcpSessionStatus: vi.fn().mockResolvedValue(undefined),
  deleteAcpSession: vi.fn().mockResolvedValue(undefined),
  deleteAcpSessions: vi.fn().mockResolvedValue(undefined)
} as unknown as ISQLitePresenter

const emitMainEvent = async (eventName: string, ...args: unknown[]) => {
  const handlers = eventState.handlers.get(eventName) ?? []
  handlers.forEach((handler) => handler(...args))
  await Promise.resolve()
  await Promise.resolve()
}

describe('LLMProviderPresenter background model sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventState.handlers.clear()
    mockModelsList.mockResolvedValue({ data: [] })
    mockGetProxyUrl.mockReturnValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not trigger an extra startup refresh for non DB-backed providers', async () => {
    const refreshSpy = vi
      .spyOn(OpenAICompatibleProvider.prototype, 'refreshModels')
      .mockResolvedValue(undefined)

    const presenter = new LLMProviderPresenter(createConfigPresenter(), mockSqlitePresenter)
    await Promise.resolve()
    await Promise.resolve()

    expect(presenter.getProviders()).toHaveLength(1)
    expect(refreshSpy).not.toHaveBeenCalled()
  })

  it('re-syncs enabled DB-backed provider models when provider-db updates', async () => {
    const refreshSpy = vi
      .spyOn(OpenAICompatibleProvider.prototype, 'refreshModels')
      .mockResolvedValue(undefined)

    new LLMProviderPresenter(
      createConfigPresenter(
        createProvider({
          id: 'doubao',
          name: 'Doubao',
          apiType: 'doubao',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
        })
      ),
      mockSqlitePresenter
    )
    await Promise.resolve()
    await Promise.resolve()
    refreshSpy.mockClear()

    await emitMainEvent('provider-db:updated', {
      providersCount: 1,
      lastUpdated: Date.now()
    })

    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })

  it('ignores provider-db updates for providers that do not use the provider DB catalog', async () => {
    const refreshSpy = vi
      .spyOn(OpenAICompatibleProvider.prototype, 'refreshModels')
      .mockResolvedValue(undefined)

    new LLMProviderPresenter(createConfigPresenter(), mockSqlitePresenter)
    await Promise.resolve()
    await Promise.resolve()

    await emitMainEvent('provider-db:updated', {
      providersCount: 1,
      lastUpdated: Date.now()
    })

    expect(refreshSpy).not.toHaveBeenCalled()
  })

  it('coalesces duplicate background refreshes for the same provider', async () => {
    let resolveRefresh: (() => void) | null = null
    const refreshSpy = vi
      .spyOn(OpenAICompatibleProvider.prototype, 'refreshModels')
      .mockReturnValue(
        new Promise<void>((resolve) => {
          resolveRefresh = resolve
        })
      )

    new LLMProviderPresenter(
      createConfigPresenter(
        createProvider({
          id: 'doubao',
          name: 'Doubao',
          apiType: 'doubao',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
        })
      ),
      mockSqlitePresenter
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(refreshSpy).not.toHaveBeenCalled()

    await emitMainEvent('provider-db:updated', {
      providersCount: 1,
      lastUpdated: Date.now()
    })
    await emitMainEvent('provider-db:updated', {
      providersCount: 1,
      lastUpdated: Date.now()
    })

    expect(refreshSpy).toHaveBeenCalledTimes(1)

    resolveRefresh?.()
    await Promise.resolve()
    await Promise.resolve()

    await emitMainEvent('provider-db:updated', {
      providersCount: 1,
      lastUpdated: Date.now()
    })

    expect(refreshSpy).toHaveBeenCalledTimes(2)
  })

  it('refreshes provider DB before rebuilding DB-backed provider models', async () => {
    const provider = createProvider({
      id: 'doubao',
      name: 'Doubao',
      apiType: 'doubao',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
    })
    const configPresenter = createConfigPresenter(provider)
    const refreshSpy = vi
      .spyOn(OpenAICompatibleProvider.prototype, 'refreshModels')
      .mockResolvedValue(undefined)

    const presenter = new LLMProviderPresenter(configPresenter, mockSqlitePresenter)
    await presenter.refreshModels('doubao')

    expect(configPresenter.refreshProviderDb).toHaveBeenCalledWith(true)
    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(configPresenter.refreshProviderDb.mock.invocationCallOrder[0]).toBeLessThan(
      refreshSpy.mock.invocationCallOrder[0]
    )
  })

  it('surfaces provider DB refresh failures without rebuilding DB-backed provider models', async () => {
    const provider = createProvider({
      id: 'doubao',
      name: 'Doubao',
      apiType: 'doubao',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
    })
    const configPresenter = createConfigPresenter(provider)
    configPresenter.refreshProviderDb.mockResolvedValueOnce({
      status: 'error',
      lastUpdated: null,
      providersCount: 1,
      message: 'network down'
    })
    const refreshSpy = vi
      .spyOn(OpenAICompatibleProvider.prototype, 'refreshModels')
      .mockResolvedValue(undefined)

    const presenter = new LLMProviderPresenter(configPresenter, mockSqlitePresenter)

    await expect(presenter.refreshModels('doubao')).rejects.toThrow(
      'Model refresh failed: network down'
    )
    expect(refreshSpy).not.toHaveBeenCalled()
  })

  it('does not refresh provider DB for providers that manage models themselves', async () => {
    const configPresenter = createConfigPresenter()
    const refreshSpy = vi
      .spyOn(OpenAICompatibleProvider.prototype, 'refreshModels')
      .mockResolvedValue(undefined)

    const presenter = new LLMProviderPresenter(configPresenter, mockSqlitePresenter)
    await presenter.refreshModels('novita')

    expect(configPresenter.refreshProviderDb).not.toHaveBeenCalled()
    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })

  it('logs provider-db refresh failures without blocking presenter initialization', async () => {
    const refreshSpy = vi
      .spyOn(OpenAICompatibleProvider.prototype, 'refreshModels')
      .mockRejectedValue(new Error('refresh failed'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const presenter = new LLMProviderPresenter(
      createConfigPresenter(
        createProvider({
          id: 'doubao',
          name: 'Doubao',
          apiType: 'doubao',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
        })
      ),
      mockSqlitePresenter
    )
    await Promise.resolve()
    await Promise.resolve()

    await emitMainEvent('provider-db:updated', {
      providersCount: 1,
      lastUpdated: Date.now()
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(presenter.getProviders()).toHaveLength(1)
    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      '[LLMProviderPresenter] Failed to refresh models for provider doubao during provider-db-updated:',
      expect.any(Error)
    )
  })
})
