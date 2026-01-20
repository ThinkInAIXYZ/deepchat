import { onMounted, onBeforeUnmount } from 'vue'
import { useUpgradeStore } from '@/stores/upgrade'

export const useUpgradeStoreLifecycle = () => {
  const upgradeStore = useUpgradeStore()
  let cleanup: (() => void) | null = null

  onMounted(() => {
    void upgradeStore.initialize()
    cleanup = upgradeStore.bindUpdateListeners()
  })

  onBeforeUnmount(() => {
    if (cleanup) {
      cleanup()
      cleanup = null
    }
  })

  return upgradeStore
}
