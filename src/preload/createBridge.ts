import type { IpcRendererEvent } from 'electron'
import type { DeepchatBridge } from '@shared/contracts/bridge'
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

function isDeepchatEventEnvelope(value: unknown): value is DeepchatEventEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const maybeEnvelope = value as { name?: unknown }
  return typeof maybeEnvelope.name === 'string' && hasDeepchatEventContract(maybeEnvelope.name)
}

type SharedEventListener = (payload: unknown) => void

type BridgeEventRuntime = {
  attached: boolean
  dispatch: (event: IpcRendererEvent, envelope: unknown) => void
  listeners: Map<DeepchatEventName, Set<SharedEventListener>>
}

const bridgeEventRuntimes = new WeakMap<IpcRendererLike, BridgeEventRuntime>()

function getBridgeEventRuntime(ipcRenderer: IpcRendererLike): BridgeEventRuntime {
  const existingRuntime = bridgeEventRuntimes.get(ipcRenderer)
  if (existingRuntime) {
    return existingRuntime
  }

  const runtime: BridgeEventRuntime = {
    attached: false,
    listeners: new Map(),
    dispatch: (_event: IpcRendererEvent, envelope: unknown) => {
      if (!isDeepchatEventEnvelope(envelope)) {
        return
      }

      const listeners = runtime.listeners.get(envelope.name)
      if (!listeners || listeners.size === 0) {
        return
      }

      const contract = getDeepchatEventContract(envelope.name)
      const payload = contract.payload.parse(envelope.payload)
      listeners.forEach((listener) => {
        listener(payload)
      })
    }
  }

  bridgeEventRuntimes.set(ipcRenderer, runtime)
  return runtime
}

export function createBridge(ipcRenderer: IpcRendererLike): DeepchatBridge {
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
      return contract.output.parse(output)
    },

    on<T extends DeepchatEventName>(
      eventName: T,
      listener: (payload: DeepchatEventEnvelope<T>['payload']) => void
    ) {
      const runtime = getBridgeEventRuntime(ipcRenderer)
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
