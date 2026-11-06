import type { IpcRendererEvent } from 'electron'
import type { DeepchatBridge } from '@shared/contracts/bridge'
import { reviveDeepchatJson } from '@shared/deepchatJson'
import { DEEPCHAT_EVENT_CHANNEL, DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'
import {
  getDeepchatEventContract,
  hasDeepchatEventContract,
  type DeepchatEventEnvelope,
  type DeepchatEventName
} from '@shared/contracts/events'
import {
  getDeepchatRouteContract,
  hasDeepchatRouteContract,
  type DeepchatRouteInput,
  type DeepchatRouteName,
  type DeepchatRouteOutput
} from '@shared/contracts/routes'

type IpcRendererLike = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: IpcRendererEvent, ...args: unknown[]) => void): void
  removeListener(
    channel: string,
    listener: (event: IpcRendererEvent, ...args: unknown[]) => void
  ): void
}

type BridgeOptions = {
  jsonTransport?: boolean
}

const identity = (value: unknown): unknown => value

function isDeepchatEventEnvelope(value: unknown): value is DeepchatEventEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const maybeEnvelope = value as { name?: unknown }
  return typeof maybeEnvelope.name === 'string' && hasDeepchatEventContract(maybeEnvelope.name)
}

type SharedEventListener = (payload: unknown) => void

// The main process already validates `chat.stream.updated` blocks before publishing
// (cloneBlocksForRenderer), and this is a trusted same-app channel. The payload is the
// full block snapshot resent every ~120ms during streaming, so the per-listener Zod
// deep-parse here is a measurable hot-path cost. Only a structural shape check runs.
const STREAM_VALIDATION_BYPASS_EVENTS: ReadonlySet<string> = new Set(['chat.stream.updated'])

function isPlausibleStreamSnapshot(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false
  }
  const snapshot = payload as { sessionId?: unknown; requestId?: unknown; blocks?: unknown }
  return (
    typeof snapshot.sessionId === 'string' &&
    typeof snapshot.requestId === 'string' &&
    Array.isArray(snapshot.blocks)
  )
}

type BridgeEventRuntime = {
  attached: boolean
  dispatch: (event: IpcRendererEvent, envelope: unknown) => void
  listeners: Map<DeepchatEventName, Set<SharedEventListener>>
  revivePayload: (value: unknown) => unknown
}

const bridgeEventRuntimes = new WeakMap<IpcRendererLike, BridgeEventRuntime>()

function getBridgeEventRuntime(
  ipcRenderer: IpcRendererLike,
  jsonTransport: boolean
): BridgeEventRuntime {
  const existingRuntime = bridgeEventRuntimes.get(ipcRenderer)
  if (existingRuntime) {
    return existingRuntime
  }

  const runtime: BridgeEventRuntime = {
    attached: false,
    listeners: new Map(),
    revivePayload: jsonTransport ? reviveDeepchatJson : identity,
    dispatch: (_event: IpcRendererEvent, envelope: unknown) => {
      if (!isDeepchatEventEnvelope(envelope)) {
        return
      }

      const listeners = runtime.listeners.get(envelope.name)
      if (!listeners || listeners.size === 0) {
        return
      }

      const contract = getDeepchatEventContract(envelope.name)
      let payload: unknown
      try {
        const revivedPayload = runtime.revivePayload(envelope.payload)
        if (STREAM_VALIDATION_BYPASS_EVENTS.has(envelope.name)) {
          if (!isPlausibleStreamSnapshot(revivedPayload)) {
            console.error(`[DeepchatBridge] Malformed ${envelope.name} payload: shape check failed`)
            return
          }
          payload = revivedPayload
        } else {
          payload = contract.payload.parse(revivedPayload)
        }
      } catch (error) {
        console.error(`[DeepchatBridge] Invalid event payload for ${envelope.name}:`, error)
        return
      }
      listeners.forEach((listener) => {
        try {
          listener(payload)
        } catch (error) {
          console.error(`[DeepchatBridge] Event listener failed for ${envelope.name}:`, error)
        }
      })
    }
  }

  bridgeEventRuntimes.set(ipcRenderer, runtime)
  return runtime
}

export function createBridge(
  ipcRenderer: IpcRendererLike,
  options: BridgeOptions = {}
): DeepchatBridge {
  const revivePayload = options.jsonTransport ? reviveDeepchatJson : identity
  return {
    async invoke<T extends DeepchatRouteName>(
      routeName: T,
      input: DeepchatRouteInput<T>
    ): Promise<DeepchatRouteOutput<T>> {
      if (!hasDeepchatRouteContract(routeName)) {
        throw new Error(`Unknown deepchat route: ${routeName}`)
      }

      const contract = getDeepchatRouteContract(routeName)
      const normalizedInput = contract.input.parse(input)
      const output = await ipcRenderer.invoke(
        DEEPCHAT_ROUTE_INVOKE_CHANNEL,
        routeName,
        normalizedInput
      )
      return contract.output.parse(revivePayload(output)) as DeepchatRouteOutput<T>
    },

    on<T extends DeepchatEventName>(
      eventName: T,
      listener: (payload: DeepchatEventEnvelope<T>['payload']) => void
    ) {
      const runtime = getBridgeEventRuntime(ipcRenderer, options.jsonTransport === true)
      const listeners = runtime.listeners.get(eventName) ?? new Set<SharedEventListener>()
      listeners.add(listener as SharedEventListener)
      runtime.listeners.set(eventName, listeners)

      if (!runtime.attached) {
        ipcRenderer.on(DEEPCHAT_EVENT_CHANNEL, runtime.dispatch)
        runtime.attached = true
      }

      return () => {
        const currentListeners = runtime.listeners.get(eventName)
        if (!currentListeners) {
          return
        }

        currentListeners.delete(listener as SharedEventListener)
        if (currentListeners.size === 0) {
          runtime.listeners.delete(eventName)
        }

        if (runtime.attached && runtime.listeners.size === 0) {
          ipcRenderer.removeListener(DEEPCHAT_EVENT_CHANNEL, runtime.dispatch)
          runtime.attached = false
        }
      }
    }
  }
}
