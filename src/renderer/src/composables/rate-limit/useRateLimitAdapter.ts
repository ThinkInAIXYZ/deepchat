import { usePresenter } from '@/composables/usePresenter'
import { RATE_LIMIT_EVENTS } from '@/events'

export interface RateLimitStatus {
  config: {
    enabled: boolean
    qpsLimit: number
  }
  currentQps: number
  queueLength: number
  lastRequestTime: number
}

type RateLimitEventPayload = {
  providerId: string
  config?: { enabled?: boolean }
}

export function useRateLimitAdapter() {
  const llmPresenter = usePresenter('llmproviderPresenter')

  const subscribeRateLimitEvents = (handler: (payload: RateLimitEventPayload) => void) => {
    const listener = (_event: unknown, payload: RateLimitEventPayload) => {
      if (!payload) return
      handler(payload)
    }

    window.electron.ipcRenderer.on(RATE_LIMIT_EVENTS.CONFIG_UPDATED, listener)
    window.electron.ipcRenderer.on(RATE_LIMIT_EVENTS.REQUEST_EXECUTED, listener)
    window.electron.ipcRenderer.on(RATE_LIMIT_EVENTS.REQUEST_QUEUED, listener)

    return () => {
      window.electron.ipcRenderer.removeListener(RATE_LIMIT_EVENTS.CONFIG_UPDATED, listener)
      window.electron.ipcRenderer.removeListener(RATE_LIMIT_EVENTS.REQUEST_EXECUTED, listener)
      window.electron.ipcRenderer.removeListener(RATE_LIMIT_EVENTS.REQUEST_QUEUED, listener)
    }
  }

  return {
    getProviderRateLimitStatus: llmPresenter.getProviderRateLimitStatus,
    subscribeRateLimitEvents
  }
}
