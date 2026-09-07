import type { ProviderSettingsPort } from '@/provider/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLM_PROVIDER } from '@shared/types/provider'
import type { MainDatabase } from '../../../src/main/data/mainDatabase'
import { ProviderRuntime } from '../../../src/main/provider'
import { AiSdkProvider } from '../../../src/main/provider/providers/aiSdkProvider'
import { AcpRuntimeOwner } from '@/agent/acp/client'
import { AcpSessionPersistence } from '@/agent/acp/runtime'

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

vi.mock('../../../src/main/platform/proxy', () => ({
  proxyConfig: {
    getProxyUrl: mockGetProxyUrl
  }
}))

vi.mock('../../../src/main/provider/modelCapabilities', () => ({
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

const createProviderSettings = (provider = createProvider()) =>
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
  }) as unknown as ProviderSettingsPort

const mockSqlitePresenter = {
  getAcpSession: vi.fn().mockResolvedValue(null),
  upsertAcpSession: vi.fn().mockResolvedValue(undefined),
  updateAcpSessionId: vi.fn().mockResolvedValue(undefined),
  updateAcpWorkdir: vi.fn().mockResolvedValue(undefined),
  updateAcpSessionStatus: vi.fn().mockResolvedValue(undefined),
  deleteAcpSession: vi.fn().mockResolvedValue(undefined),
  deleteAcpSessions: vi.fn().mockResolvedValue(undefined)
} as unknown as MainDatabase

const createProviderRuntime = (providerSettings: ProviderSettingsPort) => {
  const persistence = new AcpSessionPersistence(
    mockSqlitePresenter,
    mockSqlitePresenter as never,
    {
      newEnvironmentsTable: { listPathsForSession: () => [], syncPath: vi.fn() }
    } as never
  )
  return new ProviderRuntime(
    providerSettings,
    { getLanguage: vi.fn().mockReturnValue('en-US') },
    {} as never,
    {} as never,
    new AcpRuntimeOwner(() => {
      throw new Error('ACP runtime is not used in this test')
    }),
    persistence,
    vi.fn()
  )
}

const notifyProviderDbUpdated = async (presenter: ProviderRuntime) => {
  presenter.handleProviderDbUpdated()
  await Promise.resolve()
  await Promise.resolve()
}

describe('ProviderRuntime background model sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockModelsList.mockResolvedValue({ data: [] })
    mockGetProxyUrl.mockReturnValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not trigger an extra startup refresh for non DB-backed providers', async () => {
    const refreshSpy = vi
      .spyOn(AiSdkProvider.prototype, 'refreshModels')
      .mockResolvedValue(undefined)

    const presenter = createProviderRuntime(createProviderSettings())
    await Promise.resolve()
    await Promise.resolve()

    expect(presenter.getProviders()).toHaveLength(1)
    expect(refreshSpy).not.toHaveBeenCalled()
  })

  it('re-syncs enabled DB-backed provider models when provider-db updates', async () => {
    const refreshSpy = vi
      .spyOn(AiSdkProvider.prototype, 'refreshModels')
      .mockResolvedValue(undefined)

    const presenter = createProviderRuntime(
      createProviderSettings(
        createProvider({
          id: 'doubao',
          name: 'Doubao',
          apiType: 'doubao',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
        })
      )
    )
    await Promise.resolve()
    await Promise.resolve()
    refreshSpy.mockClear()

    await notifyProviderDbUpdated(presenter)

    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })

  it('skips OpenAI Codex when provider-db updates in the background', async () => {
    const refreshSpy = vi
      .spyOn(AiSdkProvider.prototype, 'refreshModels')
      .mockResolvedValue(undefined)

    const presenter = createProviderRuntime(
      createProviderSettings(
        createProvider({
          id: 'openai-codex',
          name: 'OpenAI Codex',
          apiType: 'openai-codex',
          baseUrl: 'https://chatgpt.com/backend-api/codex'
        })
      )
    )
    await Promise.resolve()
    await Promise.resolve()
    refreshSpy.mockClear()

    await notifyProviderDbUpdated(presenter)

    expect(refreshSpy).not.toHaveBeenCalled()
  })

  it('ignores provider-db updates for providers that do not use the provider DB catalog', async () => {
    const refreshSpy = vi
      .spyOn(AiSdkProvider.prototype, 'refreshModels')
      .mockResolvedValue(undefined)

    const presenter = createProviderRuntime(createProviderSettings())
    await Promise.resolve()
    await Promise.resolve()

    await notifyProviderDbUpdated(presenter)

    expect(refreshSpy).not.toHaveBeenCalled()
  })

  it('coalesces duplicate background refreshes for the same provider', async () => {
    let resolveRefresh: (() => void) | null = null
    const refreshSpy = vi.spyOn(AiSdkProvider.prototype, 'refreshModels').mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRefresh = resolve
      })
    )

    const presenter = createProviderRuntime(
      createProviderSettings(
        createProvider({
          id: 'doubao',
          name: 'Doubao',
          apiType: 'doubao',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
        })
      )
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(refreshSpy).not.toHaveBeenCalled()

    await notifyProviderDbUpdated(presenter)
    await notifyProviderDbUpdated(presenter)

    expect(refreshSpy).toHaveBeenCalledTimes(1)

    resolveRefresh?.()
    await Promise.resolve()
    await Promise.resolve()

    await notifyProviderDbUpdated(presenter)

    expect(refreshSpy).toHaveBeenCalledTimes(2)
  })

  it('refreshes provider DB before rebuilding DB-backed provider models', async () => {
    const provider = createProvider({
      id: 'doubao',
      name: 'Doubao',
      apiType: 'doubao',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
    })
    const providerSettings = createProviderSettings(provider)
    const refreshSpy = vi
      .spyOn(AiSdkProvider.prototype, 'refreshModels')
      .mockResolvedValue(undefined)

    const presenter = createProviderRuntime(providerSettings)
    await presenter.refreshModels('doubao')

    expect(providerSettings.refreshProviderDb).toHaveBeenCalledWith(true)
    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(providerSettings.refreshProviderDb.mock.invocationCallOrder[0]).toBeLessThan(
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
    const providerSettings = createProviderSettings(provider)
    providerSettings.refreshProviderDb.mockResolvedValueOnce({
      status: 'error',
      lastUpdated: null,
      providersCount: 1,
      message: 'network down'
    })
    const refreshSpy = vi
      .spyOn(AiSdkProvider.prototype, 'refreshModels')
      .mockResolvedValue(undefined)

    const presenter = createProviderRuntime(providerSettings)

    await expect(presenter.refreshModels('doubao')).rejects.toThrow(
      'Model refresh failed: network down'
    )
    expect(refreshSpy).not.toHaveBeenCalled()
  })

  it('does not refresh provider DB for providers that manage models themselves', async () => {
    const providerSettings = createProviderSettings()
    const refreshSpy = vi
      .spyOn(AiSdkProvider.prototype, 'refreshModels')
      .mockResolvedValue(undefined)

    const presenter = createProviderRuntime(providerSettings)
    await presenter.refreshModels('novita')

    expect(providerSettings.refreshProviderDb).not.toHaveBeenCalled()
    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })

  it('logs provider-db refresh failures without blocking presenter initialization', async () => {
    const refreshSpy = vi
      .spyOn(AiSdkProvider.prototype, 'refreshModels')
      .mockRejectedValue(new Error('refresh failed'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const presenter = createProviderRuntime(
      createProviderSettings(
        createProvider({
          id: 'doubao',
          name: 'Doubao',
          apiType: 'doubao',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
        })
      )
    )
    await Promise.resolve()
    await Promise.resolve()

    await notifyProviderDbUpdated(presenter)
    await Promise.resolve()
    await Promise.resolve()

    expect(presenter.getProviders()).toHaveLength(1)
    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      '[ProviderRuntime] Failed to refresh models for provider doubao during provider-db-updated:',
      expect.any(Error)
    )
  })
})
