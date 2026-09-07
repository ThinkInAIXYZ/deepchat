import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import OnBoardingSpotlight from '@/components/onboarding/OnBoardingSpotlight.vue'

describe('OnBoardingSpotlight', () => {
  it('updates the dim path and border geometry together', async () => {
    const wrapper = mount(OnBoardingSpotlight, {
      props: {
        pathD: 'M0 0H100V100H0ZM10 10H30V30H10Z',
        cutoutPathD: 'M10 10H30V30H10Z',
        viewportWidth: 100,
        viewportHeight: 100
      }
    })

    await wrapper.setProps({
      pathD: 'M0 0H100V100H0ZM40 40H80V80H40Z',
      cutoutPathD: 'M40 40H80V80H40Z'
    })

    expect(wrapper.get('[data-testid="onboarding-spotlight-path"]').attributes('d')).toBe(
      'M0 0H100V100H0ZM40 40H80V80H40Z'
    )
    expect(wrapper.get('[data-testid="onboarding-spotlight-border"]').attributes('d')).toBe(
      'M40 40H80V80H40Z'
    )
  })
})
