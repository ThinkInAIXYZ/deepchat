import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveDelegationSummary } from '@shared/orchestration/liveDelegation'

vi.mock('pinia', async () => vi.importActual<typeof import('pinia')>('pinia'))

const client = vi.hoisted(() => {
  let changed:
    | ((payload: {
        schemaVersion: 1
        parentSessionId: string
        delegation: LiveDelegationSummary
      }) => void)
    | null = null
  const stop = vi.fn()
  return {
    listLiveDelegations: vi.fn(),
    interruptLiveDelegation: vi.fn(),
    selectSession: vi.fn(),
    stop,
    onLiveDelegationChanged: vi.fn((listener: typeof changed) => {
      changed = listener
      return stop
    }),
    emitChanged(delegation: LiveDelegationSummary) {
      changed?.({
        schemaVersion: 1,
        parentSessionId: delegation.parentSessionId,
        delegation
      })
    },
    reset() {
      changed = null
    }
  }
})

vi.mock('@api/OrchestrationClient', () => ({
  createOrchestrationClient: () => client
}))

vi.mock('@/stores/ui/session', () => ({
  useSessionStore: () => ({ selectSession: client.selectSession })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({ name: 'Icon', template: '<i />' })
}))

vi.mock('@shadcn/components/ui/button', () => ({
  Button: defineComponent({
    name: 'Button',
    emits: ['click'],
    template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>'
  })
}))

import LiveDelegationPanel from '@/components/sidepanel/LiveDelegationPanel.vue'

function summary(overrides: Partial<LiveDelegationSummary> = {}): LiveDelegationSummary {
  return {
    schemaVersion: 1,
    id: 'delegation-1',
    parentSessionId: 'parent-1',
    childSessionId: 'child-1',
    slotId: 'reviewer',
    targetAgentId: 'deepchat',
    title: 'Review architecture',
    status: 'running',
    lastTurnSeq: 1,
    createdAt: 10,
    updatedAt: 20,
    revision: 1,
    summaryPreview: null,
    errorPreview: null,
    ...overrides
  }
}

describe('LiveDelegationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    client.reset()
    setActivePinia(createPinia())
  })

  it('projects live status, opens the stable child, and interrupts active work', async () => {
    const active = summary()
    client.listLiveDelegations.mockResolvedValue([active])
    client.interruptLiveDelegation.mockResolvedValue({
      delegation: summary({
        status: 'interrupted',
        revision: 2,
        updatedAt: 30,
        errorPreview: 'Interrupted by the parent session.'
      }),
      turns: []
    })
    const wrapper = mount(LiveDelegationPanel, { props: { sessionId: 'parent-1' } })
    await flushPromises()

    expect(wrapper.get('[data-testid="live-delegation-delegation-1"]').text()).toContain(
      'Review architecture'
    )
    expect(
      wrapper
        .get('[data-testid="live-delegation-open-delegation-1"]')
        .attributes('data-action-required')
    ).toBeUndefined()

    client.emitChanged(summary({ status: 'waiting_question', revision: 2, updatedAt: 30 }))
    await flushPromises()
    expect(
      wrapper
        .get('[data-testid="live-delegation-open-delegation-1"]')
        .attributes('data-action-required')
    ).toBe('true')

    await wrapper.get('[data-testid="live-delegation-open-delegation-1"]').trigger('click')
    expect(client.selectSession).toHaveBeenCalledWith('child-1')

    await wrapper.get('[data-testid="live-delegation-interrupt-delegation-1"]').trigger('click')
    await flushPromises()
    expect(client.interruptLiveDelegation).toHaveBeenCalledWith('parent-1', 'delegation-1')
    expect(wrapper.text()).toContain('Interrupted by the parent session.')
    expect(wrapper.find('[data-testid="live-delegation-interrupt-delegation-1"]').exists()).toBe(
      false
    )
  })

  it('accepts only current-parent events through the shared projection', async () => {
    client.listLiveDelegations.mockResolvedValue([])
    const wrapper = mount(LiveDelegationPanel, { props: { sessionId: 'parent-1' } })
    await flushPromises()

    client.emitChanged(summary({ parentSessionId: 'other-parent', id: 'ignored' }))
    client.emitChanged(summary({ summaryPreview: 'Fresh result.', revision: 2 }))
    await flushPromises()

    expect(wrapper.get('[data-testid="live-delegation-delegation-1"]').text()).toContain(
      'Fresh result.'
    )
    expect(wrapper.find('[data-testid="live-delegation-ignored"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not let a stale list response overwrite a newer event', async () => {
    let resolveList: ((items: LiveDelegationSummary[]) => void) | null = null
    client.listLiveDelegations.mockReturnValue(
      new Promise<LiveDelegationSummary[]>((resolve) => {
        resolveList = resolve
      })
    )
    const wrapper = mount(LiveDelegationPanel, { props: { sessionId: 'parent-1' } })

    client.emitChanged(summary({ summaryPreview: 'Newest result.', revision: 2, updatedAt: 30 }))
    resolveList?.([summary({ summaryPreview: 'Stale result.', revision: 1 })])
    await flushPromises()

    expect(wrapper.get('[data-testid="live-delegation-delegation-1"]').text()).toContain(
      'Newest result.'
    )
    expect(wrapper.text()).not.toContain('Stale result.')
  })

  it('retains an interrupt result after the session changes away and back', async () => {
    let resolveInterrupt:
      | ((detail: { delegation: LiveDelegationSummary; turns: never[] }) => void)
      | null = null
    client.listLiveDelegations.mockImplementation(async (parentSessionId: string) =>
      parentSessionId === 'parent-1' ? [summary()] : []
    )
    client.interruptLiveDelegation.mockReturnValue(
      new Promise((resolve) => {
        resolveInterrupt = resolve
      })
    )
    const wrapper = mount(LiveDelegationPanel, { props: { sessionId: 'parent-1' } })
    await flushPromises()

    await wrapper.get('[data-testid="live-delegation-interrupt-delegation-1"]').trigger('click')
    await wrapper.setProps({ sessionId: 'parent-2' })
    await wrapper.setProps({ sessionId: 'parent-1' })
    await flushPromises()

    resolveInterrupt?.({
      delegation: summary({
        status: 'interrupted',
        revision: 2,
        updatedAt: 30,
        errorPreview: 'Interrupted result.'
      }),
      turns: []
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Interrupted result.')
  })
})
