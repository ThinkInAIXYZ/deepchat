import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import InlineOperationFeedback from '@renderer-notifications/InlineOperationFeedback.vue'
import type { SurfaceFeedbackSnapshot } from '@renderer-notifications'

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    props: { icon: { type: String, required: true } },
    template: '<span :data-icon="icon" />'
  })
}))

const mountFeedback = (snapshot: SurfaceFeedbackSnapshot, retryLabel?: string) =>
  mount(InlineOperationFeedback, {
    props: {
      snapshot,
      retryLabel
    }
  })

describe('InlineOperationFeedback', () => {
  it('renders no placeholder copy while idle', () => {
    const wrapper = mountFeedback({ status: 'idle', version: 0 })

    expect(wrapper.find('[data-testid="inline-operation-feedback"]').exists()).toBe(false)
  })

  it('uses compact progressive states without duplicating descriptions', async () => {
    const wrapper = mountFeedback({
      status: 'pending',
      operationId: 'settings.agent.save',
      label: 'Saving',
      version: 1
    })

    expect(wrapper.get('[role="status"]').text()).toBe('Saving')
    await wrapper.setProps({
      snapshot: {
        status: 'success',
        operationId: 'settings.agent.save',
        code: 'settings.agent.saved',
        title: 'Saved',
        description: 'Agent preferences are ready',
        version: 2
      }
    })

    expect(wrapper.get('[role="status"]').text()).toBe('Saved')
    expect(wrapper.get('[role="status"]').attributes('aria-label')).toBe(
      'Saved. Agent preferences are ready'
    )
  })

  it('keeps failure visible and exposes an explicit retry action', async () => {
    const wrapper = mountFeedback(
      {
        status: 'error',
        operationId: 'settings.agent.save',
        code: 'settings.agent.saveFailed',
        title: 'Save failed',
        version: 2
      },
      'Retry'
    )

    expect(wrapper.get('[role="alert"]').text()).toBe('Save failedRetry')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })
})
