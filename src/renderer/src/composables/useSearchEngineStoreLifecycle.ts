import { onBeforeUnmount, onMounted } from 'vue'
import { useSearchEngineStore } from '@/stores/searchEngineStore'

export const useSearchEngineStoreLifecycle = () => {
  const store = useSearchEngineStore()
  let cleanup: (() => void) | null = null

  onMounted(async () => {
    await store.initialize()
    cleanup = store.bindEventListeners()
  })

  onBeforeUnmount(() => {
    cleanup?.()
    cleanup = null
  })

  return store
}
