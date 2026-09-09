import { createSharedComposable } from '@vueuse/core'
import { onScopeDispose, readonly, ref } from 'vue'
import { createDeviceClient } from '@api/DeviceClient'

// Share one native subscription across the transcript, Markdown, and editor consumers.
export const useAccessibilitySupport = createSharedComposable(() => {
  const accessibilityEnabled = ref(true)
  const deviceClient = createDeviceClient()
  let disposed = false
  let receivedUpdate = false
  const unsubscribe = deviceClient.onAccessibilityChanged((enabled) => {
    receivedUpdate = true
    accessibilityEnabled.value = enabled
  })

  void deviceClient
    .getDeviceInfo()
    .then((info) => {
      if (!disposed && !receivedUpdate) {
        accessibilityEnabled.value = info?.accessibilitySupportEnabled ?? true
      }
    })
    .catch((error) => {
      console.warn('[Accessibility] Could not read native support status', error)
    })

  onScopeDispose(() => {
    disposed = true
    unsubscribe()
  })

  return { accessibilityEnabled: readonly(accessibilityEnabled) }
})
