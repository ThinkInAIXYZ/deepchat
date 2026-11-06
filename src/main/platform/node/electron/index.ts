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
import { statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { nodeAppHost } from '../appHost'
import { nodeProcessHost } from '../processHost'
import { nodeSecretHost } from '../secretHost'
import { nodeShellHost } from '../shellHost'
import {
  applyNativeWindowAction,
  cachedNativeWindowState,
  consumeNativeWindowReady,
  focusNativeApp,
  forgetNativeWindowState,
  recordNativeWindowReady,
  recordNativeWindowState,
  restoreAfterNativeCloseFailure,
  runWithNativeCaller,
  runWithNativeHost
} from '../nativeWindowCommands'
import { parseNativeWindowDescriptor, type NativeWindowDescriptor } from '../nativeWindowProtocol'

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
      // Electron windows are not thenables. A no-op `then` would make await call
      // it and wait forever instead of resolving to the wrapped object.
      if (property === 'then') return undefined
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

export type IpcRequestSource = import('../nativeWindowProtocol').NativeCaller

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
  async loadURL(url: string): Promise<void> {
    const owner = this.ownerWindowId === null ? undefined : nativeWindows.get(this.ownerWindowId)
    if (!owner) throw new Error('webContents.loadURL requires a bound native window')
    await owner.loadURL(url)
  }
  async loadFile(filePath: string, options?: import('electron').LoadFileOptions): Promise<void> {
    const owner = this.ownerWindowId === null ? undefined : nativeWindows.get(this.ownerWindowId)
    if (!owner) throw new Error('webContents.loadFile requires a bound native window')
    await owner.loadFile(filePath, options)
  }
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
  private nativeState: NativeWindowDescriptor | null = null
  private nativeCloseAttempt = 0
  private readonly unsupportedWindowOperations = new Set<string>()
  readonly webContents = new ShimWebContents()
  private maximized = false
  private fullScreen = false
  private destroyed = false

  constructor(readonly options: Record<string, unknown> = {}) {
    super()
  }

  get id(): number {
    return this.nativeWindowId ?? this.placeholderId
  }

  bindNativeWindow(descriptor: NativeWindowDescriptor): void {
    if (this.destroyed || this.webContents.isDestroyed()) {
      throw new Error('a destroyed window cannot claim a native identity')
    }
    const state = parseNativeWindowDescriptor(descriptor)
    if (this.nativeWindowId !== null) {
      if (this.nativeWindowId !== state.windowId || this.nativeState?.role !== state.role) {
        throw new Error('window cannot be rebound to another native window or role')
      }
      this.applyNativeState(state)
      return
    }
    const existing = nativeWindows.get(state.windowId)
    if (existing && existing !== this) {
      if (!existing.isDestroyed() && !existing.webContents.isDestroyed()) {
        throw new Error('native window ID already belongs to another window')
      }
      nativeWindows.delete(state.windowId)
    }
    this.webContents.bindWindow(state.windowId)
    this.nativeWindowId = state.windowId
    this.nativeState = state
    this.applyNativeState(state)
    nativeWindows.set(state.windowId, this)
    if (!state.visible && consumeNativeWindowReady(state.windowId)) {
      // Go can finish the first document before Node binds its wrapper. Replay
      // only once after this synchronous turn, when presenter listeners exist.
      queueMicrotask(() => {
        if (!this.destroyed) this.emit('ready-to-show')
      })
    }
  }

  getNativeWindowState(): NativeWindowDescriptor | null {
    return this.nativeState
  }

  applyNativeState(state: NativeWindowDescriptor): void {
    if (this.nativeWindowId !== state.windowId || this.nativeState?.role !== state.role) {
      throw new Error('native window state does not match its binding')
    }
    this.nativeState = state
    this.webContents.updateDocument(state.documentUrl)
  }

  reportUnboundOperation(action: string): void {
    if (this.unsupportedWindowOperations.has(action)) return
    this.unsupportedWindowOperations.add(action)
    console.error(`[sidecar] cannot ${action} an unbound BrowserWindow`)
  }

  performNativeAction(
    action: 'load_document' | 'show' | 'hide' | 'focus' | 'close',
    documentUrl?: string
  ): void {
    const state = this.nativeState
    if (this.destroyed || !state) {
      this.reportUnboundOperation(action)
      return
    }
    if (state.closeRequested) {
      if (action !== 'close') this.reportUnboundOperation(`${action} a closing native window`)
      return
    }
    const closing = { ...state, closeRequested: true }
    const closeAttempt = action === 'close' ? ++this.nativeCloseAttempt : 0
    if (action === 'close') {
      if (!recordNativeWindowState(closing)) {
        // A close can already have arrived when creation/binding failed before
        // this wrapper installed its own listener. Do not leak that wrapper.
        this.finalizeDestruction()
        return
      }
      this.nativeState = closing
    }
    void Promise.resolve()
      .then(() =>
        action === 'close'
          ? runWithNativeHost(() => applyNativeWindowAction(state, action, documentUrl))
          : applyNativeWindowAction(state, action, documentUrl)
      )
      .then((next) => {
        if (action !== 'close') this.applyNativeState(next)
      })
      .catch((error: unknown) => {
        if (action === 'close' && this.nativeCloseAttempt === closeAttempt && !this.destroyed) {
          // ready/focus may replace nativeState while this close is in flight.
          // Roll back only this attempt and preserve the latest native sequence.
          const latest = cachedNativeWindowState(state.windowId) ?? state
          this.nativeState = { ...latest, closeRequested: false }
          restoreAfterNativeCloseFailure(latest)
        }
        console.error(`[sidecar] native window ${action} failed`, error)
      })
  }

  async loadURL(documentUrl: string): Promise<void> {
    if (this.destroyed || !this.nativeState) {
      throw new Error('window.loadURL requires a bound native window')
    }
    const state = await applyNativeWindowAction(this.nativeState, 'load_document', documentUrl)
    this.applyNativeState(state)
  }

  async loadFile(filePath: string, _options?: import('electron').LoadFileOptions): Promise<void> {
    if (this.destroyed || !this.nativeState) {
      throw new Error('window.loadFile requires a bound native window')
    }
    const splashEntry = path.resolve(path.dirname(process.argv[1]), '../renderer/splash/index.html')
    if (this.nativeState.role === 'splash') {
      if (path.resolve(filePath) !== splashEntry) {
        throw new Error('window.loadFile only owns the initial native splash entry')
      }
      if (!statSync(splashEntry, { throwIfNoEntry: false })?.isFile()) {
        throw new Error('window.loadFile requires an existing native splash entry')
      }
      await this.loadURL('mygo://localhost/splash/index.html')
      return
    }
    const mainEntry = path.resolve(path.dirname(process.argv[1]), '../renderer/index.html')
    if (
      this.nativeState.role !== 'main' ||
      path.basename(filePath) !== 'index.html' ||
      path.resolve(filePath) !== mainEntry
    ) {
      throw new Error('window.loadFile only owns the initial primary renderer entry')
    }
    // Go already gates and loads the real primary renderer after dispatcher
    // readiness. Do not issue a duplicate navigation during bootstrap.
  }

  show(): void {
    this.performNativeAction('show')
  }
  showInactive(): void {
    this.performNativeAction('show')
  }
  hide(): void {
    if (!this.nativeState) {
      return
    }
    this.performNativeAction('hide')
  }
  focus(): void {
    this.performNativeAction('focus')
  }
  blur(): void {}
  isVisible(): boolean {
    return this.nativeState?.visible ?? false
  }
  isFocused(): boolean {
    return this.nativeState?.focused ?? false
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
  private finalizeDestruction(): void {
    if (this.destroyed) return
    if (this.nativeWindowId !== null && nativeWindows.get(this.nativeWindowId) === this) {
      nativeWindows.delete(this.nativeWindowId)
    }
    const index = windows.indexOf(this)
    if (index >= 0) windows.splice(index, 1)
    this.destroyed = true
    if (this.nativeState) this.nativeState = { ...this.nativeState, visible: false, focused: false }
    this.webContents.markDestroyed()
    this.emit('closed')
  }

  finalizeNativeClose(): void {
    this.finalizeDestruction()
  }

  destroy(): void {
    if (this.destroyed) return
    if (this.nativeState) {
      // Bound windows finish locally only after Go reports the actual close.
      this.performNativeAction('close')
      return
    }
    this.finalizeDestruction()
  }

  close(): void {
    if (this.destroyed) return
    if (this.nativeState) {
      this.performNativeAction('close')
      return
    }
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
    return windows.filter((window) => !window.isDestroyed())
  }
  static getFocusedWindow(): ShimBrowserWindow | null {
    return windows.find((window) => !window.isDestroyed() && window.isFocused()) ?? null
  }
  static fromWebContents(contents: ShimWebContents): ShimBrowserWindow | null {
    return (
      windows.find((window) => !window.isDestroyed() && window.webContents === contents) ?? null
    )
  }
  static fromId(id: number): ShimBrowserWindow | null {
    return windows.find((window) => !window.isDestroyed() && window.id === id) ?? null
  }
  static getFocusedWebContents(): ShimWebContents | null {
    const window = windows.find((candidate) => !candidate.isDestroyed() && candidate.isFocused())
    return window?.webContents ?? null
  }
}

const windows: ShimBrowserWindow[] = []
const nativeWindows = new Map<number, ShimBrowserWindow>()

export function handleNativeWindowNotification(
  name: string,
  rawState: unknown,
  windowId: unknown
): void {
  if (!Number.isSafeInteger(windowId) || (windowId as number) <= 0) {
    throw new Error('native window notification has no valid source')
  }
  if (
    name !== 'native.window.ready' &&
    name !== 'native.window.focused' &&
    name !== 'native.window.closed'
  ) {
    throw new Error('unsupported native window notification')
  }
  const state = parseNativeWindowDescriptor(rawState)
  if (state.windowId !== windowId) {
    throw new Error('native window notification source does not match its descriptor')
  }
  const window = nativeWindows.get(state.windowId)
  if (name === 'native.window.closed') {
    if (!forgetNativeWindowState(state.windowId, state.sequence)) return
    if (window) {
      window.applyNativeState(state)
      window.finalizeNativeClose()
    } else {
      console.warn(`[sidecar] native window ${name} has no bound target (${state.windowId})`)
    }
    return
  }
  if (!recordNativeWindowState(state)) return
  if (name === 'native.window.ready') recordNativeWindowReady(state.windowId)
  if (!window) {
    console.warn(`[sidecar] native window ${name} has no bound target (${state.windowId})`)
    return
  }
  window.applyNativeState(cachedNativeWindowState(state.windowId) ?? state)
  if (name === 'native.window.ready') {
    window.emit('ready-to-show')
    window.webContents.emit('did-finish-load')
  }
  if (name === 'native.window.focused') window.emit(state.focused ? 'focus' : 'blur')
}

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
  getAllWindows: () => windows.filter((window) => !window.isDestroyed()),
  getFocusedWindow: () =>
    windows.find((window) => !window.isDestroyed() && window.isFocused()) ?? null,
  fromWebContents: (contents: ShimWebContents) =>
    windows.find((window) => !window.isDestroyed() && window.webContents === contents) ?? null,
  fromId: (id: number) =>
    windows.find((window) => !window.isDestroyed() && window.id === id) ?? null,
  getFocusedWebContents: () =>
    windows.find((window) => !window.isDestroyed() && window.isFocused())?.webContents ?? null
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

function nativeIpcEvent(source?: IpcRequestSource): {
  window: ShimBrowserWindow
  sender: ShimWebContents
  event: Record<string, unknown>
} {
  if (
    !source ||
    !Number.isSafeInteger(source.windowId) ||
    source.windowId <= 0 ||
    typeof source.documentUrl !== 'string' ||
    source.documentUrl.length === 0
  ) {
    throw new Error('IPC request requires a valid native window source')
  }
  const { window, sender } = senderForNativeSource(source)
  sender.updateDocument(source.documentUrl)
  const event = {
    sender,
    frameId: 1,
    processId: process.pid,
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
  return { window, sender, event }
}

/** Delivers a raw send to existing `ipcMain.on` listeners with a verified source. */
export function sendIpc(channel: string, payload: unknown, source?: IpcRequestSource): void {
  const { event } = nativeIpcEvent(source)
  for (const listener of ipcListeners.get(channel) ?? []) {
    runWithNativeCaller(source!, () => listener(event as never, payload as never))
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
  // Source metadata comes from Go's verified caller, never renderer input.
  // Lack of a live binding is an error; creating a synthetic sender would let
  // an unknown document impersonate any registered application window.
  const handler = ipcHandlers.get(channel)
  if (!handler) return { handled: false }
  const { event } = nativeIpcEvent(source)
  for (const listener of ipcInvokeListeners) listener(event)
  return {
    handled: true,
    value: await runWithNativeCaller(source!, () => handler(event, ...args))
  }
}

export const webContents = {
  fromId(id: number): ShimWebContents | null {
    return (
      windows.find((window) => !window.webContents.isDestroyed() && window.webContents.id === id)
        ?.webContents ?? null
    )
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
  focus: (): void => {
    void focusNativeApp().catch((error: unknown) => {
      console.error('[sidecar] native application focus failed', error)
    })
  },
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
