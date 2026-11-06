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
import { DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'
import {
  emitAppBeforeQuit,
  installElectronShimHooks,
  invokeIpc,
  whenIpcHandlerRegistered,
  type IpcRequestSource
} from '@/platform/node/electron'
import { startApp } from '@/appMain'
import { SidecarLifecycle } from './lifecycle'

// Keep one private path for protocol envelopes. Everything else reaches stderr,
// including shared/logger's pre-bound console and direct process.stdout writes.
const protocolStdoutWrite = process.stdout.write.bind(process.stdout)
process.stdout.write = ((...args: unknown[]) => {
  return Reflect.apply(process.stderr.write, process.stderr, args) as boolean
}) as typeof process.stdout.write

const write = (payload: unknown): void => {
  protocolStdoutWrite(`${JSON.stringify(payload)}\n`)
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
installElectronShimHooks({
  sendEvent: (name, payload, windowId) =>
    write({ event: name, payload, source: windowId === undefined ? undefined : { windowId } }),
  quitRequested: () => lifecycle.notifyQuitRequested()
})

// Register the waiter before startup: route registration is the existing signal
// that the real dispatcher and its route registry are ready to accept work.
const appReady = whenIpcHandlerRegistered(DEEPCHAT_ROUTE_INVOKE_CHANNEL)
startApp()

type SidecarRequest = {
  id?: number
  route?: string
  input?: unknown
  source?: IpcRequestSource
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

  if (!request.route) {
    write({ id: request.id, error: 'bad request: route is required' })
    return
  }
  if (lifecycle.isStopping()) {
    write({ id: request.id, error: 'sidecar is shutting down' })
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

// Transport startup alone is not readiness. Advertise only after the real route
// dispatcher has been registered; requests already received await the same signal.
void appReady.then(() => {
  write({ event: 'sidecar.app.started', payload: { mode: 'full-main-process' } })
})
