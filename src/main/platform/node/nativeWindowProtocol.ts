export const NATIVE_SPLASH_CHANNEL_ROUTE = 'native.splash.channel'
export const NATIVE_SPLASH_DOCUMENT_PREFIX = 'mygo://localhost/splash/index.html'
export const NATIVE_SPLASH_INLINE_PREFIX = 'data:text/html;charset=utf-8,'
export const NATIVE_SPLASH_INLINE_MAX_LENGTH = 65_536

export type NativeWindowRole = 'main' | 'settings' | 'splash'

export type NativeCaller = Readonly<{
  windowId: number
  documentUrl: string
}>

/** Native, never renderer-supplied, state for a registered top-level window. */
export type NativeWindowDescriptor = Readonly<{
  windowId: number
  role: NativeWindowRole
  documentUrl: string
  visible: boolean
  focused: boolean
  sequence?: number
  closeRequested?: boolean
}>

export type NativeWindowBounds = {
  width: number
  height: number
  minWidth: number
  minHeight: number
  x: number
  y: number
}

export type NativeWindowCommand = {
  command: 'native.window'
  id: number
  input: Readonly<{
    action:
      | 'ensure_settings'
      | 'ensure_splash'
      | 'load_document'
      | 'show'
      | 'hide'
      | 'focus'
      | 'focus_app'
      | 'close'
    windowId?: number
    documentUrl?: string
    width?: number
    height?: number
    minWidth?: number
    minHeight?: number
    x?: number
    y?: number
  }>
  source?: NativeCaller
  /** Trusted sidecar code, never a renderer-input field. */
  host?: true
}

export function parseNativeWindowDescriptor(value: unknown): NativeWindowDescriptor {
  if (!value || typeof value !== 'object') throw new Error('Invalid native window descriptor')
  const state = value as Record<string, unknown>
  if (
    !Number.isSafeInteger(state.windowId) ||
    (state.windowId as number) <= 0 ||
    (state.role !== 'main' && state.role !== 'settings' && state.role !== 'splash') ||
    typeof state.documentUrl !== 'string' ||
    typeof state.visible !== 'boolean' ||
    typeof state.focused !== 'boolean' ||
    (state.sequence !== undefined &&
      (!Number.isSafeInteger(state.sequence) || (state.sequence as number) < 0)) ||
    (state.closeRequested !== undefined && typeof state.closeRequested !== 'boolean')
  ) {
    throw new Error('Invalid native window descriptor')
  }
  const rawUrl = state.documentUrl as string
  const splashInline =
    state.role === 'splash' &&
    rawUrl.startsWith(NATIVE_SPLASH_INLINE_PREFIX) &&
    rawUrl.length <= NATIVE_SPLASH_INLINE_MAX_LENGTH
  if (rawUrl !== '' && rawUrl !== 'about:blank' && !splashInline) {
    let document: URL
    try {
      document = new URL(rawUrl)
    } catch {
      throw new Error('Invalid native window document URL')
    }
    const validPath =
      state.role === 'main'
        ? document.pathname === '/' || document.pathname === '/index.html'
        : state.role === 'settings'
          ? document.pathname === '/settings/index.html'
          : document.pathname === '/splash/index.html'
    if (
      document.protocol !== 'mygo:' ||
      document.host !== 'localhost' ||
      document.username !== '' ||
      document.password !== '' ||
      !validPath
    ) {
      throw new Error('Invalid native window document URL')
    }
  }
  return state as unknown as NativeWindowDescriptor
}
