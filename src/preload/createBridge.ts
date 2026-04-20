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
      const contract = getDeepchatEventContract(eventName)
      const wrappedListener = (_event: IpcRendererEvent, envelope: unknown) => {
        if (!isDeepchatEventEnvelope(envelope) || envelope.name !== eventName) {
          return
        }

        listener(contract.payload.parse(envelope.payload))
      }

      ipcRenderer.on(DEEPCHAT_EVENT_CHANNEL, wrappedListener)

      return () => {
        ipcRenderer.removeListener(DEEPCHAT_EVENT_CHANNEL, wrappedListener)
      }
    }
  }
}
