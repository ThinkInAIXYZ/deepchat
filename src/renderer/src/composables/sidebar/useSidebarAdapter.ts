import { usePresenter } from '@/composables/usePresenter'
import { CONVERSATION_EVENTS } from '@/events'

type Unsubscribe = () => void

const noopUnsubscribe: Unsubscribe = () => undefined

export type ConversationListPayload = { dt: string; dtThreads: { id: string; title: string }[] }[]

export type ConversationActivatedPayload = { conversationId?: string }

export type SidebarAdapter = {
  getSetting: <T>(key: string) => Promise<T | undefined>
  setSetting: <T>(key: string, value: T) => Promise<void>
  onConversationListUpdated: (handler: (payload: ConversationListPayload) => void) => Unsubscribe
  onConversationActivated: (handler: (payload: ConversationActivatedPayload) => void) => Unsubscribe
}

export const useSidebarAdapter = (): SidebarAdapter => {
  const configPresenter = usePresenter('configPresenter')

  const subscribe = <T>(event: string, handler: (payload: T) => void): Unsubscribe => {
    if (!window?.electron?.ipcRenderer) return noopUnsubscribe

    const listener = (_event: unknown, payload: T) => {
      handler(payload)
    }

    window.electron.ipcRenderer.on(event, listener)

    return () => {
      window.electron.ipcRenderer.removeListener(event, listener)
    }
  }

  return {
    getSetting: <T>(key: string) => Promise.resolve(configPresenter.getSetting<T>(key)),
    setSetting: <T>(key: string, value: T) =>
      Promise.resolve(configPresenter.setSetting<T>(key, value)),
    onConversationListUpdated: (handler) =>
      subscribe<ConversationListPayload>(CONVERSATION_EVENTS.LIST_UPDATED, handler),
    onConversationActivated: (handler) =>
      subscribe<ConversationActivatedPayload>(CONVERSATION_EVENTS.ACTIVATED, handler)
  }
}
