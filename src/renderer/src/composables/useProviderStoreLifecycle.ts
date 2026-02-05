import { onBeforeUnmount, onMounted } from 'vue'
import { useProviderStore } from '@/stores/providerStore'

export const useProviderStoreLifecycle = () => {
  const providerStore = useProviderStore()
  let cleanup: (() => void) | null = null

  onMounted(async () => {
    await providerStore.initialize()
    cleanup = providerStore.bindEventListeners()
  })

  onBeforeUnmount(() => {
    cleanup?.()
    cleanup = null
  })

  return providerStore
}
