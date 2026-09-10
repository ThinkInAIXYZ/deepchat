import { effectScope } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { DeepchatBridge } from '@shared/contracts/bridge'
import { useAccessibilitySupport } from '@/composables/useAccessibilitySupport'

describe('native accessibility support', () => {
  it('shares its listener and preserves a newer event over a delayed snapshot', async () => {
    const originalBridge = window.deepchat
    const unsubscribe = vi.fn()
    let publish!: (payload: { enabled: boolean }) => void
    let resolveSnapshot!: (value: unknown) => void
    const snapshot = new Promise((resolve) => {
      resolveSnapshot = resolve
    })
    const on = vi.fn((_name, handler) => {
      publish = handler
      return unsubscribe
    })
    window.deepchat = { invoke: vi.fn(() => snapshot), on } as unknown as DeepchatBridge
    const first = effectScope()
    const second = effectScope()
    try {
      const firstSupport = first.run(() => useAccessibilitySupport())!
      const secondSupport = second.run(() => useAccessibilitySupport())!
      expect(on).toHaveBeenCalledOnce()
      publish({ enabled: true })
      resolveSnapshot({ info: { accessibilitySupportEnabled: false } })
      await flushPromises()
      expect(firstSupport.accessibilityEnabled.value).toBe(true)
      expect(secondSupport.accessibilityEnabled.value).toBe(true)
      publish({ enabled: false })
      expect(firstSupport.accessibilityEnabled.value).toBe(false)
      first.stop()
      expect(unsubscribe).not.toHaveBeenCalled()
      second.stop()
      expect(unsubscribe).toHaveBeenCalledOnce()
    } finally {
      first.stop()
      second.stop()
      window.deepchat = originalBridge
    }
  })
})
