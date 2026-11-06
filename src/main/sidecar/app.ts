/**
 * Sidecar entry that runs the app's real main process.
 *
 * Instead of serving routes one by one, this starts `startApp()` with an
 * Electron-compatible shim: every service, route and IPC handler the desktop app
 * registers keeps working, and the Go shell provides the window, the page and the
 * native surfaces.
 *
 * Protocol on stdin/stdout is the same as `entry.ts`: one JSON request per line,
 * one JSON response per line, plus unsolicited `{event}` lines.
 */
import { createInterface } from 'node:readline'
import { stringifyDeepchatJson } from '@shared/deepchatJson'
import { DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'
import {
  emitAppBeforeQuit,
  installElectronShimHooks,
  invokeIpc,
  nativeIpcEvent,
  handleNativeWindowNotification,
  sendIpc,
  whenIpcHandlerRegistered,
  type IpcRequestSource
} from '@/platform/node/electron'
import { startApp } from '@/appMain'
import { SidecarLifecycle } from './lifecycle'
import {
  configureNativeSettingsSnapshot,
  configureNativeWindowCommands,
  resolveNativeWindowCommand,
  runWithNativeCaller
} from '@/platform/node/nativeWindowCommands'
import {
  NATIVE_SPLASH_CHANNEL_ROUTE,
  NATIVE_SPLASH_DOCUMENT_PREFIX,
  NATIVE_SPLASH_INLINE_MAX_LENGTH,
  NATIVE_SPLASH_INLINE_PREFIX
} from '@/platform/node/nativeWindowProtocol'
import { configGetLanguageRoute } from '@shared/contracts/routes/config.routes'
import type { DesktopLanguageState } from '@/desktop/settings'
import {
  handleNativeProtocolRoute,
  NATIVE_PROTOCOL_BEGIN_ROUTE,
  NATIVE_PROTOCOL_CANCEL_ROUTE,
  NATIVE_PROTOCOL_READ_ROUTE
} from '@/platform/node/nativeProtocol'

// Keep one private path for protocol envelopes. Everything else reaches stderr,
// including shared/logger's pre-bound console and direct process.stdout writes.
const protocolStdoutWrite = process.stdout.write.bind(process.stdout)
process.stdout.write = ((...args: unknown[]) => {
  return Reflect.apply(process.stderr.write, process.stderr, args) as boolean
}) as typeof process.stdout.write

const write = (payload: unknown): void => {
  protocolStdoutWrite(`${stringifyDeepchatJson(payload)}\n`)
}

const nativeWindowId = Number(process.env.DEEPCHAT_NATIVE_WINDOW_ID)
if (
  !process.env.DEEPCHAT_NATIVE_WINDOW_ID ||
  !Number.isSafeInteger(nativeWindowId) ||
  nativeWindowId <= 0
) {
  throw new Error('sidecar requires the real native startup window ID')
}

const lifecycle = new SidecarLifecycle(emitAppBeforeQuit)
configureNativeWindowCommands(write)
installElectronShimHooks({
  sendEvent: (name, payload, windowId) =>
    write({ event: name, payload, source: windowId === undefined ? undefined : { windowId } }),
  quitRequested: () => lifecycle.notifyQuitRequested()
})

// Ingest Go's current-generation descriptor before any app window is restored.
configureNativeSettingsSnapshot(process.env.DEEPCHAT_NATIVE_SETTINGS_SNAPSHOT)

// Register the waiter before startup: route registration is the existing signal
// that the real dispatcher and its route registry are ready to accept work.
const appReady = whenIpcHandlerRegistered(DEEPCHAT_ROUTE_INVOKE_CHANNEL)
let readSplashLanguageState: (() => DesktopLanguageState) | undefined
startApp({
  registerSplashLanguageReader: (read) => {
    readSplashLanguageState = read
  }
})

type SidecarRequest = {
  id?: number
  route?: string
  input?: unknown
  event?: string
  command?: string
  payload?: unknown
  result?: unknown
  error?: unknown
  source?: IpcRequestSource
}

const nativeSplashChannels = new Set([
  'database-security:unlock-submit',
  'database-security:unlock-cancel',
  'database-security:recovery-submit',
  'database-security:recovery-cancel'
])

const nativeProtocolRoutes = new Set([
  NATIVE_PROTOCOL_BEGIN_ROUTE,
  NATIVE_PROTOCOL_READ_ROUTE,
  NATIVE_PROTOCOL_CANCEL_ROUTE
])

function isNativeSplashSource(source?: IpcRequestSource): boolean {
  const url = source?.documentUrl
  return Boolean(
    url &&
    (url.startsWith(NATIVE_SPLASH_DOCUMENT_PREFIX) ||
      (url.startsWith(NATIVE_SPLASH_INLINE_PREFIX) &&
        url.length <= NATIVE_SPLASH_INLINE_MAX_LENGTH))
  )
}

const handleLine = async (line: string): Promise<void> => {
  const trimmed = line.trim()
  if (!trimmed) return

  let request: SidecarRequest
  try {
    request = JSON.parse(trimmed)
  } catch (error) {
    write({ error: `bad request: ${String(error)}` })
    return
  }

  if (typeof request.command === 'string') {
    console.error('[sidecar] rejected a command from the Go side')
    return
  }
  if (typeof request.event === 'string') {
    try {
      handleNativeWindowNotification(request.event, request.payload, request.source?.windowId)
    } catch (error) {
      console.error('[sidecar] native window notification failed', error)
    }
    return
  }
  if (resolveNativeWindowCommand(request.id, request.result, request.error)) return
  if (typeof request.id === 'number' && request.id < 0) {
    console.warn('[sidecar] discarding a late or unknown native command response')
    return
  }

  if (!request.route) {
    write({ id: request.id, error: 'bad request: route is required' })
    return
  }
  if (lifecycle.isStopping()) {
    write({ id: request.id, error: 'sidecar is shutting down' })
    return
  }

  if (request.route === NATIVE_SPLASH_CHANNEL_ROUTE) {
    if (!isNativeSplashSource(request.source)) {
      write({ id: request.id, error: 'native splash source is not allowed' })
      return
    }
    const input = request.input
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      write({ id: request.id, error: 'native splash input is invalid' })
      return
    }
    const { channel, payload } = input as { channel?: unknown; payload?: unknown }
    if (typeof channel !== 'string' || !nativeSplashChannels.has(channel)) {
      write({ id: request.id, error: 'native splash channel is not allowed' })
      return
    }
    try {
      sendIpc(channel, payload, request.source)
      write({ id: request.id, result: {} })
    } catch (error) {
      write({ id: request.id, error: error instanceof Error ? error.message : String(error) })
    }
    return
  }

  if (
    request.route === configGetLanguageRoute.name &&
    isNativeSplashSource(request.source) &&
    readSplashLanguageState
  ) {
    try {
      configGetLanguageRoute.input.parse(request.input ?? {})
      write({
        id: request.id,
        result: configGetLanguageRoute.output.parse(readSplashLanguageState())
      })
    } catch (error) {
      write({ id: request.id, error: error instanceof Error ? error.message : String(error) })
    }
    return
  }

  if (nativeProtocolRoutes.has(request.route)) {
    try {
      await appReady
      // Cancellation is allowed for the original owner after navigation, so an
      // old reader can be released. Begin/read require a current native sender.
      if (request.route !== NATIVE_PROTOCOL_CANCEL_ROUTE) nativeIpcEvent(request.source)
      const value = await runWithNativeCaller(request.source!, () =>
        handleNativeProtocolRoute(request.route!, request.input, request.source)
      )
      write({ id: request.id, result: value ?? {} })
    } catch (error) {
      write({ id: request.id, error: error instanceof Error ? error.message : String(error) })
    }
    return
  }

  try {
    await appReady
    const { handled, value } = await invokeIpc(
      DEEPCHAT_ROUTE_INVOKE_CHANNEL,
      [request.route, request.input ?? {}],
      request.source
    )
    if (!handled) {
      throw new Error('main process route dispatcher is unavailable')
    }
    write({ id: request.id, result: value ?? {} })
  } catch (error) {
    write({ id: request.id, error: error instanceof Error ? error.message : String(error) })
  }
}

const input = createInterface({ input: process.stdin })
input.on('line', (line) => {
  void handleLine(line)
})
input.on('close', () => {
  void lifecycle.shutdown().then(
    () => process.exit(0),
    (error) => {
      console.error('[sidecar] Graceful shutdown failed:', error)
      process.exitCode = 1
      process.exit(1)
    }
  )
})

// Unlocking an encrypted database can legitimately wait for user input indefinitely.
// The transport startup deadline must not treat that wait as an unresponsive process.
write({ event: 'sidecar.process.ready', payload: { mode: 'full-main-process' } })

// Normal routes still require the real dispatcher. Main-window loading, successful
// recovery and restart backoff use that stronger signal, not transport readiness.
void appReady.then(() => {
  write({ event: 'sidecar.app.started', payload: { mode: 'full-main-process' } })
})
