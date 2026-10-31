import type { ProviderSettingsPort } from '@/provider/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLM_PROVIDER, MODEL_META } from '@shared/types/provider'
import type { ProviderCatalogState, ProviderCatalogStatePatch } from '@shared/types/providerCatalog'
import type { MainDatabase } from '../../../src/main/data/mainDatabase'
import { ProviderRuntime } from '../../../src/main/provider'
import { AiSdkProvider } from '../../../src/main/provider/providers/aiSdkProvider'
import { BaseLLMProvider } from '../../../src/main/provider/baseProvider'
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
  BrowserWindow: vi.fn(function BrowserWindow() {
    return {
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: vi.fn(),
      webContents: { send: vi.fn(), on: vi.fn(), isDestroyed: vi.fn(() => false) },
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      show: vi.fn(),
      hide: vi.fn()
    }
  }),
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

const createProviderSettings = (provider = createProvider()) => {
  const providerModels: Record<string, MODEL_META[]> = {}
  const customModels: Record<string, MODEL_META[]> = {}
  const catalogStates = new Map<string, ProviderCatalogState>()

  return {
    getProviders: vi.fn().mockReturnValue([provider]),
    getProviderById: vi.fn().mockReturnValue(provider),
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getRawProviderModels: vi.fn((providerId: string) => providerModels[providerId] ?? []),
    getRawCustomModels: vi.fn((providerId: string) => customModels[providerId] ?? []),
    getDbProviderModels: vi.fn().mockReturnValue([]),
    resolveEffectiveModels: vi.fn((models: MODEL_META[]) => models),
    getBatchModelStatus: vi.fn((_providerId: string, modelIds: string[]) =>
      Object.fromEntries(modelIds.map((modelId) => [modelId, false]))
    ),
    getProviderCatalogState: vi.fn((providerId: string) => catalogStates.get(providerId)),
    setProviderCatalogState: vi.fn(
      (
        providerId: string,
        patch: ProviderCatalogStatePatch,
        options: { bumpRevision?: boolean } = {}
      ) => {
        const existing = catalogStates.get(providerId)
        const next: ProviderCatalogState = {
          providerId,
          revision: (existing?.revision ?? 0) + (options.bumpRevision ? 1 : 0),
          fetchedAt:
            patch.fetchedAt !== undefined ? patch.fetchedAt : (existing?.fetchedAt ?? null),
          source: patch.source !== undefined ? patch.source : (existing?.source ?? null),
          lastRefreshReason:
            patch.lastRefreshReason !== undefined
              ? patch.lastRefreshReason
              : (existing?.lastRefreshReason ?? null),
          lastErrorCode:
            patch.lastErrorCode !== undefined
              ? patch.lastErrorCode
              : (existing?.lastErrorCode ?? null),
          lastErrorAt:
            patch.lastErrorAt !== undefined ? patch.lastErrorAt : (existing?.lastErrorAt ?? null)
        }
        catalogStates.set(providerId, next)
        return next
      }
    ),
    deleteProviderCatalogState: vi.fn((providerId: string) => catalogStates.delete(providerId)),
    notifyModelsChanged: vi.fn(),
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
    setProviderModels: vi.fn((providerId: string, models: MODEL_META[]) => {
      providerModels[providerId] = models
    }),
    getModelStatus: vi.fn().mockReturnValue(true),
    updateCustomModel: vi.fn(),
    addCustomModel: vi.fn(),
    removeCustomModel: vi.fn()
  } as unknown as ProviderSettingsPort
}

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

  it.each([
    'doubao',
    'kimi-for-coding',
    'xiaomi-token-plan-cn',
    'xiaomi-token-plan-sgp',
    'xiaomi-token-plan-ams'
  ])('re-syncs enabled %s models when provider-db updates', async (id) => {
    const fetchCatalogSpy = vi
      .spyOn(BaseLLMProvider.prototype, 'fetchCatalog')
      .mockResolvedValue([])

    const presenter = createProviderRuntime(
      createProviderSettings(
        createProvider({
          id,
          name: 'Doubao',
          apiType: 'doubao',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
        })
      )
    )
    await Promise.resolve()
    await Promise.resolve()
    fetchCatalogSpy.mockClear()

    await notifyProviderDbUpdated(presenter)

    expect(fetchCatalogSpy).toHaveBeenCalledTimes(1)
  })

  it('skips OpenAI Codex when provider-db updates in the background', async () => {
    const fetchCatalogSpy = vi
      .spyOn(BaseLLMProvider.prototype, 'fetchCatalog')
      .mockResolvedValue([])

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
    fetchCatalogSpy.mockClear()

    await notifyProviderDbUpdated(presenter)

    expect(fetchCatalogSpy).not.toHaveBeenCalled()
    expect(presenter.getProviderCatalog('openai-codex').revision).toBe(1)
  })

  it('ignores provider-db updates for providers that do not use the provider DB catalog', async () => {
    const fetchCatalogSpy = vi
      .spyOn(BaseLLMProvider.prototype, 'fetchCatalog')
      .mockResolvedValue([])

    const presenter = createProviderRuntime(createProviderSettings())
    await Promise.resolve()
    await Promise.resolve()

    await notifyProviderDbUpdated(presenter)

    expect(fetchCatalogSpy).not.toHaveBeenCalled()
    expect(presenter.getProviderCatalog('novita').revision).toBe(1)
  })

  it('coalesces duplicate background refreshes for the same provider', async () => {
    let resolveFetch: ((models: MODEL_META[]) => void) | null = null
    const fetchCatalogSpy = vi.spyOn(BaseLLMProvider.prototype, 'fetchCatalog').mockReturnValue(
      new Promise<MODEL_META[]>((resolve) => {
        resolveFetch = resolve
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

    expect(fetchCatalogSpy).not.toHaveBeenCalled()

    await notifyProviderDbUpdated(presenter)
    await notifyProviderDbUpdated(presenter)

    expect(fetchCatalogSpy).toHaveBeenCalledTimes(1)

    resolveFetch?.([])
    await vi.waitFor(() => expect(presenter.getProviderCatalog('doubao').status).toBe('fresh'))

    await notifyProviderDbUpdated(presenter)

    expect(fetchCatalogSpy).toHaveBeenCalledTimes(2)
  })

  it.each([
    'doubao',
    'kimi-for-coding',
    'openai-codex',
    'xiaomi-token-plan-cn',
    'xiaomi-token-plan-sgp',
    'xiaomi-token-plan-ams'
  ])('refreshes provider DB before manually rebuilding %s models', async (id) => {
    const provider = createProvider({
      id,
      name: 'Doubao',
      apiType: 'doubao',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
    })
    const providerSettings = createProviderSettings(provider)
    const refreshSpy = vi
      .spyOn(AiSdkProvider.prototype, 'refreshModels')
      .mockResolvedValue(undefined)

    const presenter = createProviderRuntime(providerSettings)
    await presenter.refreshModels(id)

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

  it('records a failed background refresh without blocking presenter initialization', async () => {
    const fetchCatalogSpy = vi
      .spyOn(BaseLLMProvider.prototype, 'fetchCatalog')
      .mockRejectedValue(new Error('refresh failed'))

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
    await vi.waitFor(() => expect(presenter.getProviderCatalog('doubao').status).toBe('error'))

    expect(presenter.getProviders()).toHaveLength(1)
    expect(presenter.getProviderCatalog('doubao').lastErrorCode).toBe('unknown')
    expect(fetchCatalogSpy).toHaveBeenCalledTimes(1)
  })
})
