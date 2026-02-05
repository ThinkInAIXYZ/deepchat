import { onMounted, onBeforeUnmount } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'

export const useWorkspaceStoreLifecycle = () => {
  const workspaceStore = useWorkspaceStore()
  let cleanup: (() => void) | null = null

  onMounted(() => {
    cleanup = workspaceStore.bindEventListeners()
  })

  onBeforeUnmount(() => {
    if (cleanup) {
      cleanup()
      cleanup = null
    }
  })

  return workspaceStore
}
