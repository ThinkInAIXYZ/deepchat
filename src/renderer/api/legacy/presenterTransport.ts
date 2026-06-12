import { type IPresenter, type IRemoteControlPresenter } from '@shared/presenter'
import { toRaw } from 'vue'
import { getLegacyIpcRenderer, getLegacyWebContentsId } from './runtime'

function safeSerialize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value
  }

  if (value instanceof Date) {
    return new Date(value.getTime())
  }

  if (Array.isArray(value)) {
    return value.map((item) => safeSerialize(item))
  }

  const serialized: Record<string, unknown> = {}

  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      continue
    }

    const field = (value as Record<string, unknown>)[key]
    if (typeof field === 'function' || typeof field === 'symbol') {
      continue
    }

    serialized[key] = safeSerialize(field)
  }

  return serialized
}

function toSerializablePayloads(payloads: unknown[]) {
  try {
    return payloads.map((payload) => safeSerialize(toRaw(payload)))
  } catch (error) {
    console.warn('error on payload serialization', error)
    return payloads
  }
}

function createLegacyProxy(channel: string, safeCall: boolean, presenterName?: string) {
  return new Proxy(
    {},
    {
      get(_, functionName) {
        return async (...payloads: unknown[]) => {
          const ipcRenderer = getLegacyIpcRenderer()
          if (!ipcRenderer) {
            throw new Error('window.electron.ipcRenderer is not available')
          }

          const webContentsId = getLegacyWebContentsId()
          const rawPayloads = toSerializablePayloads(payloads)
          const callTarget = presenterName
            ? `${presenterName}.${String(functionName)}`
            : `remoteControlPresenter.${String(functionName)}`

          if (import.meta.env.VITE_LOG_IPC_CALL === '1') {
            console.log(`[Renderer IPC] WebContents:${webContentsId || 'unknown'} -> ${callTarget}`)
          }

          const invokedPromise =
            presenterName != null
              ? ipcRenderer.invoke(channel, presenterName, functionName, ...rawPayloads)
              : ipcRenderer.invoke(channel, functionName, ...rawPayloads)

          if (!safeCall) {
            return await invokedPromise
          }

          return await invokedPromise.catch((error: Error) => {
            console.warn(`[Renderer IPC Error] WebContents:${webContentsId} ${callTarget}:`, error)
            return null
          })
        }
      }
    }
  )
}

interface UsePresenterOptions {
  safeCall?: boolean
}

export function useLegacyPresenterTransport<T extends keyof IPresenter>(
  name: T,
  options?: UsePresenterOptions
): IPresenter[T] {
  const safeCall = options?.safeCall ?? true
  return createLegacyProxy('presenter:call', safeCall, name) as IPresenter[T]
}

export function useLegacyRemoteControlPresenterTransport(
  options?: UsePresenterOptions
): IRemoteControlPresenter {
  const safeCall = options?.safeCall ?? true
  return createLegacyProxy('remoteControlPresenter:call', safeCall) as IRemoteControlPresenter
}
