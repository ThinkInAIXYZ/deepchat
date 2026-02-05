import { onBeforeUnmount, onMounted } from 'vue'
import { useOllamaStore } from '@/stores/ollamaStore'

export const useOllamaStoreLifecycle = () => {
  const ollamaStore = useOllamaStore()
  let cleanup: (() => void) | null = null

  onMounted(() => {
    cleanup = ollamaStore.bindEventListeners()
  })

  onBeforeUnmount(() => {
    cleanup?.()
    cleanup = null
  })

  return ollamaStore
}
