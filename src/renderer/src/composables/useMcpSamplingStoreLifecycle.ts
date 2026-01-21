import { onBeforeUnmount, onMounted } from 'vue'
import { useMcpSamplingStore } from '@/stores/mcpSampling'

export const useMcpSamplingStoreLifecycle = () => {
  const store = useMcpSamplingStore()
  let cleanup: (() => void) | null = null

  onMounted(() => {
    cleanup = store.bindEventListeners()
  })

  onBeforeUnmount(() => {
    cleanup?.()
    cleanup = null
  })

  return store
}
