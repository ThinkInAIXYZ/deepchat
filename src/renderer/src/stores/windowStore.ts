// === Pinia ===
import { defineStore } from 'pinia'

// === Vue Core ===
import { ref, onMounted, onBeforeUnmount } from 'vue'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'

// === Events ===
import { WINDOW_EVENTS } from '@/events'

/**
 * Window and Platform State Store
 *
 * Centralized management of:
 * - Platform detection (macOS, Windows, Windows 11+)
 * - Window state (maximized, fullscreen, focus)
 * - Window event listeners (with proper cleanup)
 *
 * Benefits:
 * - Single source of truth for platform/window state
 * - Eliminates code duplication across components
 * - Prevents memory leaks with proper event cleanup
 * - Reduces IPC calls (platform info fetched once)
 */
export const useWindowStore = defineStore('window', () => {
  // === Presenters ===
  const devicePresenter = usePresenter('devicePresenter')

  // === Platform State ===
  const isMacOS = ref(false)
  const isWindows = ref(false)
  const isWinMacOS = ref(false) // macOS or Windows 11+

  // === Window State ===
  const isMaximized = ref(false)
  const isFullscreened = ref(false)
  const isFocused = ref(true)
  const isBlurred = ref(false)

  // === Initialization Flag ===
  const isInitialized = ref(false)

  // === Event Handlers (named functions for proper cleanup) ===
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

  // === Setup Event Listeners ===
  const setupEventListeners = () => {
    if (!window?.electron?.ipcRenderer) return

    window.electron.ipcRenderer.on(WINDOW_EVENTS.WINDOW_MAXIMIZED, handleWindowMaximized)
    window.electron.ipcRenderer.on(WINDOW_EVENTS.WINDOW_UNMAXIMIZED, handleWindowUnmaximized)
    window.electron.ipcRenderer.on(
      WINDOW_EVENTS.WINDOW_ENTER_FULL_SCREEN,
      handleWindowEnterFullScreen
    )
    window.electron.ipcRenderer.on(
      WINDOW_EVENTS.WINDOW_LEAVE_FULL_SCREEN,
      handleWindowLeaveFullScreen
    )
    window.electron.ipcRenderer.on(WINDOW_EVENTS.APP_FOCUS, handleAppFocus)
    window.electron.ipcRenderer.on(WINDOW_EVENTS.APP_BLUR, handleAppBlur)
  }

  // === Cleanup Event Listeners ===
  const cleanupEventListeners = () => {
    if (!window?.electron?.ipcRenderer) return

    window.electron.ipcRenderer.removeListener(
      WINDOW_EVENTS.WINDOW_MAXIMIZED,
      handleWindowMaximized
    )
    window.electron.ipcRenderer.removeListener(
      WINDOW_EVENTS.WINDOW_UNMAXIMIZED,
      handleWindowUnmaximized
    )
    window.electron.ipcRenderer.removeListener(
      WINDOW_EVENTS.WINDOW_ENTER_FULL_SCREEN,
      handleWindowEnterFullScreen
    )
    window.electron.ipcRenderer.removeListener(
      WINDOW_EVENTS.WINDOW_LEAVE_FULL_SCREEN,
      handleWindowLeaveFullScreen
    )
    window.electron.ipcRenderer.removeListener(WINDOW_EVENTS.APP_FOCUS, handleAppFocus)
    window.electron.ipcRenderer.removeListener(WINDOW_EVENTS.APP_BLUR, handleAppBlur)
  }

  // === Initialize Platform Detection ===
  const initialize = async () => {
    if (isInitialized.value) return

    try {
      const deviceInfo = await devicePresenter.getDeviceInfo()

      // Detect macOS
      isMacOS.value = deviceInfo.platform === 'darwin'

      // Detect Windows
      isWindows.value = deviceInfo.platform === 'win32'

      // Detect Windows 11+
      let isWin11Plus = false
      if (deviceInfo.platform === 'win32') {
        const buildNumber = parseInt(deviceInfo.osVersion.split('.')[2] || '0', 10)
        const win11Metadata = deviceInfo.osVersionMetadata.find((v) => v.name === 'Windows 11')
        isWin11Plus = win11Metadata ? buildNumber >= win11Metadata.build : false
      }

      // isWinMacOS is true for: macOS (all versions) OR Windows 11+
      isWinMacOS.value = isMacOS.value || isWin11Plus

      // Setup event listeners
      setupEventListeners()

      isInitialized.value = true
    } catch (error) {
      console.error('Failed to initialize window store:', error)
      isInitialized.value = true
    }
  }

  // === Lifecycle Hooks ===
  onMounted(() => {
    initialize()
  })

  onBeforeUnmount(() => {
    cleanupEventListeners()
  })

  // === Return API ===
  return {
    // Platform State
    isMacOS,
    isWindows,
    isWinMacOS,
    // Window State
    isMaximized,
    isFullscreened,
    isFocused,
    isBlurred,
    // Methods
    initialize,
    cleanupEventListeners
  }
})
