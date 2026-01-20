import { onMounted, onBeforeUnmount } from 'vue'
import { useSyncStore } from '@/stores/sync'

export const useSyncStoreLifecycle = () => {
  const syncStore = useSyncStore()
  let cleanup: (() => void) | null = null

  onMounted(async () => {
    await syncStore.initialize()
    cleanup = syncStore.bindEventListeners()
  })

  onBeforeUnmount(() => {
    if (cleanup) {
      cleanup()
      cleanup = null
    }
  })

  return syncStore
}
