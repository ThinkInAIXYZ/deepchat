import { vi, beforeEach, afterEach } from 'vitest'
import { __resetElectronMockState } from './mocks/electron'

const electronMockState = vi.hoisted(() => ({
  loginItemSettings: { openAtLogin: false }
}))

type DeepchatPayload = Record<string, unknown> | undefined

function getDefaultDeepchatInvokeResult(
  routeName: string,
  payload: DeepchatPayload = {}
): Record<string, unknown> {
  switch (routeName) {
    case 'browser.getStatus':
    case 'browser.loadUrl':
    case 'browser.goBack':
    case 'browser.goForward':
    case 'browser.reload':
      return { status: null }
    case 'browser.attachCurrentWindow':
      return { attached: true }
    case 'browser.updateCurrentWindowBounds':
      return { updated: true }
    case 'browser.detach':
      return { detached: true }
    case 'browser.destroy':
      return { destroyed: true }
    case 'workspace.readDirectory':
    case 'workspace.expandDirectory':
    case 'workspace.searchFiles':
      return { nodes: [] }
    case 'workspace.readFilePreview':
      return { preview: null }
    case 'workspace.resolveMarkdownLinkedFile':
      return { resolution: null }
    case 'workspace.getGitStatus':
      return { state: null }
    case 'workspace.getGitDiff':
      return { diff: '' }
    case 'file.getMimeType':
      return { mimeType: 'text/plain' }
    case 'file.prepareFile':
    case 'file.prepareDirectory':
      return {
        file: {
          path: typeof payload?.path === 'string' ? payload.path : '',
          name: 'mock-file'
        }
      }
    case 'file.readFile':
      return { content: '' }
    case 'file.isDirectory':
      return { isDirectory: false }
    case 'file.writeImageBase64':
      return { path: '/tmp/mock-image.png' }
    case 'device.getInfo':
      return {
        info: {
          platform: 'darwin',
          arch: 'arm64',
          version: '14.0.0'
        }
      }
    case 'device.getAppVersion':
      return { version: '1.0.0-test' }
    case 'device.selectDirectory':
      return { canceled: true, filePaths: [] }
    case 'device.restartApp':
      return { restarted: true }
    case 'device.sanitizeSvg':
      return {
        content: typeof payload?.svgContent === 'string' ? payload.svgContent : ''
      }
    default:
      return {}
  }
}

function installRendererTestGlobals(): void {
  if (typeof window === 'undefined') {
    return
  }

  ;(window as any).electron = {
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
      removeListener: vi.fn(),
      send: vi.fn()
    }
  }

  ;(window as any).api = {
    copyImage: vi.fn(),
    copyText: vi.fn(),
    formatPathForInput: vi.fn((value: string) => value),
    getPathForFile: vi.fn(() => ''),
    getWebContentsId: vi.fn(() => 1),
    getWindowId: vi.fn(() => 1),
    openExternal: vi.fn(),
    readClipboardText: vi.fn(() => ''),
    toRelativePath: vi.fn((filePath: string) => filePath)
  }

  ;(window as any).deepchat = {
    invoke: vi.fn((routeName: string, payload?: Record<string, unknown>) =>
      Promise.resolve(getDefaultDeepchatInvokeResult(routeName, payload))
    ),
    on: vi.fn(() => vi.fn())
  }
}

// Mock Electron modules for testing
vi.mock('electron', () => ({
  __resetElectronMockState: vi.fn(() => {
    electronMockState.loginItemSettings = { openAtLogin: false }
  }),
  app: {
    getName: vi.fn(() => 'DeepChat'),
    getVersion: vi.fn(() => '0.2.3'),
    getAppPath: vi.fn(() => '/mock/app'),
    getPath: vi.fn(() => '/mock/path'),
    isPackaged: false,
    getLoginItemSettings: vi.fn(() => ({ ...electronMockState.loginItemSettings })),
    setLoginItemSettings: vi.fn((settings: { openAtLogin?: boolean }) => {
      electronMockState.loginItemSettings = {
        ...electronMockState.loginItemSettings,
        ...settings
      }
    }),
    on: vi.fn(),
    quit: vi.fn(),
    isReady: vi.fn(() => true)
  },
  BrowserWindow: vi.fn(() => ({
    id: 1,
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
    webContents: {
      id: 2,
      send: vi.fn(),
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      setBackgroundThrottling: vi.fn(),
      setFrameRate: vi.fn(),
      openDevTools: vi.fn(),
      isDestroyed: vi.fn(() => false)
    },
    isDestroyed: vi.fn(() => false),
    setContentProtection: vi.fn(),
    setBackgroundColor: vi.fn(),
    setHiddenInMissionControl: vi.fn(),
    setSkipTaskbar: vi.fn(),
    close: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn()
  })),
  nativeImage: {
    createFromPath: vi.fn(() => ({}))
  },
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
    openExternal: vi.fn(),
    openPath: vi.fn()
  }
}))

// Mock shared logger so importing it never pulls in electron's `app`
// (test files that need to assert on logger calls re-mock it locally)
vi.mock('@shared/logger', () => ({
  __esModule: true,
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    verbose: vi.fn(),
    debug: vi.fn(),
    silly: vi.fn(),
    log: vi.fn()
  },
  setLoggingEnabled: vi.fn(),
  originalConsole: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn()
  }
}))

// Mock file system operations
vi.mock('fs', () => {
  const mockedFs = {
    existsSync: vi.fn(),
    statSync: vi.fn(),
    accessSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    mkdtempSync: vi.fn(),
    rmSync: vi.fn(),
    readdirSync: vi.fn(),
    renameSync: vi.fn(),
    constants: {
      X_OK: 1
    },
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

installRendererTestGlobals()

// Global test setup
beforeEach(() => {
  // Clear all mocks before each test
  vi.clearAllMocks()
  electronMockState.loginItemSettings = { openAtLogin: false }
  __resetElectronMockState()
  installRendererTestGlobals()
})

afterEach(() => {
  // Clean up after each test
  vi.restoreAllMocks()
})
