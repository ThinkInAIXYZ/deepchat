import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import GuidedOnboardingOverlay from '@/components/onboarding/GuidedOnboardingOverlay.vue'

describe('GuidedOnboardingOverlay', () => {
  it('restores focus only after closing an opened guide', async () => {
    const target = document.createElement('button')
    document.body.append(target)
    const wrapper = mount(GuidedOnboardingOverlay, {
      attachTo: document.body,
      props: {
        visible: false,
        targetEl: target,
        containerEl: null,
        eyebrow: 'Setup',
        title: 'Choose a provider',
        description: 'Select the provider you use.',
        stepIndex: 1,
        totalSteps: 2,
        closeLabel: 'Close'
      }
    })
    try {
      await flushPromises()
      expect(document.activeElement).toBe(document.body)
      await wrapper.setProps({ stepIndex: 2 })
      expect(document.activeElement).toBe(document.body)
      await wrapper.setProps({ visible: true })
      await flushPromises()
      expect(document.activeElement).toBe(wrapper.get('[role="dialog"]').element)
      await wrapper.setProps({ visible: false })
      await flushPromises()
      expect(document.activeElement).toBe(target)
    } finally {
      wrapper.unmount()
      target.remove()
    }
  })
})
