// Minimal Electron mock for Vitest in Node environment
export const app = {
  getName: () => 'DeepChat',
  getVersion: () => '0.0.0-test',
  getPath: (_: string) => '/mock/path',
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
  openExternal: async (_url: string) => {}
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
      isDestroyed: () => false
    },
    isDestroyed: () => false,
    close: () => {},
    show: () => {},
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
  buildFromTemplate: (_: any[]) => ({ popup: () => {} })
}

export const Tray = function () {
  return {
    setToolTip: (_: string) => {},
    setContextMenu: (_: any) => {}
  }
} as unknown as { new (...args: any[]): any }
