/**
 * An Electron-compatible module for the Node sidecar.
 *
 * The sidecar runs the app's real main process. Rather than port each service to
 * a new interface, this module gives the code the Electron API it already uses,
 * backed by the Go shell: windows belong to the shell, events go out over the
 * sidecar's event channel, and IPC handlers are invoked by the shell's request
 * loop instead of Chromium's.
 *
 * Everything here is deliberately narrow. A method the shell owns (creating a
 * real window, showing a dialog, reading screen geometry) does the smallest
 * thing that keeps the caller alive and records that it was asked, instead of
 * pretending it succeeded. Search for "not implemented" to find those spots.
 */
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { nodeAppHost } from '../appHost'
import { nodeProcessHost } from '../processHost'
import { nodeSecretHost } from '../secretHost'
import { nodeShellHost } from '../shellHost'

type Listener = (...args: never[]) => void

class Emitter {
  private readonly emitter = new EventEmitter()

  on(event: string, listener: Listener): this {
    this.emitter.on(event, listener as never)
    return this
  }

  once(event: string, listener: Listener): this {
    this.emitter.once(event, listener as never)
    return this
  }

  off(event: string, listener: Listener): this {
    this.emitter.off(event, listener as never)
    return this
  }

  removeListener(event: string, listener: Listener): this {
    this.emitter.off(event, listener as never)
    return this
  }

  removeAllListeners(event?: string): this {
    this.emitter.removeAllListeners(event)
    return this
  }

  emit(event: string, ...args: unknown[]): boolean {
    return this.emitter.emit(event, ...args)
  }
}

// ---------------------------------------------------------------------------
// Hooks the sidecar installs before the app starts.
// ---------------------------------------------------------------------------

export type SidecarHooks = {
  /** Sends one application event to its assigned native window, or a control event without one. */
  sendEvent(name: string, payload: unknown, windowId?: number): void
  /** Reports the business shutdown flow allowing the sidecar process to exit. */
  quitRequested?(): void
}

let hooks: SidecarHooks = {
  sendEvent: () => undefined
}

export function installElectronShimHooks(next: Partial<SidecarHooks>): void {
  hooks = { ...hooks, ...next }
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/**
 * Absorbs members the app calls that the shell, not the sidecar, implements.
 * Each unknown member is reported once so the gap is visible in the log instead
 * of turning into a runtime crash deep inside startup.
 */
function noopSurface<T extends object>(target: T, label: string): T {
  const reported = new Set<string>()
  return new Proxy(target, {
    get(object, property, receiver) {
      const value = Reflect.get(object, property, receiver)
      if (value !== undefined) return value
      if (typeof property !== 'string') return value
      if (!reported.has(property)) {
        reported.add(property)
        console.warn(`[sidecar] ${label}.${property} is not implemented; ignored`)
      }
      return () => undefined
    }
  })
}

const defaultSessionRaw = {
  setProxy: async (): Promise<void> => undefined,
  resolveProxy: async (): Promise<string> => 'DIRECT',
  clearCache: async (): Promise<void> => undefined,
  clearStorageData: async (): Promise<void> => undefined,
  setPermissionRequestHandler: (): void => undefined,
  webRequest: {
    onBeforeSendHeaders: (): void => undefined,
    onHeadersReceived: (): void => undefined
  },
  fromPartition: () => defaultSession,
  getStoragePath: (): string => path.join(nodeAppHost.getPath('userData'), 'Session')
}

let nextWebContentsId = 1
let nextWindowId = 1

export type IpcRequestSource = Readonly<{
  windowId: number
  documentUrl: string
}>

/** Sender records are bound by native window ID; nested views have no identity until Go binds them. */
class ShimWebContents extends Emitter {
  readonly id = nextWebContentsId++
  private destroyed = false
  private ownerWindowId: number | null = null
  private reportedUnownedEvent = false
  readonly session = defaultSession
  readonly navigationHistory = { canGoBack: () => false, goBack: () => undefined }
  /** The actual calling document, or empty before the first native request. */
  private url = ''
  readonly mainFrame = { url: this.url, routingId: 1, processId: process.pid }

  bindWindow(windowId: number): void {
    if (this.ownerWindowId !== null && this.ownerWindowId !== windowId) {
      throw new Error('webContents cannot be rebound to another native window')
    }
    this.ownerWindowId = windowId
  }

  updateDocument(documentUrl: string): void {
    this.url = documentUrl
    this.mainFrame.url = documentUrl
  }

  send(channel: string, ...args: unknown[]): void {
    // DeepChat sends one envelope per event to its native window's current page.
    const [envelope] = args
    const name =
      envelope && typeof envelope === 'object' && 'name' in envelope
        ? String((envelope as { name: unknown }).name)
        : channel
    const payload =
      envelope && typeof envelope === 'object' && 'payload' in envelope
        ? (envelope as { payload: unknown }).payload
        : args[0]
    if (this.ownerWindowId === null) {
      // A nested view cannot be promoted to its parent window implicitly. That
      // would deliver private messages to the wrong document.
      if (!this.reportedUnownedEvent) {
        this.reportedUnownedEvent = true
        console.error(
          `[sidecar] discarding events from webContents(${this.id}) without a native window owner`
        )
      }
      return
    }
    if (this.destroyed) return
    hooks.sendEvent(name, payload, this.ownerWindowId)
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  markDestroyed(): void {
    this.destroyed = true
  }

  async executeJavaScript(): Promise<unknown> {
    // Documented migration stub: the product Bridge deliberately has no generic
    // Eval operation; opt-in native UI automation is not a runtime implementation.
    return undefined
  }

  setWindowOpenHandler(): void {}
  setBackgroundThrottling(): void {}
  setFrameRate(): void {}
  openDevTools(): void {}
  closeDevTools(): void {}
  async loadURL(): Promise<void> {}
  async loadFile(): Promise<void> {}
  focus(): void {}
  reload(): void {}
  getURL(): string {
    return this.url
  }
  onDidFinishLoad(): void {}
}

class ShimBrowserWindow extends Emitter {
  private readonly placeholderId = -nextWindowId++
  private nativeWindowId: number | null = null
  readonly webContents = new ShimWebContents()
  private visible = true
  private maximized = false
  private fullScreen = false
  private destroyed = false

  constructor(readonly options: Record<string, unknown> = {}) {
    super()
  }

  get id(): number {
    return this.nativeWindowId ?? this.placeholderId
  }

  bindNativeWindow(windowId: number): void {
    if (!Number.isSafeInteger(windowId) || windowId <= 0) {
      throw new Error('native window ID must be a positive integer')
    }
    if (this.nativeWindowId === windowId) return
    if (this.nativeWindowId !== null) {
      throw new Error('window cannot be rebound to another native window')
    }
    const existing = nativeWindows.get(windowId)
    if (existing && existing !== this) {
      if (!existing.isDestroyed() && !existing.webContents.isDestroyed()) {
        throw new Error('native window ID already belongs to another window')
      }
      nativeWindows.delete(windowId)
    }
    this.webContents.bindWindow(windowId)
    this.nativeWindowId = windowId
    nativeWindows.set(windowId, this)
  }

  show(): void {
    this.visible = true
  }
  showInactive(): void {
    this.visible = true
  }
  hide(): void {
    this.visible = false
  }
  focus(): void {}
  blur(): void {}
  isVisible(): boolean {
    return this.visible
  }
  isFocused(): boolean {
    return true
  }
  maximize(): void {
    this.maximized = true
  }
  unmaximize(): void {
    this.maximized = false
  }
  isMaximized(): boolean {
    return this.maximized
  }
  setFullScreen(value: boolean): void {
    this.fullScreen = value
  }
  isFullScreen(): boolean {
    return this.fullScreen
  }
  setTitle(): void {}
  setMenuBarVisibility(): void {}
  setAutoHideMenuBar(): void {}
  setResizable(): void {}
  setMinimumSize(): void {}
  setSize(): void {}
  getSize() {
    return [1280, 820]
  }
  setPosition(): void {}
  getPosition() {
    return [0, 0]
  }
  setOpacity(): void {}
  setHasShadow(): void {}
  setVisibleOnAllWorkspaces(): void {}
  setSkipTaskbar(): void {}
  setRepresentedFilename(): void {}
  setDocumentEdited(): void {}
  setWindowButtonVisibility(): void {}
  setTrafficLightPosition(): void {}
  setVibrancy(): void {}
  setBackgroundColor(): void {}
  addBrowserView(): void {}
  removeBrowserView(): void {}
  setBrowserView(): void {}
  getContentBounds() {
    return { x: 0, y: 0, width: 1280, height: 820 }
  }
  async loadURL(): Promise<void> {}
  async loadFile(): Promise<void> {}
  isLoading(): boolean {
    return false
  }
  async capturePage() {
    // Screenshots come from the shell (Window.CapturePage); an empty frame here
    // keeps callers from mistaking it for a real capture.
    return noImage
  }
  print(): void {}
  getNativeWindowHandle(): Buffer {
    return Buffer.alloc(0)
  }
  setBounds(): void {}
  getBounds() {
    return { x: 0, y: 0, width: 1280, height: 820 }
  }
  setContentProtection(): void {}
  setAlwaysOnTop(): void {}
  moveTop(): void {}
  destroy(): void {
    if (nativeWindows.get(this.id)?.webContents === this.webContents) {
      nativeWindows.delete(this.id)
    }
    this.destroyed = true
    this.webContents.markDestroyed()
  }
  close(): void {
    this.destroy()
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  isMinimized(): boolean {
    return false
  }
  minimize(): void {}

  static getAllWindows(): ShimBrowserWindow[] {
    return windows
  }
  static getFocusedWindow(): ShimBrowserWindow | null {
    return windows[0] ?? null
  }
  static fromWebContents(contents: ShimWebContents): ShimBrowserWindow | null {
    return windows.find((window) => window.webContents === contents) ?? null
  }
  static fromId(id: number): ShimBrowserWindow | null {
    return windows.find((window) => window.id === id) ?? null
  }
  static getFocusedWebContents(): ShimWebContents | null {
    return windows[0]?.webContents ?? null
  }
}

const windows: ShimBrowserWindow[] = []
const nativeWindows = new Map<number, ShimBrowserWindow>()

function senderForNativeSource(source: IpcRequestSource): {
  window: ShimBrowserWindow
  sender: ShimWebContents
} {
  const bound = nativeWindows.get(source.windowId)
  if (!bound || bound.isDestroyed() || bound.webContents.isDestroyed()) {
    throw new Error('IPC source has no live native window binding')
  }
  return { window: bound, sender: bound.webContents }
}

const BrowserWindowCtor = function BrowserWindowCtor(
  this: unknown,
  options?: Record<string, unknown>
) {
  const window = new ShimBrowserWindow(options)
  windows.push(window)
  return noopSurface(window, `BrowserWindow(${window.id})`)
}

// Statics the app relies on to map a page back to its window.
Object.assign(BrowserWindowCtor, {
  getAllWindows: () => windows,
  getFocusedWindow: () => windows.find((window) => !window.isDestroyed()) ?? null,
  fromWebContents: (contents: ShimWebContents) =>
    windows.find((window) => window.webContents === contents) ?? null,
  fromId: (id: number) => windows.find((window) => window.id === id) ?? null,
  getFocusedWebContents: () => windows.find((window) => !window.isDestroyed())?.webContents ?? null
})

export const BrowserWindow = BrowserWindowCtor as unknown as typeof import('electron').BrowserWindow

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const ipcHandlers = new Map<string, IpcHandler>()
const ipcListeners = new Map<string, Listener[]>()
const ipcInvokeListeners: Array<(event: unknown) => void> = []
const ipcHandlerWaiters = new Map<string, Set<() => void>>()

function notifyIpcHandlerRegistered(channel: string): void {
  const waiters = ipcHandlerWaiters.get(channel)
  ipcHandlerWaiters.delete(channel)
  for (const resolve of waiters ?? []) resolve()
}

/** Resolves after the real main process registers a named invoke handler. */
export function whenIpcHandlerRegistered(channel: string): Promise<void> {
  if (ipcHandlers.has(channel)) return Promise.resolve()
  return new Promise((resolve) => {
    const waiters = ipcHandlerWaiters.get(channel) ?? new Set<() => void>()
    waiters.add(resolve)
    ipcHandlerWaiters.set(channel, waiters)
  })
}

export const ipcMain = {
  handle(channel: string, handler: IpcHandler): void {
    ipcHandlers.set(channel, handler)
    notifyIpcHandlerRegistered(channel)
  },
  handleOnce(channel: string, handler: IpcHandler): void {
    ipcHandlers.set(channel, handler)
    notifyIpcHandlerRegistered(channel)
  },
  removeHandler(channel: string): void {
    ipcHandlers.delete(channel)
  },
  on(channel: string, listener: Listener): void {
    const list = ipcListeners.get(channel) ?? []
    list.push(listener)
    ipcListeners.set(channel, list)
  },
  removeListener(channel: string, listener: Listener): void {
    const list = ipcListeners.get(channel)
    if (!list) return
    ipcListeners.set(
      channel,
      list.filter((candidate) => candidate !== listener)
    )
  },
  removeAllListeners(channel?: string): void {
    if (channel) ipcListeners.delete(channel)
    else ipcListeners.clear()
  },
  onInvoke(listener: (event: unknown) => void): void {
    ipcInvokeListeners.push(listener)
  }
}

/**
 * Runs one renderer invocation, the way Chromium would hand it to `ipcMain`.
 * Returns `undefined` when nothing registered the channel, so the caller can fall
 * back to its own handlers.
 */
export async function invokeIpc(
  channel: string,
  args: unknown[],
  source?: IpcRequestSource
): Promise<{ handled: boolean; value?: unknown }> {
  if (
    !source ||
    !Number.isSafeInteger(source.windowId) ||
    source.windowId <= 0 ||
    typeof source.documentUrl !== 'string' ||
    source.documentUrl.length === 0
  ) {
    throw new Error('IPC request requires a valid native window source')
  }
  // Source metadata comes from Go's verified caller, never renderer input.
  // Lack of a live binding is an error; creating a synthetic sender would let
  // an unknown document impersonate any registered application window.
  const handler = ipcHandlers.get(channel)
  if (!handler) return { handled: false }
  const { window, sender } = senderForNativeSource(source)
  sender.updateDocument(source.documentUrl)
  const event = {
    sender,
    frameId: 1,
    processId: process.pid,
    // The authorizer requires the frame to be the sender's main frame.
    senderFrame: sender.mainFrame
  }
  if (process.env.DEEPCHAT_DEBUG_IPC) {
    console.error('[sidecar] ipc event', {
      sameFrame: event.senderFrame === sender.mainFrame,
      windowId: window.id,
      webContentsId: sender.id,
      destroyed: sender.isDestroyed()
    })
  }
  for (const listener of ipcInvokeListeners) listener(event)
  return { handled: true, value: await handler(event, ...args) }
}

export const webContents = {
  fromId(id: number): ShimWebContents | null {
    return windows.find((window) => window.webContents.id === id)?.webContents ?? null
  },
  getAllWebContents(): ShimWebContents[] {
    return windows.map((window) => window.webContents)
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const appEmitter = new Emitter()
const overriddenPaths = new Map<string, string>()

// Matches Electron's before-quit contract: listeners can prevent the native
// action while they perform asynchronous teardown, then call app.quit() again.
export function emitAppBeforeQuit(): boolean {
  let prevented = false
  appEmitter.emit('before-quit', {
    preventDefault: () => {
      prevented = true
    }
  })
  return !prevented
}

export const app = Object.assign(appEmitter, {
  isReady: (): boolean => true,
  async whenReady(): Promise<void> {},
  getPath: (name: string): string =>
    overriddenPaths.get(name) ?? nodeAppHost.getPath(name as never),
  setPath: (name: string, value: string): void => {
    overriddenPaths.set(name, value)
  },
  getVersion: (): string => nodeAppHost.getVersion(),
  getAppPath: (): string => nodeAppHost.getAppPath(),
  getName: (): string => nodeAppHost.getName(),
  getLocale: (): string => nodeAppHost.getLocale(),
  isPackaged: nodeAppHost.isPackaged(),
  setName: (): void => undefined,
  setAppUserModelId: (): void => undefined,
  setActivationPolicy: (): void => undefined,
  setAsDefaultProtocolClient: (): boolean => true,
  removeAsDefaultProtocolClient: (): boolean => true,
  requestSingleInstanceLock: (): boolean => true,
  releaseSingleInstanceLock: (): void => undefined,
  getLoginItemSettings: () => ({ openAtLogin: nodeAppHost.getLoginItemEnabled() }),
  setLoginItemSettings: (settings: { openAtLogin?: boolean }): void => {
    nodeAppHost.setLoginItemEnabled(Boolean(settings.openAtLogin))
  },
  // Quitting is the shell's decision: it owns the process tree and the window.
  // Exiting here would kill the sidecar while the page is still asking it things.
  quit: (): void => {
    if (!emitAppBeforeQuit()) {
      return
    }
    hooks.sendEvent('app.quit.requested', {})
    hooks.quitRequested?.()
  },
  exit: (): void => {
    hooks.sendEvent('app.quit.requested', {})
    hooks.quitRequested?.()
  },
  relaunch: (): void => {
    console.warn('[sidecar] app.relaunch is handled by the shell')
  },
  getAppMetrics: (): unknown[] => [],
  getGPUInfo: async () => ({ gpuDevice: [] }),
  commandLine: {
    appendSwitch: (): void => undefined,
    hasSwitch: (): boolean => false,
    getSwitchValue: (): string => ''
  },
  dock: {
    show: (): void => undefined,
    hide: (): void => undefined,
    setMenu: (): void => undefined
  },
  on: appEmitter.on.bind(appEmitter),
  once: appEmitter.once.bind(appEmitter),
  off: appEmitter.off.bind(appEmitter),
  removeListener: appEmitter.removeListener.bind(appEmitter)
})

// ---------------------------------------------------------------------------
// Everything the app touches but the shell owns.
// ---------------------------------------------------------------------------

const defaultSession = noopSurface(defaultSessionRaw, 'session')

export const session = {
  defaultSession,
  fromPartition: (partition: string) => ({ ...defaultSession, partition }),
  fromPath: (partitionPath: string) => ({ ...defaultSession, partition: partitionPath })
}

export const protocol = {
  registerSchemesAsPrivileged: (): void => undefined,
  handle: (): boolean => true,
  unhandle: (): void => undefined,
  isProtocolHandled: async (): Promise<boolean> => true
}

export const Menu = {
  setApplicationMenu: (): void => undefined,
  getApplicationMenu: (): null => null,
  buildFromTemplate: (template: unknown[]) => ({ template, items: template }),
  sendActionToFirstResponder: (): void => undefined
}

export const MenuItem = function MenuItemCtor(options: unknown) {
  return options
} as unknown as typeof import('electron').MenuItem

export const Tray = function TrayCtor(icon: unknown) {
  return {
    setToolTip: (): void => undefined,
    setContextMenu: (): void => undefined,
    setIgnoreDoubleClickEvents: (): void => undefined,
    on: (): unknown => undefined,
    destroy: (): void => undefined,
    icon
  }
} as unknown as typeof import('electron').Tray

export const Notification = Object.assign(
  function NotificationCtor(options: unknown) {
    return {
      show: (): void => undefined,
      close: (): void => undefined,
      on: (): unknown => undefined,
      options
    }
  },
  {
    isSupported: (): boolean => false
  }
) as unknown as typeof import('electron').Notification

export const dialog = {
  showOpenDialog: async () => ({ canceled: false, filePaths: [] }),
  showOpenDialogSync: () => [],
  showSaveDialog: async () => ({ canceled: false, filePath: '' }),
  showMessageBox: async () => ({ response: 0, checkboxChecked: false }),
  showMessageBoxSync: (): number => 0,
  showErrorBox: (): void => undefined
}

export const shell = nodeShellHost

export const screen = {
  getPrimaryDisplay: () => ({
    workArea: { x: 0, y: 0, width: 1440, height: 900 },
    workAreaSize: { width: 1440, height: 900 },
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
    size: { width: 1440, height: 900 },
    scaleFactor: 2
  }),
  getAllDisplays: () => [screen.getPrimaryDisplay()],
  getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  getDisplayNearestPoint: () => screen.getPrimaryDisplay(),
  on: (): void => undefined,
  off: (): void => undefined
}

export const noImage = {
  isEmpty: (): boolean => true,
  getSize: () => ({ width: 0, height: 0 }),
  resize: () => noImage,
  toPNG: (): Buffer => Buffer.alloc(0),
  toDataURL: (): string => '',
  toBitmap: (): Buffer => Buffer.alloc(0),
  toJPEG: (): Buffer => Buffer.alloc(0),
  setTemplateImage: (): void => undefined,
  isTemplateImage: (): boolean => false,
  crop: () => noImage,
  getAspectRatio: (): number => 0
}

const emptyImage = {
  isEmpty: (): boolean => true,
  getSize: () => ({ width: 0, height: 0 }),
  resize: () => emptyImage,
  toPNG: (): Buffer => Buffer.alloc(0),
  toDataURL: (): string => '',
  toBitmap: (): Buffer => Buffer.alloc(0)
}

export const nativeImage = {
  createFromPath: () => noImage,
  createFromBuffer: () => noImage,
  createFromDataURL: () => noImage,
  createEmpty: () => noImage
}

export const clipboard = {
  readText: (): string => '',
  writeText: (): void => undefined,
  readImage: () => emptyImage,
  writeImage: (): void => undefined,
  has: (): boolean => false,
  readBuffer: (): Buffer => Buffer.alloc(0)
}

export const net = {
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  isOnline: (): boolean => true
}

export const safeStorage = {
  isEncryptionAvailable: (): boolean => nodeSecretHost.isAvailable(),
  encryptString: (value: string): Buffer => nodeSecretHost.encryptString(value),
  decryptString: (value: Buffer): string => nodeSecretHost.decryptString(value),
  setUsePlainTextEncryption: (): void => undefined,
  getSelectedStorageBackend: (): string => nodeSecretHost.selectedBackend() ?? 'unknown'
}

export const nativeTheme = {
  get shouldUseDarkColors(): boolean {
    return process.env.DEEPCHAT_SYSTEM_THEME_DARK === '1'
  },
  get themeSource(): string {
    return 'system'
  },
  set themeSource(_value: string) {},
  on: (): void => undefined,
  off: (): void => undefined
}

export const globalShortcut = {
  register: (): boolean => false,
  unregister: (): void => undefined,
  unregisterAll: (): void => undefined,
  isRegistered: (): boolean => false
}

export const utilityProcess = {
  fork: (modulePath: string, args: string[], options: Record<string, unknown>) =>
    nodeProcessHost.fork(modulePath, args, {
      serviceName: String(options?.serviceName ?? 'utility'),
      env: (options?.env as NodeJS.ProcessEnv | undefined) ?? process.env,
      stdio: (options?.stdio as 'ignore' | 'inherit' | 'pipe' | undefined) ?? 'ignore',
      execArgv: (options?.execArgv as string[] | undefined) ?? undefined
    })
}

export class WebContentsView {
  readonly webContents = new ShimWebContents()
  constructor(readonly options: Record<string, unknown> = {}) {}
  setBounds(): void {}
  getBounds() {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
}

/** Utilities the app imports from Electron that have no state here. */
export const powerMonitor = { on: (): void => undefined, off: (): void => undefined }

export type BrowserWindowType = ShimBrowserWindow
export type WebContentsType = ShimWebContents
export type IpcMain = typeof ipcMain
export type IpcMainInvokeEvent = { sender: unknown; frameId: number; processId: number }
export type IpcRendererEvent = { sender: unknown }
export type Session = typeof defaultSession
export type NativeImage = typeof emptyImage
export type MenuItemConstructorOptions = Record<string, unknown>
export type NotificationConstructorOptions = Record<string, unknown>
export type Rectangle = { x: number; y: number; width: number; height: number }
export type WebContents = ShimWebContents
export { randomUUID, os }
