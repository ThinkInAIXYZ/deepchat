import { ref } from 'vue'
import { useWindowAdapter, type WindowAdapter } from '@/composables/window/useWindowAdapter'

export type WindowStoreDeps = {
  windowAdapter?: WindowAdapter
}

export const createWindowStore = (deps: WindowStoreDeps = {}) => {
  const windowAdapter = deps.windowAdapter ?? useWindowAdapter()

  const isMacOS = ref(false)
  const isWindows = ref(false)
  const isWinMacOS = ref(false)

  const isMaximized = ref(false)
  const isFullscreened = ref(false)
  const isFocused = ref(true)
  const isBlurred = ref(false)

  const isInitialized = ref(false)
  let listenersBound = false
  let cleanupListeners: (() => void) | null = null

  const handleWindowMaximized = () => {
    isMaximized.value = true
  }

  const handleWindowUnmaximized = () => {
    isMaximized.value = false
  }

  const handleWindowEnterFullScreen = () => {
    isFullscreened.value = true
  }

  const handleWindowLeaveFullScreen = () => {
    isFullscreened.value = false
  }

  const handleAppFocus = () => {
    isFocused.value = true
    isBlurred.value = false
  }

  const handleAppBlur = () => {
    isFocused.value = false
    isBlurred.value = true
  }

  const initialize = async () => {
    if (isInitialized.value) return

    try {
      const deviceInfo = await windowAdapter.getDeviceInfo()

      isMacOS.value = deviceInfo.platform === 'darwin'
      isWindows.value = deviceInfo.platform === 'win32'

      let isWin11Plus = false
      if (deviceInfo.platform === 'win32') {
        const buildNumber = parseInt(deviceInfo.osVersion.split('.')[2] || '0', 10)
        const win11Metadata = deviceInfo.osVersionMetadata.find((v) => v.name === 'Windows 11')
        isWin11Plus = win11Metadata ? buildNumber >= win11Metadata.build : false
      }

      isWinMacOS.value = isMacOS.value || isWin11Plus
      isInitialized.value = true
    } catch (error) {
      console.error('Failed to initialize window store:', error)
      isInitialized.value = true
    }
  }

  const bindEventListeners = () => {
    if (listenersBound) return () => undefined

    const unsubscribers = [
      windowAdapter.onWindowMaximized(handleWindowMaximized),
      windowAdapter.onWindowUnmaximized(handleWindowUnmaximized),
      windowAdapter.onWindowEnterFullScreen(handleWindowEnterFullScreen),
      windowAdapter.onWindowLeaveFullScreen(handleWindowLeaveFullScreen),
      windowAdapter.onAppFocus(handleAppFocus),
      windowAdapter.onAppBlur(handleAppBlur)
    ]

    const cleanup = () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      listenersBound = false
      cleanupListeners = null
    }

    listenersBound = true
    cleanupListeners = cleanup

    return cleanup
  }

  const cleanupEventListeners = () => {
    cleanupListeners?.()
  }

  return {
    isMacOS,
    isWindows,
    isWinMacOS,
    isMaximized,
    isFullscreened,
    isFocused,
    isBlurred,
    initialize,
    bindEventListeners,
    cleanupEventListeners
  }
}

export const useWindowStoreService = () => createWindowStore()
