import { vi, beforeEach, afterEach } from 'vitest'

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

// Mock file system operations
vi.mock('fs', () => {
  const mockedFs = {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    promises: {
      access: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      readdir: vi.fn(),
      stat: vi.fn()
    }
  }

  return {
    __esModule: true,
    ...mockedFs,
    default: mockedFs
  }
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
  // Clear all mocks before each test
  vi.clearAllMocks()
})

afterEach(() => {
  // Clean up after each test
  vi.restoreAllMocks()
})
