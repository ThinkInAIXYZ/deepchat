import { defineStore } from 'pinia'
import { ref, onMounted, onScopeDispose } from 'vue'
import { createConfigClient } from '../../api/ConfigClient'

export const useFloatingButtonStore = defineStore('floatingButton', () => {
  const configClient = createConfigClient()

  // 悬浮按钮是否启用的状态
  const enabled = ref<boolean>(false)
  let listenerRegistered = false
  let stateRevision = 0
  let initialization: Promise<void> | null = null
  let removeFloatingButtonListener: (() => void) | null = null

  // 获取悬浮按钮启用状态
  const getFloatingButtonEnabled = async (): Promise<boolean> => {
    try {
      return await configClient.getFloatingButtonEnabled()
    } catch (error) {
      console.error('Failed to get floating button enabled status:', error)
      return false
    }
  }

  const setupFloatingButtonListener = () => {
    if (listenerRegistered) {
      return
    }

    listenerRegistered = true
    removeFloatingButtonListener = configClient.onFloatingButtonChanged((payload) => {
      stateRevision += 1
      enabled.value = Boolean(payload.enabled)
    })
  }

  // 设置悬浮按钮启用状态
  const setFloatingButtonEnabled = async (value: boolean) => {
    const previousEnabled = enabled.value
    const requestRevision = ++stateRevision
    enabled.value = Boolean(value)
    try {
      await configClient.setFloatingButtonEnabled(value)
    } catch (error) {
      if (requestRevision === stateRevision) {
        enabled.value = previousEnabled
      }
      console.error('Failed to set floating button enabled status:', error)
    }
  }

  // 初始化状态
  const initializeState = async () => {
    if (initialization) {
      return initialization
    }

    const task = (async () => {
      try {
        // Subscribe before reading the snapshot so an IPC update cannot be lost.
        setupFloatingButtonListener()
        const snapshotRevision = stateRevision
        const currentEnabled = await getFloatingButtonEnabled()
        if (snapshotRevision === stateRevision) {
          enabled.value = currentEnabled
        }
      } catch (error) {
        console.error('Failed to initialize floating button state:', error)
      }
    })()

    initialization = task
    return task
  }

  // 在组件挂载时初始化
  onMounted(() => {
    void initializeState()
  })

  onScopeDispose(() => {
    removeFloatingButtonListener?.()
    removeFloatingButtonListener = null
    listenerRegistered = false
    initialization = null
    stateRevision += 1
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
