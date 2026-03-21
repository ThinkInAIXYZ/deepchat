import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import type { PendingSessionInputRecord } from '@shared/types/agent-interface'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, number>) => {
      switch (key) {
        case 'chat.pendingInput.steer':
          return 'Steer'
        case 'chat.pendingInput.queueCount':
          return `Queue ${params?.count}/${params?.max}`
        case 'chat.pendingInput.resumeQueue':
          return 'Resume queue'
        case 'chat.pendingInput.toSteer':
          return 'Steer'
        case 'chat.pendingInput.locked':
          return 'Locked'
        case 'chat.pendingInput.reorder':
          return 'Reorder'
        case 'chat.pendingInput.files':
          return `${params?.count} files`
        case 'chat.pendingInput.attachmentsOnly':
          return `${params?.count} attachments`
        case 'chat.pendingInput.empty':
          return 'Empty message'
        case 'chat.pendingInput.limitReached':
          return `Waiting lane is full (${params?.max}).`
        case 'common.cancel':
          return 'Cancel'
        case 'common.save':
          return 'Save'
        default:
          return key
      }
    }
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    props: {
      icon: {
        type: String,
        required: true
      }
    },
    template: '<span :data-icon="icon" />'
  })
}))

vi.mock('@shadcn/components/ui/button', () => ({
  Button: defineComponent({
    name: 'Button',
    props: {
      disabled: {
        type: Boolean,
        default: false
      }
    },
    emits: ['click'],
    template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
  })
}))

vi.mock('vuedraggable', () => ({
  default: defineComponent({
    name: 'Draggable',
    props: {
      list: {
        type: Array,
        required: true
      },
      disabled: {
        type: Boolean,
        default: false
      }
    },
    template: `
      <div data-testid="draggable" :data-disabled="disabled ? 'true' : 'false'">
        <div v-for="element in list" :key="element.id">
          <slot name="item" :element="element" />
        </div>
      </div>
    `
  })
}))

import PendingInputLane from '@/components/chat/PendingInputLane.vue'

function buildPendingInput(
  id: string,
  mode: 'queue' | 'steer',
  overrides: Partial<PendingSessionInputRecord> = {}
): PendingSessionInputRecord {
  return {
    id,
    sessionId: 's1',
    mode,
    state: 'pending',
    payload: {
      text: `${mode}-${id}`,
      files: []
    },
    queueOrder: mode === 'queue' ? Number(id.replace(/\D+/g, '') || '1') : null,
    claimedAt: null,
    consumedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('PendingInputLane', () => {
  it('renders a single pending rail with compact rows for steer and queue items', () => {
    const wrapper = mount(PendingInputLane, {
      props: {
        steerItems: [buildPendingInput('steer-1', 'steer')],
        queueItems: [buildPendingInput('queue-1', 'queue'), buildPendingInput('queue-2', 'queue')]
      }
    })

    expect(wrapper.findAll('[data-testid="pending-rail"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-testid="pending-row"]')).toHaveLength(3)

    const queueMain = wrapper.find('[data-mode="queue"] [data-testid="pending-row-main"] span')
    expect(queueMain.classes()).toContain('truncate')

    const steerText = wrapper.find('[data-mode="steer"] [title]')
    expect(steerText.classes()).toContain('truncate')
  })

  it('shows inline file badges and becomes internally scrollable when more than three items exist', () => {
    const wrapper = mount(PendingInputLane, {
      props: {
        steerItems: [buildPendingInput('steer-1', 'steer')],
        queueItems: [
          buildPendingInput('queue-1', 'queue', {
            payload: {
              text: 'queue-1',
              files: [{ name: 'a.txt', path: '/a.txt', mimeType: 'text/plain', size: 1 }]
            }
          }),
          buildPendingInput('queue-2', 'queue'),
          buildPendingInput('queue-3', 'queue')
        ]
      }
    })

    expect(wrapper.get('[data-testid="pending-rail-list"]').attributes('data-scrollable')).toBe(
      'true'
    )
    expect(wrapper.text()).toContain('1 files')
  })

  it('expands only the active queue item for inline editing and disables drag while editing', async () => {
    const wrapper = mount(PendingInputLane, {
      props: {
        steerItems: [],
        queueItems: [buildPendingInput('queue-1', 'queue'), buildPendingInput('queue-2', 'queue')]
      }
    })

    const mainButtons = wrapper.findAll('[data-testid="pending-row-main"]')
    await mainButtons[0].trigger('click')

    expect(wrapper.findAll('[data-testid="pending-edit-textarea"]')).toHaveLength(1)
    const queueRows = wrapper.findAll('[data-mode="queue"]')
    expect(queueRows[0].attributes('data-editing')).toBe('true')
    expect(queueRows[1].attributes('data-editing')).toBe('false')
    expect(wrapper.get('[data-testid="draggable"]').attributes('data-disabled')).toBe('true')
  })

  it('shows resume queue action only when requested and emits the event', async () => {
    const wrapper = mount(PendingInputLane, {
      props: {
        steerItems: [],
        queueItems: [buildPendingInput('queue-1', 'queue')],
        showResumeQueue: true
      }
    })

    const buttons = wrapper.findAll('button')
    const resumeButton = buttons.find((button) => button.text() === 'Resume queue')

    expect(resumeButton).toBeTruthy()
    await resumeButton!.trigger('click')
    expect(wrapper.emitted('resume-queue')).toHaveLength(1)
  })
})
