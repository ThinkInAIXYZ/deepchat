import { vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Mock Electron modules for testing
vi.mock('electron', () => ({
  app: {
    getName: vi.fn(() => 'DeepChat'),
    getVersion: vi.fn(() => '0.2.3'),
    getPath: vi.fn(() => '/mock/path'),
    on: vi.fn(),
    quit: vi.fn(),
    isReady: vi.fn(() => true)
  },
  BrowserWindow: vi.fn(() => ({
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
    webContents: {
      send: vi.fn(),
      on: vi.fn(),
      isDestroyed: vi.fn(() => false)
    },
    isDestroyed: vi.fn(() => false),
    close: vi.fn(),
    show: vi.fn(),
    hide: vi.fn()
  })),
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
    removeHandler: vi.fn()
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    send: vi.fn()
  },
  shell: {
    openExternal: vi.fn()
  }
}))

// Some renderer composables call `window.api` / `window.electron` (preload-exposed APIs).
// Provide light-weight shims for unit tests that mount components or instantiate stores.
if (typeof window !== 'undefined') {
  // Ensure a working localStorage/sessionStorage for @vueuse/core `useStorage` usage.
  const makeMemoryStorage = () => {
    const data = new Map<string, string>()
    return {
      get length() {
        return data.size
      },
      clear() {
        data.clear()
      },
      getItem(key: string) {
        return data.has(key) ? data.get(key)! : null
      },
      key(index: number) {
        return Array.from(data.keys())[index] ?? null
      },
      removeItem(key: string) {
        data.delete(key)
      },
      setItem(key: string, value: string) {
        data.set(key, String(value))
      }
    }
  }

  if (!('localStorage' in window) || typeof window.localStorage?.getItem !== 'function') {
    Object.defineProperty(window, 'localStorage', { value: makeMemoryStorage(), writable: true })
  }

  if (!('sessionStorage' in window) || typeof window.sessionStorage?.getItem !== 'function') {
    Object.defineProperty(window, 'sessionStorage', { value: makeMemoryStorage(), writable: true })
  }

  if (!('api' in window)) {
    Object.defineProperty(window, 'api', {
      value: {
        getWebContentsId: vi.fn(() => 1)
      },
      writable: true
    })
  }

  if (!('electron' in window)) {
    Object.defineProperty(window, 'electron', {
      value: {
        ipcRenderer: {
          invoke: vi.fn(async () => null),
          on: vi.fn(),
          removeAllListeners: vi.fn(),
          send: vi.fn()
        }
      },
      writable: true
    })
  }
}

// Mock Vue I18n for renderer unit tests (vitest runs both main + renderer projects).
// Many Vue components call `useI18n()` directly; in unit tests we just want `t()` to
// return the key so snapshots/assertions stay stable without needing app.use(i18n).
vi.mock('vue-i18n', () => ({
  createI18n: vi.fn(() => ({
    global: {
      t: vi.fn((key: string) => key),
      locale: 'en-US'
    }
  })),
  useI18n: vi.fn(() => ({
    t: vi.fn((key: string) => key),
    te: vi.fn(() => true),
    locale: { value: 'en-US' }
  }))
}))

// Mock file system operations
vi.mock('fs', () => {
  const promises = {
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
    rm: vi.fn(),
    stat: vi.fn()
  }

  // Some modules in the codebase use `import fs from 'fs'` (default import). Others use
  // `import * as fs from 'fs'`. Provide both shapes so tests don't fail when modules are mixed.
  const fsMock = {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    constants: {
      R_OK: 4,
      W_OK: 2
    },
    promises
  }

  return { ...fsMock, default: fsMock }
})

// Mock path module
vi.mock('path', async () => {
  const actual = await vi.importActual('path')
  return {
    ...actual,
    join: vi.fn((...args) => args.join('/')),
    resolve: vi.fn((...args) => args.join('/'))
  }
})

// Global test setup
beforeEach(() => {
  // Renderer unit tests often call Pinia stores directly (or via mounted components).
  // Ensure an active Pinia instance exists to avoid "getActivePinia()" errors.
  setActivePinia(createPinia())

  // Clear all mocks before each test
  vi.clearAllMocks()
})

afterEach(() => {
  // Clean up after each test
  vi.restoreAllMocks()
})
