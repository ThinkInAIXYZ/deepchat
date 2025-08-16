import { contextBridge, ipcRenderer } from 'electron'

// 直接定义事件常量，避免路径解析问题
const FLOATING_BUTTON_EVENTS = {
  CLICKED: 'floating-button:clicked',
  RIGHT_CLICKED: 'floating-button:right-clicked'
} as const

// 定义悬浮按钮的 API
const floatingButtonAPI = {
  // 通知主进程悬浮按钮被点击
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

  // 监听来自主进程的事件
  onConfigUpdate: (callback: (config: any) => void) => {
    ipcRenderer.on('floating-button-config-update', (_event, config) => {
      callback(config)
    })
  },

  // 移除事件监听器
  removeAllListeners: () => {
    console.log('FloatingPreload: Removing all listeners')
    ipcRenderer.removeAllListeners('floating-button-config-update')
  }
}

// 尝试不同的方式暴露API
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
