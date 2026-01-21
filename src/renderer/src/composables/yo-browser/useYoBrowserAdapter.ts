import { usePresenter } from '@/composables/usePresenter'
import { YO_BROWSER_EVENTS } from '@/events'
import type { BrowserTabInfo } from '@shared/types/browser'

type Unsubscribe = () => void

const noopUnsubscribe: Unsubscribe = () => undefined

export type YoBrowserAdapter = {
  listTabs: () => Promise<BrowserTabInfo[]>
  isVisible: () => Promise<boolean>
  show: (shouldFocus?: boolean) => Promise<void>
  hide: () => Promise<void>
  toggleVisibility: () => Promise<boolean>
  activateTab: (tabId: string) => Promise<void>
  onTabCreated: (handler: (tab: BrowserTabInfo) => void) => Unsubscribe
  onTabClosed: (handler: (tabId: string) => void) => Unsubscribe
  onTabActivated: (handler: (tabId: string) => void) => Unsubscribe
  onTabNavigated: (handler: (payload: { tabId: string; url: string }) => void) => Unsubscribe
  onTabUpdated: (handler: (tab: BrowserTabInfo) => void) => Unsubscribe
  onTabCountChanged: (handler: () => void) => Unsubscribe
  onWindowVisibilityChanged: (handler: (visible: boolean) => void) => Unsubscribe
}

export function useYoBrowserAdapter(): YoBrowserAdapter {
  const yoBrowserPresenter = usePresenter('yoBrowserPresenter')

  const subscribe = <T>(
    event: string,
    handler: (payload: T) => void,
    transform?: (...args: unknown[]) => T
  ): Unsubscribe => {
    if (!window?.electron?.ipcRenderer) return noopUnsubscribe

    const listener = (...args: unknown[]) => {
      const payload = transform ? transform(...args) : (args[1] as T)
      handler(payload)
    }

    window.electron.ipcRenderer.on(event, listener)

    return () => {
      window.electron.ipcRenderer.removeListener(event, listener)
    }
  }

  return {
    listTabs: () => yoBrowserPresenter.listTabs(),
    isVisible: () => yoBrowserPresenter.isVisible(),
    show: (shouldFocus?: boolean) => yoBrowserPresenter.show(shouldFocus),
    hide: () => yoBrowserPresenter.hide(),
    toggleVisibility: () => yoBrowserPresenter.toggleVisibility(),
    activateTab: (tabId: string) => yoBrowserPresenter.activateTab(tabId),
    onTabCreated: (handler) => subscribe<BrowserTabInfo>(YO_BROWSER_EVENTS.TAB_CREATED, handler),
    onTabClosed: (handler) => subscribe<string>(YO_BROWSER_EVENTS.TAB_CLOSED, handler),
    onTabActivated: (handler) => subscribe<string>(YO_BROWSER_EVENTS.TAB_ACTIVATED, handler),
    onTabNavigated: (handler) =>
      subscribe<{ tabId: string; url: string }>(YO_BROWSER_EVENTS.TAB_NAVIGATED, handler),
    onTabUpdated: (handler) => subscribe<BrowserTabInfo>(YO_BROWSER_EVENTS.TAB_UPDATED, handler),
    onTabCountChanged: (handler) =>
      subscribe<void>(YO_BROWSER_EVENTS.TAB_COUNT_CHANGED, handler, () => undefined),
    onWindowVisibilityChanged: (handler) =>
      subscribe<boolean>(YO_BROWSER_EVENTS.WINDOW_VISIBILITY_CHANGED, handler)
  }
}
