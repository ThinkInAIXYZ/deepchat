import { onMounted, onBeforeUnmount } from 'vue'
import { useWindowStore } from '@/stores/windowStore'

export const useWindowStoreLifecycle = () => {
  const windowStore = useWindowStore()
  let cleanup: (() => void) | null = null

  onMounted(() => {
    void windowStore.initialize()
    cleanup = windowStore.bindEventListeners()
  })

  onBeforeUnmount(() => {
    if (cleanup) {
      cleanup()
      cleanup = null
    }
  })

  return windowStore
}
