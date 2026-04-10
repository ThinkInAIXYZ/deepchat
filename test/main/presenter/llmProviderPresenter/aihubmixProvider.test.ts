import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter, LLM_PROVIDER } from '../../../../src/shared/presenter'
import { AihubmixProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/aihubmixProvider'
import type { AiSdkRuntimeContext } from '../../../../src/main/presenter/llmProviderPresenter/aiSdk'

const { mockModelsList, mockGetProxyUrl } = vi.hoisted(() => ({
  mockModelsList: vi.fn().mockResolvedValue({ data: [] }),
  mockGetProxyUrl: vi.fn().mockReturnValue(null)
}))

vi.mock('openai', () => {
  class MockOpenAI {
    models = {
      list: mockModelsList
    }
  }

  return {
    default: MockOpenAI,
    AzureOpenAI: MockOpenAI
  }
})

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

vi.mock('@/presenter', () => ({
  presenter: {
    devicePresenter: {
      cacheImage: vi.fn()
    }
  }
}))

vi.mock('@/eventbus', () => ({
  eventBus: {
    on: vi.fn(),
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
    PROXY_RESOLVED: 'PROXY_RESOLVED',
    PROVIDER_ATOMIC_UPDATE: 'PROVIDER_ATOMIC_UPDATE',
    PROVIDER_BATCH_UPDATE: 'PROVIDER_BATCH_UPDATE',
    MODEL_LIST_CHANGED: 'MODEL_LIST_CHANGED'
  },
  PROVIDER_DB_EVENTS: {
    UPDATED: 'UPDATED'
  },
  NOTIFICATION_EVENTS: {
    SHOW_ERROR: 'SHOW_ERROR'
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

class TestAihubmixProvider extends AihubmixProvider {
  public exposeAiSdkRuntimeContext(): AiSdkRuntimeContext {
    return this.getAiSdkRuntimeContext()
  }
}

const createConfigPresenter = () =>
  ({
    getProviders: vi.fn().mockReturnValue([]),
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getModelConfig: vi.fn().mockReturnValue(undefined),
    getSetting: vi.fn().mockReturnValue(undefined),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(true)
  }) as unknown as IConfigPresenter

const createProvider = (): LLM_PROVIDER =>
  ({
    id: 'aihubmix',
    name: 'Aihubmix',
    apiType: 'openai-compatible',
    apiKey: 'test-key',
    baseUrl: 'https://aihubmix.com/v1',
    enable: false
  }) as LLM_PROVIDER

describe('AihubmixProvider AI SDK runtime headers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProxyUrl.mockReturnValue(null)
  })

  it('preserves the DeepChat APP-Code header in AI SDK mode', () => {
    const provider = new TestAihubmixProvider(createProvider(), createConfigPresenter())

    const context = provider.exposeAiSdkRuntimeContext()

    expect(context.defaultHeaders).toMatchObject({
      'APP-Code': 'SMUE7630',
      'X-Title': 'DeepChat'
    })
  })
})
