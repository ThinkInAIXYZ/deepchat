import { vi, beforeEach, afterEach } from 'vitest'
import { config } from '@vue/test-utils'

const createDefaultModelConfig = () => ({
  maxTokens: 4096,
  contextLength: 16000,
  temperature: 0.7,
  vision: false,
  functionCall: true,
  reasoning: true,
  type: 'chat'
})

const createDefaultReasoningCapabilities = () => ({
  supportsReasoning: true,
  reasoningPortrait: null,
  thinkingBudgetRange: null,
  supportsSearch: null,
  searchDefaults: null,
  supportsTemperatureControl: true,
  temperatureCapability: true
})

const getDefaultDeepchatInvokeResult = (
  routeName: string,
  payload: Record<string, unknown> = {}
): Record<string, unknown> => {
  switch (routeName) {
    case 'settings.getSnapshot':
      return {
        version: 0,
        values: {}
      }
    case 'settings.listSystemFonts':
      return {
        fonts: []
      }
    case 'settings.update':
      return {
        version: 1,
        values: {}
      }
    case 'system.openSettings':
      return {
        opened: true
      }
    case 'config.getEntries':
      return {
        version: 0,
        values: {}
      }
    case 'config.updateEntries':
      return {
        version: 1,
        values: Object.fromEntries(
          Array.isArray(payload.changes)
            ? payload.changes
                .filter(
                  (change): change is { key: string; value: unknown } =>
                    Boolean(change) &&
                    typeof change === 'object' &&
                    typeof (change as { key?: unknown }).key === 'string'
                )
                .map((change) => [change.key, change.value])
            : []
        )
      }
    case 'config.getLanguage':
    case 'config.setLanguage':
      return {
        requestedLanguage: 'zh-CN',
        locale: 'zh-CN',
        direction: 'ltr',
        version: 0
      }
    case 'config.getTheme':
      return {
        theme: 'light',
        isDark: false,
        version: 0
      }
    case 'config.setTheme':
      return {
        theme: payload.theme ?? 'light',
        isDark: payload.theme === 'dark',
        version: 1
      }
    case 'config.getFloatingButton':
    case 'config.setFloatingButton':
      return {
        enabled: payload.enabled ?? false,
        version: 0
      }
    case 'config.getSyncSettings':
      return {
        enabled: false,
        folderPath: '',
        version: 0
      }
    case 'config.updateSyncSettings':
      return {
        enabled: payload.enabled ?? false,
        folderPath: payload.folderPath ?? '',
        version: 1
      }
    case 'config.getDefaultProjectPath':
    case 'config.setDefaultProjectPath':
      return {
        path: payload.path ?? null,
        version: 0
      }
    case 'config.getShortcutKeys':
    case 'config.resetShortcutKeys':
      return {
        shortcuts: {},
        version: 0
      }
    case 'config.setShortcutKeys':
      return {
        shortcuts: payload.shortcuts ?? {},
        version: 1
      }
    case 'config.listCustomPrompts':
      return {
        prompts: [],
        version: 0
      }
    case 'config.getSystemPrompts':
      return {
        prompts: [],
        defaultPromptId: 'empty',
        prompt: '',
        version: 0
      }
    case 'config.getDefaultSystemPrompt':
    case 'config.resetDefaultSystemPrompt':
    case 'config.clearDefaultSystemPrompt':
      return {
        defaultPromptId: 'empty',
        prompt: '',
        version: 0
      }
    case 'config.setDefaultSystemPrompt':
      return {
        defaultPromptId: 'empty',
        prompt: payload.prompt ?? '',
        version: 1
      }
    case 'config.setDefaultSystemPromptId':
      return {
        defaultPromptId: payload.promptId ?? 'empty',
        version: 1
      }
    case 'config.getAcpState':
      return {
        enabled: false,
        agents: [],
        version: 0
      }
    case 'config.resolveDeepChatAgentConfig':
      return {
        config: {
          defaultModelPreset: undefined,
          defaultProjectPath: undefined,
          systemPrompt: '',
          permissionMode: 'full_access',
          disabledAgentTools: [],
          subagentEnabled: false
        }
      }
    case 'config.getAgentMcpSelections':
    case 'config.getAcpSharedMcpSelections':
    case 'config.setAcpSharedMcpSelections':
      return {
        selections: Array.isArray(payload.selections) ? payload.selections : [],
        version: 0
      }
    case 'config.getMcpServers':
      return {
        servers: {},
        version: 0
      }
    case 'config.getKnowledgeConfigs':
      return {
        configs: [],
        version: 0
      }
    case 'config.setKnowledgeConfigs':
      return {
        configs: Array.isArray(payload.configs) ? payload.configs : [],
        version: 1
      }
    case 'config.getAcpRegistryIconMarkup':
      return {
        markup: ''
      }
    case 'config.getVoiceAiConfig':
    case 'config.updateVoiceAiConfig':
      return {
        config: {
          audioFormat: 'wav',
          model: '',
          language: 'zh-CN',
          temperature: 0.7,
          topP: 1,
          agentId: 'deepchat',
          ...(typeof payload.updates === 'object' && payload.updates ? payload.updates : {})
        }
      }
    case 'config.getAzureApiVersion':
    case 'config.setAzureApiVersion':
      return {
        version: payload.version ?? ''
      }
    case 'config.getGeminiSafety':
    case 'config.setGeminiSafety':
      return {
        value: payload.value ?? 'BLOCK_NONE'
      }
    case 'config.getAwsBedrockCredential':
    case 'config.setAwsBedrockCredential':
      return {
        value: payload.credential ?? null
      }
    case 'providers.list':
    case 'providers.listSummaries':
    case 'providers.listDefaults':
      return {
        providers: []
      }
    case 'providers.setById':
    case 'providers.add':
      return {
        provider: payload.provider ?? null
      }
    case 'providers.update':
      return {
        requiresRebuild: false
      }
    case 'providers.remove':
      return {
        removed: true
      }
    case 'providers.reorder':
      return {
        providers: Array.isArray(payload.providers) ? payload.providers : []
      }
    case 'providers.listModels':
      return {
        models: []
      }
    case 'providers.testConnection':
      return {
        success: true
      }
    case 'providers.getRateLimitStatus':
      return {
        status: {
          config: {
            enabled: false,
            qpsLimit: 1
          },
          currentQps: 0,
          queueLength: 0,
          lastRequestTime: 0
        }
      }
    case 'providers.refreshModels':
      return {
        success: true
      }
    case 'providers.listOllamaModels':
    case 'providers.listOllamaRunningModels':
      return {
        models: []
      }
    case 'providers.pullOllamaModel':
      return {
        success: true
      }
    case 'providers.warmupAcpProcess':
      return {
        success: true
      }
    case 'providers.getAcpProcessConfigOptions':
      return {
        state: null
      }
    case 'models.getProviderCatalog':
      return {
        catalog: {
          providerModels: [],
          customModels: [],
          dbProviderModels: [],
          modelStatusMap: {}
        }
      }
    case 'models.listRuntime':
      return {
        models: []
      }
    case 'models.setStatus':
      return {
        enabled: payload.enabled ?? false
      }
    case 'models.addCustom':
      return {
        model: payload.model ?? null
      }
    case 'models.removeCustom':
      return {
        removed: true
      }
    case 'models.updateCustom':
      return {
        updated: true
      }
    case 'models.getConfig':
      return {
        config: createDefaultModelConfig()
      }
    case 'models.setConfig':
      return {
        config:
          typeof payload.config === 'object' && payload.config
            ? payload.config
            : createDefaultModelConfig()
      }
    case 'models.resetConfig':
      return {
        reset: true
      }
    case 'models.getProviderConfigs':
      return {
        configs: {}
      }
    case 'models.hasUserConfig':
      return {
        hasConfig: false
      }
    case 'models.exportConfigs':
      return {
        configs: {}
      }
    case 'models.importConfigs':
      return {
        imported: 0,
        skipped: 0
      }
    case 'models.getCapabilities':
      return {
        capabilities: createDefaultReasoningCapabilities()
      }
    default:
      return {}
  }
}

// Mock Electron IPC for renderer process
vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    send: vi.fn()
  }
}))

// Mock Vue Router
vi.mock('vue-router', () => ({
  createRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    go: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    currentRoute: { value: { path: '/', query: {}, params: {} } }
  })),
  createWebHashHistory: vi.fn(),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    go: vi.fn(),
    back: vi.fn(),
    forward: vi.fn()
  })),
  useRoute: vi.fn(() => ({
    path: '/',
    query: {},
    params: {},
    meta: {}
  }))
}))

// Mock Vue I18n
vi.mock('vue-i18n', () => ({
  createI18n: vi.fn(() => ({
    global: {
      t: vi.fn((key) => key),
      locale: 'zh-CN'
    }
  })),
  useI18n: vi.fn(() => ({
    t: vi.fn((key) => key),
    locale: { value: 'zh-CN' }
  }))
}))

// Mock Pinia
vi.mock('pinia', () => ({
  createPinia: vi.fn(() => ({})),
  defineStore: vi.fn(() => vi.fn(() => ({}))),
  storeToRefs: vi.fn((store) => store)
}))

function startupWorkloadStoreMock() {
  return {
    useStartupWorkloadStore: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      connected: false,
      runIds: { main: null, settings: null },
      mainTasks: [],
      settingsTasks: [],
      getTask: vi.fn(() => null),
      isTaskRunning: vi.fn(() => false),
      isSectionReady: vi.fn(() => false)
    }))
  }
}

vi.mock('@/stores/startupWorkloadStore', startupWorkloadStoreMock)
vi.mock('../src/renderer/src/stores/startupWorkloadStore', startupWorkloadStoreMock)

// Mock @iconify/vue
vi.mock('@iconify/vue', () => ({
  addCollection: vi.fn(),
  Icon: {
    name: 'Icon',
    template: '<span></span>'
  }
}))

// Mock window.api (preload exposed APIs)
Object.defineProperty(window, 'electron', {
  value: {
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
      removeListener: vi.fn(),
      send: vi.fn()
    }
  },
  writable: true
})

Object.defineProperty(window, 'api', {
  value: {
    copyImage: vi.fn(),
    copyText: vi.fn(),
    formatPathForInput: vi.fn((value) => value),
    getPathForFile: vi.fn(() => ''),
    getWebContentsId: vi.fn(() => 1),
    getWindowId: vi.fn(() => 1),
    openExternal: vi.fn(),
    readClipboardText: vi.fn(() => ''),
    toRelativePath: vi.fn((filePath: string, basePath?: string) => {
      if (typeof filePath !== 'string' || typeof basePath !== 'string') {
        return filePath
      }

      const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').trim()

      const normalizedFilePath = normalize(filePath)
      const normalizedBasePath = normalize(basePath)

      if (!normalizedBasePath) {
        return filePath
      }

      if (normalizedFilePath === normalizedBasePath) {
        return ''
      }

      const basePrefix = `${normalizedBasePath}/`
      if (normalizedFilePath.startsWith(basePrefix)) {
        return normalizedFilePath.slice(basePrefix.length)
      }

      return filePath
    }),
    devicePresenter: {
      getDeviceInfo: vi.fn(() =>
        Promise.resolve({
          platform: 'darwin',
          arch: 'arm64',
          version: '14.0.0'
        })
      )
    },
    windowPresenter: {
      minimize: vi.fn(),
      maximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn(() => Promise.resolve(false))
    }
  },
  writable: true
})

Object.defineProperty(window, 'deepchat', {
  value: {
    invoke: vi.fn((routeName: string, payload?: Record<string, unknown>) =>
      Promise.resolve(getDefaultDeepchatInvokeResult(routeName, payload))
    ),
    on: vi.fn(() => vi.fn())
  },
  writable: true
})

// Global Vue Test Utils configuration
config.global.stubs = {
  // Stub out complex components that don't need testing
  transition: true,
  'transition-group': true
}

// Global test setup
beforeEach(() => {
  // Clear all mocks before each test
  vi.clearAllMocks()
})

afterEach(() => {
  // Clean up after each test
  vi.restoreAllMocks()
})
