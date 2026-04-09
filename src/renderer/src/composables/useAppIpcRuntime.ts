import { DEEPLINK_EVENTS, NOTIFICATION_EVENTS, SHORTCUT_EVENTS } from '@/events'
import { createIpcSubscriptionScope } from '@/lib/ipcSubscription'

interface UseAppIpcRuntimeOptions {
  handleStartDeeplink: (event: unknown, payload?: unknown) => void
  showErrorToast: (error: { id: string; title: string; message: string; type: string }) => void
  handleZoomIn: () => void
  handleZoomOut: () => void
  handleZoomResume: () => void
  handleCreateNewConversation: () => void | Promise<void>
  handleToggleSidebar: () => void
  handleToggleWorkspace: () => void
  openSpotlight: () => void
  handleDataResetComplete: () => void
  handleSystemNotificationClick: (payload: unknown) => void
  getCurrentRouteName: () => string | symbol | null | undefined
}

export function useAppIpcRuntime(options: UseAppIpcRuntimeOptions) {
  let cleanupListeners: (() => void) | null = null

  const setup = () => {
    cleanupListeners?.()
    const scope = createIpcSubscriptionScope()

    scope.on(DEEPLINK_EVENTS.START, options.handleStartDeeplink)
    scope.on(NOTIFICATION_EVENTS.SHOW_ERROR, (_event, error) => {
      options.showErrorToast(error as { id: string; title: string; message: string; type: string })
    })
    scope.on(SHORTCUT_EVENTS.ZOOM_IN, options.handleZoomIn)
    scope.on(SHORTCUT_EVENTS.ZOOM_OUT, options.handleZoomOut)
    scope.on(SHORTCUT_EVENTS.ZOOM_RESUME, options.handleZoomResume)
    scope.on(SHORTCUT_EVENTS.CREATE_NEW_CONVERSATION, () => {
      if (options.getCurrentRouteName() !== 'chat') {
        return
      }

      void options.handleCreateNewConversation()
    })
    scope.on(SHORTCUT_EVENTS.TOGGLE_SIDEBAR, options.handleToggleSidebar)
    scope.on(SHORTCUT_EVENTS.TOGGLE_WORKSPACE, options.handleToggleWorkspace)
    scope.on(SHORTCUT_EVENTS.TOGGLE_SPOTLIGHT, options.openSpotlight)
    scope.on(NOTIFICATION_EVENTS.DATA_RESET_COMPLETE_DEV, options.handleDataResetComplete)
    scope.on(NOTIFICATION_EVENTS.SYS_NOTIFY_CLICKED, (_event, payload) => {
      options.handleSystemNotificationClick(payload)
    })

    cleanupListeners = scope.cleanup
  }

  const cleanup = () => {
    cleanupListeners?.()
    cleanupListeners = null
  }

  return {
    setup,
    cleanup
  }
}
