import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import AgentProgressFloat from '@/components/chat/AgentProgressFloat.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        'chat.workspace.plan.section': 'Plan'
      })[key] ?? key
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    template: '<i class="icon-stub" />'
  })
}))

const snapshot = {
  sessionId: 's1',
  messageId: 'm1',
  plan: [
    { step: 'Inspect agent runtime', status: 'completed' },
    { step: 'Wire progress panel', status: 'in_progress' }
  ],
  explanation: 'Current implementation plan',
  revision: 2,
  updatedAt: '2026-05-18T00:00:00.000Z'
} as const

describe('AgentProgressFloat', () => {
  it('renders the latest plan snapshot and emits collapse toggles', async () => {
    const wrapper = mount(AgentProgressFloat, {
      props: {
        snapshot,
        collapsed: false
      }
    })

    expect(wrapper.find('[data-testid="agent-progress-float"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Plan')
    expect(wrapper.text()).toContain('1/2')
    expect(wrapper.text()).toContain('Current implementation plan')
    expect(wrapper.text()).toContain('Inspect agent runtime')
    expect(wrapper.text()).toContain('Wire progress panel')

    await wrapper.find('button').trigger('click')

    expect(wrapper.emitted('toggle-collapse')).toEqual([[]])
  })

  it('keeps the header visible while collapsed', () => {
    const wrapper = mount(AgentProgressFloat, {
      props: {
        snapshot,
        collapsed: true
      }
    })

    expect(wrapper.text()).toContain('Plan')
    expect(wrapper.text()).toContain('1/2')
    expect(wrapper.find('button').attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-testid="agent-progress-float-body"]').isVisible()).toBe(false)
  })
})
