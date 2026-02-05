import { onBeforeUnmount, onMounted } from 'vue'
import { useYoBrowserStore } from '@/stores/yoBrowser'

export const useYoBrowserStoreLifecycle = () => {
  const yoBrowserStore = useYoBrowserStore()
  let cleanup: (() => void) | null = null

  onMounted(async () => {
    await yoBrowserStore.loadState()
    cleanup = yoBrowserStore.bindEventListeners()
  })

  onBeforeUnmount(() => {
    cleanup?.()
    cleanup = null
  })

  return yoBrowserStore
}
