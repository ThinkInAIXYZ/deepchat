import { createAppRuntimeClient } from '@api/AppRuntimeClient'
import { createWindowClient } from '@api/WindowClient'

interface UseAppIpcRuntimeOptions {
  handleStartDeeplink: (payload?: unknown) => void
  handleStartGuidedOnboardingDev: () => void | Promise<void>
  handleWindowFocused: () => void | Promise<void>
  showErrorToast: (error: { id: string; title: string; message: string; type: string }) => void
  handleDatabaseRepairSuggested: (payload: unknown) => void
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
    const appRuntimeClient = createAppRuntimeClient()
    const windowClient = createWindowClient()
    const cleanupNotificationError = windowClient.onNotificationError((error) => {
      options.showErrorToast(error)
    })
    const cleanupDatabaseRepairSuggested = windowClient.onDatabaseRepairSuggested((payload) => {
      options.handleDatabaseRepairSuggested(payload)
    })

    const cleanups: Array<() => void> = [
      cleanupNotificationError,
      cleanupDatabaseRepairSuggested,
      appRuntimeClient.onStartDeeplink((payload) => {
        options.handleStartDeeplink(payload)
      }),
      appRuntimeClient.onGuidedOnboardingStartRequested(() => {
        void options.handleStartGuidedOnboardingDev()
      }),
      appRuntimeClient.onWindowFocused(() => {
        void options.handleWindowFocused()
      }),
      appRuntimeClient.onShortcutRequested((payload) => {
        switch (payload.action) {
          case 'zoomIn':
            options.handleZoomIn()
            break
          case 'zoomOut':
            options.handleZoomOut()
            break
          case 'zoomResume':
            options.handleZoomResume()
            break
          case 'createNewConversation':
            if (options.getCurrentRouteName() !== 'chat') {
              return
            }
            void options.handleCreateNewConversation()
            break
          case 'toggleSidebar':
            options.handleToggleSidebar()
            break
          case 'toggleWorkspace':
            options.handleToggleWorkspace()
            break
          case 'toggleSpotlight':
            options.openSpotlight()
            break
        }
      }),
      appRuntimeClient.onDataResetCompleteDev(options.handleDataResetComplete),
      appRuntimeClient.onSystemNotificationClicked((payload) => {
        options.handleSystemNotificationClick(payload.payload)
      })
    ]

    cleanupListeners = () => {
      for (const cleanup of cleanups.splice(0)) {
        cleanup()
      }
    }
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
