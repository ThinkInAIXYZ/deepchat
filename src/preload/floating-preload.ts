import { contextBridge, ipcRenderer } from 'electron'

// Define event constants directly to avoid path resolution issues
const FLOATING_BUTTON_EVENTS = {
  CLICKED: 'floating-button:clicked',
  RIGHT_CLICKED: 'floating-button:right-clicked',
  DRAG_START: 'floating-button:drag-start',
  DRAG_MOVE: 'floating-button:drag-move',
  DRAG_END: 'floating-button:drag-end'
} as const

// Define floating button API
const floatingButtonAPI = {
  // Notify main process that floating button was clicked
  onClick: () => {
    try {
      ipcRenderer.send(FLOATING_BUTTON_EVENTS.CLICKED)
    } catch (error) {
      console.error('FloatingPreload: Error sending IPC message:', error)
    }
  },

  onRightClick: () => {
    try {
      ipcRenderer.send(FLOATING_BUTTON_EVENTS.RIGHT_CLICKED)
    } catch (error) {
      console.error('FloatingPreload: Error sending right click IPC message:', error)
    }
  },

  // Drag-related API
  onDragStart: (x: number, y: number) => {
    try {
      ipcRenderer.send(FLOATING_BUTTON_EVENTS.DRAG_START, { x, y })
    } catch (error) {
      console.error('FloatingPreload: Error sending drag start IPC message:', error)
    }
  },

  onDragMove: (x: number, y: number) => {
    try {
      ipcRenderer.send(FLOATING_BUTTON_EVENTS.DRAG_MOVE, { x, y })
    } catch (error) {
      console.error('FloatingPreload: Error sending drag move IPC message:', error)
    }
  },

  onDragEnd: (x: number, y: number) => {
    try {
      ipcRenderer.send(FLOATING_BUTTON_EVENTS.DRAG_END, { x, y })
    } catch (error) {
      console.error('FloatingPreload: Error sending drag end IPC message:', error)
    }
  },

  // Listen to events from main process
  onConfigUpdate: (callback: (config: any) => void) => {
    ipcRenderer.on('floating-button-config-update', (_event, config) => {
      callback(config)
    })
  },

  // Remove event listeners
  removeAllListeners: () => {
    console.log('FloatingPreload: Removing all listeners')
    ipcRenderer.removeAllListeners('floating-button-config-update')
  }
}

// Try different ways to expose API
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('floatingButtonAPI', floatingButtonAPI)
  } catch (error) {
    console.error('=== FloatingPreload: Error exposing API via contextBridge ===:', error)
  }
} else {
  try {
    ;(window as any).floatingButtonAPI = floatingButtonAPI
  } catch (error) {
    console.error('=== FloatingPreload: Error attaching API to window ===:', error)
  }
}
