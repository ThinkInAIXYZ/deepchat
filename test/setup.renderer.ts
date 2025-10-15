import { vi, beforeEach, afterEach } from 'vitest'
import { config } from '@vue/test-utils'

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

// Mock @iconify/vue
vi.mock('@iconify/vue', () => ({
  addCollection: vi.fn(),
  Icon: {
    name: 'Icon',
    template: '<span></span>'
  }
}))

// Mock window.api (preload exposed APIs)
Object.defineProperty(window, 'api', {
  value: {
    openExternal: vi.fn(),
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
