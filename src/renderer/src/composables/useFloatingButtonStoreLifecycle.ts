import { onBeforeUnmount, onMounted } from 'vue'
import { useFloatingButtonStore } from '@/stores/floatingButton'

export const useFloatingButtonStoreLifecycle = () => {
  const floatingButtonStore = useFloatingButtonStore()
  let cleanup: (() => void) | null = null

  onMounted(async () => {
    await floatingButtonStore.initializeState()
    cleanup = floatingButtonStore.bindEventListeners()
  })

  onBeforeUnmount(() => {
    cleanup?.()
    cleanup = null
  })

  return floatingButtonStore
}
