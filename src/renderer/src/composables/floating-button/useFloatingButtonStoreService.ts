import { ref } from 'vue'
import { useFloatingButtonAdapter } from '@/composables/floating-button/useFloatingButtonAdapter'

export const useFloatingButtonStoreService = () => {
  const adapter = useFloatingButtonAdapter()
  const enabled = ref<boolean>(false)
  let listenersBound = false

  const getFloatingButtonEnabled = async (): Promise<boolean> => {
    try {
      return await adapter.getFloatingButtonEnabled()
    } catch (error) {
      console.error('Failed to get floating button enabled status:', error)
      return false
    }
  }

  const setFloatingButtonEnabled = async (value: boolean) => {
    try {
      enabled.value = Boolean(value)
      await adapter.setFloatingButtonEnabled(value)
    } catch (error) {
      console.error('Failed to set floating button enabled status:', error)
      enabled.value = !value
    }
  }

  const initializeState = async () => {
    try {
      const currentEnabled = await getFloatingButtonEnabled()
      enabled.value = currentEnabled
    } catch (error) {
      console.error('Failed to initialize floating button state:', error)
      enabled.value = false
    }
  }

  const bindEventListeners = () => {
    if (listenersBound) return () => undefined
    listenersBound = true

    const unsubscribe = adapter.onEnabledChanged((value) => {
      enabled.value = Boolean(value)
    })

    return () => {
      unsubscribe()
      listenersBound = false
    }
  }

  return {
    enabled,
    getFloatingButtonEnabled,
    setFloatingButtonEnabled,
    initializeState,
    bindEventListeners
  }
}
