// === Pinia ===
import { defineStore } from 'pinia'

// === Vue Core ===
import { ref } from 'vue'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'

// === Types ===
import type { IPresenter } from '@shared/presenter'

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
type DevicePresenter = IPresenter['devicePresenter']

type WindowStoreDeps = {
  devicePresenter?: DevicePresenter
  ipcRenderer?: typeof window.electron.ipcRenderer | null
}

export const createWindowStore = (deps: WindowStoreDeps = {}) => {
  // === Presenters ===
  const devicePresenter = deps.devicePresenter ?? usePresenter('devicePresenter')
  const ipcRenderer = deps.ipcRenderer ?? window?.electron?.ipcRenderer ?? null

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
  let listenersBound = false

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
    if (!ipcRenderer) return

    ipcRenderer.on(WINDOW_EVENTS.WINDOW_MAXIMIZED, handleWindowMaximized)
    ipcRenderer.on(WINDOW_EVENTS.WINDOW_UNMAXIMIZED, handleWindowUnmaximized)
    ipcRenderer.on(WINDOW_EVENTS.WINDOW_ENTER_FULL_SCREEN, handleWindowEnterFullScreen)
    ipcRenderer.on(WINDOW_EVENTS.WINDOW_LEAVE_FULL_SCREEN, handleWindowLeaveFullScreen)
    ipcRenderer.on(WINDOW_EVENTS.APP_FOCUS, handleAppFocus)
    ipcRenderer.on(WINDOW_EVENTS.APP_BLUR, handleAppBlur)
  }

  // === Cleanup Event Listeners ===
  const cleanupEventListeners = () => {
    if (!ipcRenderer) return

    ipcRenderer.removeListener(WINDOW_EVENTS.WINDOW_MAXIMIZED, handleWindowMaximized)
    ipcRenderer.removeListener(WINDOW_EVENTS.WINDOW_UNMAXIMIZED, handleWindowUnmaximized)
    ipcRenderer.removeListener(WINDOW_EVENTS.WINDOW_ENTER_FULL_SCREEN, handleWindowEnterFullScreen)
    ipcRenderer.removeListener(WINDOW_EVENTS.WINDOW_LEAVE_FULL_SCREEN, handleWindowLeaveFullScreen)
    ipcRenderer.removeListener(WINDOW_EVENTS.APP_FOCUS, handleAppFocus)
    ipcRenderer.removeListener(WINDOW_EVENTS.APP_BLUR, handleAppBlur)
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

      isInitialized.value = true
    } catch (error) {
      console.error('Failed to initialize window store:', error)
      isInitialized.value = true
    }
  }

  const bindEventListeners = () => {
    if (listenersBound) {
      return () => undefined
    }
    setupEventListeners()
    listenersBound = true
    return () => {
      cleanupEventListeners()
      listenersBound = false
    }
  }

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
    bindEventListeners,
    cleanupEventListeners
  }
}

export const useWindowStore = defineStore('window', () => createWindowStore())
