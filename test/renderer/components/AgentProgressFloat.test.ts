import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import AgentProgressFloat from '@/components/chat/AgentProgressFloat.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const messages: Record<string, string> = {
        'chat.workspace.plan.section': 'Plan',
        'chat.workspace.plan.completedCount': '{completed}/{total} completed',
        'chat.workspace.plan.itemAriaLabel': '{status}: {step}',
        'chat.workspace.plan.status.completed': 'Completed',
        'chat.workspace.plan.status.in_progress': 'In Progress',
        'chat.workspace.plan.status.pending': 'Pending',
        'chat.workspace.plan.status.interrupted': 'Interrupted'
      }
      return (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => params?.[name] ?? '')
    }
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
    expect(wrapper.find('[aria-label="Completed: Inspect agent runtime"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="In Progress: Wire progress panel"]').exists()).toBe(true)

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

  it('renders terminal in-progress steps without a spinner', () => {
    const wrapper = mount(AgentProgressFloat, {
      props: {
        snapshot: {
          ...snapshot,
          terminalReason: 'aborted'
        },
        collapsed: false
      }
    })

    expect(wrapper.find('.animate-spin').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Interrupted: Wire progress panel"]').exists()).toBe(true)
  })
})
