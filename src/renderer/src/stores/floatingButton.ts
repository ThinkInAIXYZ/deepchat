import { defineStore } from 'pinia'
import { ref, onMounted } from 'vue'
import { useLegacyConfigPresenter } from '@api/legacy/presenters'
import { hasLegacyIpcRenderer, onLegacyIpcChannel } from '@api/legacy/runtime'
import { FLOATING_BUTTON_EVENTS } from '@/events'

export const useFloatingButtonStore = defineStore('floatingButton', () => {
  const configP = useLegacyConfigPresenter()

  // 悬浮按钮是否启用的状态
  const enabled = ref<boolean>(false)
  let listenerRegistered = false

  // 获取悬浮按钮启用状态
  const getFloatingButtonEnabled = async (): Promise<boolean> => {
    try {
      return await configP.getFloatingButtonEnabled()
    } catch (error) {
      console.error('Failed to get floating button enabled status:', error)
      return false
    }
  }

  // 设置悬浮按钮启用状态
  const setFloatingButtonEnabled = async (value: boolean) => {
    try {
      enabled.value = Boolean(value)
      await configP.setFloatingButtonEnabled(value)
    } catch (error) {
      console.error('Failed to set floating button enabled status:', error)
      // 如果设置失败，回滚本地状态
      enabled.value = !value
    }
  }

  // 初始化状态
  const initializeState = async () => {
    try {
      const currentEnabled = await getFloatingButtonEnabled()
      enabled.value = currentEnabled
      setupFloatingButtonListener()
    } catch (error) {
      console.error('Failed to initialize floating button state:', error)
      enabled.value = false
    }
  }

  const setupFloatingButtonListener = () => {
    if (listenerRegistered) {
      return
    }

    if (!hasLegacyIpcRenderer()) {
      return
    }

    listenerRegistered = true
    onLegacyIpcChannel(FLOATING_BUTTON_EVENTS.ENABLED_CHANGED, (_event, value: boolean) => {
      enabled.value = Boolean(value)
    })
  }

  // 在组件挂载时初始化
  onMounted(async () => {
    await initializeState()
  })

  return {
    // 状态
    enabled,

    // 方法
    getFloatingButtonEnabled,
    setFloatingButtonEnabled,
    initializeState
  }
})
