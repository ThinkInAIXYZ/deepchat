import { type IPresenter } from '@shared/presenter'
import { toRaw } from 'vue'

// WebContentsId 缓存 (主进程通过此ID映射到tabId和windowId)
let cachedWebContentsId: number | null = null

// 获取当前webContentsId
export function getWebContentsId(): number | null {
  if (cachedWebContentsId !== null) {
    return cachedWebContentsId
  }

  try {
    // 通过preload API获取webContentsId
    cachedWebContentsId = window.api.getWebContentsId()
    return cachedWebContentsId
  } catch (error) {
    console.warn('Failed to get webContentsId:', error)
    return null
  }
}
// 安全的序列化函数，避免克隆不可序列化的对象
function safeSerialize(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime())
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => safeSerialize(item))
  }

  // 对于普通对象，只复制可序列化的属性
  const serialized: Record<string, unknown> = {}
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = (obj as Record<string, unknown>)[key]
      // 跳过函数、Symbol和其他不可序列化的值
      if (
        typeof value !== 'function' &&
        typeof value !== 'symbol' &&
        typeof value !== 'undefined'
      ) {
        serialized[key] = safeSerialize(value)
      }
    }
  }
  return serialized
}

function tryToRow(payloads: unknown[]) {
  try {
    return payloads.map((e) => safeSerialize(toRaw(e)))
  } catch (e) {
    console.warn('error on payload serialization', e)
    return payloads
  }
}

function createProxy(presenterName: string, safeCall: boolean) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Proxy({} as any, {
    get(_, functionName) {
      return async (...payloads: []) => {
        // 获取webContentsId (主进程将自动映射到tabId)
        const webContentsId = getWebContentsId()

        // 尝试 toRaw 获取原始对象并安全序列化
        const rawPayloads = tryToRow(payloads)

        // 在调用中记录webContentsId (主进程会自动映射到tab上下文)
        if (import.meta.env.VITE_LOG_IPC_CALL === '1') {
          console.log(
            `[Renderer IPC] WebContents:${webContentsId || 'unknown'} -> ${presenterName}.${functionName as string}`
          )
        }

        const invokedPromise = window.electron.ipcRenderer.invoke(
          'presenter:call',
          presenterName,
          functionName,
          ...rawPayloads
        )

        if (safeCall) {
          return await invokedPromise.catch((e: Error) => {
            console.warn(
              `[Renderer IPC Error] WebContents:${webContentsId} ${presenterName}.${functionName as string}:`,
              e
            )
            return null
          })
        } else {
          return await invokedPromise
        }
      }
    }
  })
}

interface UsePresenterOptions {
  safeCall?: boolean
}

export function usePresenter<T extends keyof IPresenter>(
  name: T,
  options?: UsePresenterOptions
): IPresenter[T] {
  const safeCall = options?.safeCall ?? true
  return createProxy(name, safeCall)
}
