import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveDelegationSummary } from '@shared/orchestration/liveDelegation'

vi.mock('pinia', async () => vi.importActual<typeof import('pinia')>('pinia'))

const client = vi.hoisted(() => {
  let changed: ((payload: { delegation: LiveDelegationSummary }) => void) | null = null
  return {
    listLiveDelegations: vi.fn(),
    interruptLiveDelegation: vi.fn(),
    onLiveDelegationChanged: vi.fn(
      (listener: (payload: { delegation: LiveDelegationSummary }) => void) => {
        changed = listener
        return vi.fn()
      }
    ),
    emitChanged(delegation: LiveDelegationSummary) {
      changed?.({ delegation })
    },
    reset() {
      changed = null
    }
  }
})
const selectSession = vi.hoisted(() => vi.fn())

vi.mock('@api/OrchestrationClient', () => ({
  createOrchestrationClient: () => client
}))

vi.mock('@/stores/ui/session', () => ({
  useSessionStore: () => ({ selectSession })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({ name: 'Icon', template: '<i />' })
}))

vi.mock('@dc-ui/components/button', () => ({
  DcButton: defineComponent({
    name: 'Button',
    emits: ['click'],
    template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>'
  })
}))

import LiveDelegationToolCallCard from '@/components/message/LiveDelegationToolCallCard.vue'

function summary(overrides: Partial<LiveDelegationSummary> = {}): LiveDelegationSummary {
  return {
    schemaVersion: 1,
    id: 'delegation-1',
    parentSessionId: 'parent-1',
    childSessionId: null,
    slotId: 'reviewer',
    targetAgentId: 'deepchat',
    title: 'Review architecture',
    status: 'queued',
    lastTurnSeq: 1,
    createdAt: 10,
    updatedAt: 20,
    revision: 1,
    summaryPreview: null,
    errorPreview: null,
    ...overrides
  }
}

describe('LiveDelegationToolCallCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    client.reset()
    client.listLiveDelegations.mockResolvedValue([summary()])
    setActivePinia(createPinia())
  })

  it('follows live status and opens the child as soon as it is bound', async () => {
    const wrapper = mount(LiveDelegationToolCallCard, {
      props: {
        parentSessionId: 'parent-1',
        spawn: {
          slotId: 'reviewer',
          title: 'Review architecture',
          delegation: summary()
        },
        toolStatus: 'success',
        detailsId: 'details-1',
        detailsExpanded: false
      }
    })
    await flushPromises()

    expect(wrapper.text()).toContain('chat.toolCall.subagents.status.queued')
    expect(wrapper.find('[data-testid="live-delegation-tool-open-delegation-1"]').exists()).toBe(
      false
    )

    client.emitChanged(
      summary({
        childSessionId: 'child-1',
        status: 'running',
        revision: 2,
        updatedAt: 30
      })
    )
    await flushPromises()

    expect(wrapper.text()).toContain('chat.toolCall.subagents.status.running')
    expect(
      wrapper
        .get('[data-testid="live-delegation-tool-open-delegation-1"]')
        .attributes('data-action-required')
    ).toBeUndefined()

    client.emitChanged(
      summary({
        childSessionId: 'child-1',
        status: 'waiting_permission',
        revision: 3,
        updatedAt: 40
      })
    )
    await flushPromises()

    expect(wrapper.text()).toContain('chat.toolCall.subagents.status.waiting_permission')
    expect(
      wrapper
        .get('[data-testid="live-delegation-tool-open-delegation-1"]')
        .attributes('data-action-required')
    ).toBe('true')
    await wrapper.get('[data-testid="live-delegation-tool-open-delegation-1"]').trigger('click')
    expect(selectSession).toHaveBeenCalledWith('child-1')

    await wrapper.get('[data-testid="live-delegation-tool-details"]').trigger('click')
    expect(wrapper.emitted('toggleDetails')).toHaveLength(1)
  })

  it('does not open a child when host state no longer matches the transcript task', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    client.listLiveDelegations.mockResolvedValue([
      summary({
        childSessionId: 'other-child',
        title: 'Different task',
        revision: 2,
        updatedAt: 30
      })
    ])
    const wrapper = mount(LiveDelegationToolCallCard, {
      props: {
        parentSessionId: 'parent-1',
        spawn: {
          slotId: 'reviewer',
          title: 'Review architecture',
          delegation: summary()
        },
        toolStatus: 'success',
        detailsId: 'details-1',
        detailsExpanded: false
      }
    })
    await flushPromises()

    await wrapper.get('[data-testid="live-delegation-tool-open-delegation-1"]').trigger('click')
    await flushPromises()

    expect(selectSession).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('common.error.operationFailed')
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
