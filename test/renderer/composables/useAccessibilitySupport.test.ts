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
      expect(firstSupport.accessibilityReady.value).toBe(false)
      publish({ enabled: true })
      expect(firstSupport.accessibilityReady.value).toBe(true)
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
  it.each([false, true])(
    'settles readiness after the native lookup (failed: %s)',
    async (failed) => {
      const originalBridge = window.deepchat
      window.deepchat = {
        invoke: failed
          ? vi.fn().mockRejectedValue(new Error('device unavailable'))
          : vi.fn().mockResolvedValue({ info: { accessibilitySupportEnabled: false } }),
        on: vi.fn(() => vi.fn())
      } as unknown as DeepchatBridge
      const scope = effectScope()
      try {
        const support = scope.run(() => useAccessibilitySupport())!
        expect(support.accessibilityReady.value).toBe(false)
        await flushPromises()
        expect(support.accessibilityReady.value).toBe(true)
        expect(support.accessibilityEnabled.value).toBe(failed)
      } finally {
        scope.stop()
        window.deepchat = originalBridge
      }
    }
  )
})
