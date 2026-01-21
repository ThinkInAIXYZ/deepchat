import { onBeforeUnmount, onMounted } from 'vue'
import { useDialogStore } from '@/stores/dialog'

export const useDialogStoreLifecycle = () => {
  const dialogStore = useDialogStore()
  let cleanup: (() => void) | null = null

  onMounted(() => {
    cleanup = dialogStore.bindEventListeners()
  })

  onBeforeUnmount(() => {
    cleanup?.()
    cleanup = null
  })

  return dialogStore
}
