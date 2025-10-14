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

function createProxy(presenterName: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Proxy({} as any, {
    get(_, functionName) {
      return async (...payloads: []) => {
        try {
          // 获取webContentsId (主进程将自动映射到tabId)
          const webContentsId = getWebContentsId()

          // 先使用 toRaw 获取原始对象，然后安全序列化
          const rawPayloads = payloads.map((e) => safeSerialize(toRaw(e)))

          // 在调用中记录webContentsId (主进程会自动映射到tab上下文)
          if (import.meta.env.VITE_LOG_IPC_CALL === '1') {
            console.log(
              `[Renderer IPC] WebContents:${webContentsId || 'unknown'} -> ${presenterName}.${functionName as string}`
            )
          }

          return await window.electron.ipcRenderer
            .invoke('presenter:call', presenterName, functionName, ...rawPayloads)
            .catch((e: Error) => {
              console.warn(
                `[Renderer IPC Error] WebContents:${webContentsId} ${presenterName}.${functionName as string}:`,
                e
              )
              return null
            })
        } catch (error) {
          console.warn('error on payload serialization', functionName, error)
          // 如果序列化失败，尝试直接传递原始数据
          return await window.electron.ipcRenderer
            .invoke('presenter:call', presenterName, functionName, ...payloads)
            .catch((e: Error) => {
              console.warn('error on presenter invoke fallback', functionName, e)
              return null
            })
        }
      }
    }
  })
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const presentersProxy: IPresenter = new Proxy({} as any, {
  get(_, presenterName) {
    return createProxy(presenterName as string)
  }
})

export function usePresenter<T extends keyof IPresenter>(name: T): IPresenter[T] {
  return presentersProxy[name]
}
