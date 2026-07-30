import { createAppRuntimeClient } from '@api/AppRuntimeClient'

interface UseAppIpcRuntimeOptions {
  handleStartDeeplink: (payload?: unknown) => void
  handleStartGuidedOnboardingDev: () => void | Promise<void>
  handleWindowFocused: () => void | Promise<void>
  handleZoomIn: () => void
  handleZoomOut: () => void
  handleZoomResume: () => void
  handleCreateNewConversation: () => void | Promise<void>
  handleToggleSidebar: () => void
  handleToggleWorkspace: () => void
  openSpotlight: () => void
  handleSystemNotificationClick: (payload: unknown) => void
  getCurrentRouteName: () => string | symbol | null | undefined
}

export function useAppIpcRuntime(options: UseAppIpcRuntimeOptions) {
  let cleanupListeners: (() => void) | null = null

  const setup = () => {
    cleanupListeners?.()
    const appRuntimeClient = createAppRuntimeClient()

    const cleanups: Array<() => void> = [
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
