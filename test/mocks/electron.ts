// Minimal Electron mock for Vitest in Node environment
const defaultLoginItemSettings = { openAtLogin: false }
let loginItemSettings = { ...defaultLoginItemSettings }

export const __resetElectronMockState = () => {
  loginItemSettings = { ...defaultLoginItemSettings }
}

export const app = {
  getName: () => 'DeepChat',
  getVersion: () => '0.0.0-test',
  getLocale: () => 'en-US',
  getSystemLocale: () => 'en-US',
  getAppPath: () => '/mock/app',
  getPath: (_: string) => '/mock/path',
  isPackaged: false,
  getLoginItemSettings: () => ({ ...loginItemSettings }),
  setLoginItemSettings: (settings: { openAtLogin?: boolean }) => {
    loginItemSettings = { ...loginItemSettings, ...settings }
  },
  isReady: () => true,
  on: (_event: string, _cb: (...args: any[]) => void) => {},
  relaunch: () => {},
  exit: () => {}
}

export const ipcMain = {
  on: (_: string, __: any) => {},
  handle: (_: string, __: any) => {},
  removeHandler: (_: string) => {}
}

export const ipcRenderer = {
  invoke: async (_: string, __?: any) => undefined,
  on: (_: string, __: any) => {},
  removeAllListeners: (_: string) => {},
  send: (_: string, __?: any) => {}
}

export const shell = {
  openExternal: async (_url: string) => {},
  openPath: async (_path: string) => ''
}

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (value: string) => Buffer.from(value, 'utf-8'),
  decryptString: (value: Buffer) => value.toString('utf-8')
}

export const dialog = {
  showOpenDialog: async (_opts?: any) => ({ canceled: true, filePaths: [] }),
  showMessageBoxSync: (_opts?: any) => 1
}

export const session = {}

export const BrowserWindow = function () {
  return {
    loadURL: (_: string) => {},
    loadFile: (_: string) => {},
    on: (_: string, __: any) => {},
    webContents: {
      send: (_: string, __?: any) => {},
      on: (_: string, __: any) => {},
      setWindowOpenHandler: (_: any) => {},
      isDestroyed: () => false
    },
    isDestroyed: () => false,
    close: () => {},
    show: () => {},
    focus: () => {},
    hide: () => {}
  }
} as unknown as { new (...args: any[]): any }

export const nativeImage = {
  createFromPath: (_: string) => ({})
}

export const screen = {
  getPrimaryDisplay: () => ({ workArea: { width: 1920, height: 1080 } }),
  getCursorScreenPoint: () => ({ x: 0, y: 0 })
}

export const Menu = {
  buildFromTemplate: (_: any[]) => ({ popup: () => {} }),
  setApplicationMenu: (_: any) => {}
}

export const Tray = function () {
  return {
    setToolTip: (_: string) => {},
    setContextMenu: (_: any) => {}
  }
} as unknown as { new (...args: any[]): any }
