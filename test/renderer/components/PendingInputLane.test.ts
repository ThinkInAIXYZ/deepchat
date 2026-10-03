import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { EditorContent } from '@tiptap/vue-3'
import { createDeferred } from '../utils/deferred'
import type { PendingSessionInputRecord } from '@shared/types/agent-interface'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, number>) => {
      switch (key) {
        case 'chat.pendingInput.steer':
          return 'Steer'
        case 'chat.pendingInput.queueCount':
          return `Queue ${params?.count}/${params?.max}`
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
        case 'chat.pendingInput.remove':
          return 'Remove'
        case 'chat.pendingInput.steerUnavailable':
          return "Can't interrupt right now"
        case 'chat.pendingInput.steerFailed':
          return 'Steer failed'
        case 'chat.pendingInput.resume':
          return 'Resume queue'
        case 'chat.pendingInput.retry':
          return 'Retry'
        case 'chat.pendingInput.retryRequired':
          return 'Retry required'
        case 'chat.pendingInput.retryRequiredDescription':
          return "This message wasn't sent. Retry it to continue the queue."
        case 'chat.attachments.pending.blockedCount':
          return `${params?.count} blocked`
        case 'chat.attachments.pending.blocked':
          return 'Blocked'
        case 'chat.attachments.pending.retry':
          return 'Retry OCR'
        case 'chat.attachments.pending.sendWithoutImageContent':
          return 'Send without image content'
        case 'chat.attachments.pending.blockedDescription':
          return 'Waiting for a decision'
        case 'chat.attachments.pending.blockedReasonMore':
          return `${String(params?.reason)} and ${params?.count} more`
        case 'chat.attachments.reasons.ocr_empty':
          return 'No text found'
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

vi.mock('@dc-ui/components/button', () => ({
  DcButton: defineComponent({
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
    messageIds: [],
    assistantMessageId: null,
    queueOrder: mode === 'queue' ? Number(id.replace(/\D+/g, '') || '1') : null,
    claimedAt: null,
    consumedAt: null,
    blocking: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('PendingInputLane', () => {
  it('retains a failed draft and blocks duplicate saves until the callback resolves', async () => {
    // jsdom lacks the Range geometry used by Tiptap's deferred focus scrolling.
    const createRange = document.createRange.bind(document)
    vi.spyOn(document, 'createRange').mockImplementation(() =>
      Object.assign(createRange(), {
        getClientRects: () => [],
        getBoundingClientRect: () => new DOMRect()
      })
    )
    const pending = createDeferred<boolean>()
    const saveEdit = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(true)
    const wrapper = mount(PendingInputLane, {
      props: {
        queueItems: [
          buildPendingInput('queue-1', 'queue', {
            payload: {
              text: 'Read ',
              files: [],
              inlineItems: [
                {
                  type: 'session',
                  offset: 5,
                  sessionId: 'source',
                  title: 'Research',
                  projectDir: null,
                  tapeIncarnationId: 'tape'
                }
              ]
            }
          }),
          buildPendingInput('queue-2', 'queue')
        ],
        saveEdit
      },
      attachTo: document.body
    })
    await wrapper.findAll('[data-testid="pending-row-main"]')[0].trigger('click')
    const editor = wrapper.getComponent(EditorContent).props('editor')!
    editor.commands.insertContentAt(1, 'Changed: ')
    const otherRow = wrapper.get('[data-testid="pending-row-main"]')
    ;(otherRow.element as HTMLButtonElement).click()
    await flushPromises()
    const textbox = wrapper.get('[role="textbox"]')
    expect(textbox.text()).toContain('Changed: Read')
    expect(otherRow.element.matches(':disabled')).toBe(true)
    await textbox.trigger('keydown', { key: 'Enter', ctrlKey: true })
    expect(saveEdit).toHaveBeenCalledTimes(1)
    expect(textbox.attributes('contenteditable')).toBe('false')
    await textbox.trigger('keydown', { key: 'Enter', ctrlKey: true })
    await textbox.trigger('keydown', { key: 'Escape' })
    expect(saveEdit).toHaveBeenCalledTimes(1)
    pending.resolve(false)
    await flushPromises()
    expect(otherRow.element.matches(':disabled')).toBe(true)
    ;(otherRow.element as HTMLButtonElement).click()
    expect(textbox.attributes('contenteditable')).toBe('true')
    expect(textbox.text()).toContain('Changed: Read')
    expect(wrapper.findAll('[data-session-reference]')).toHaveLength(1)
    await textbox.trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(saveEdit.mock.calls[1]).toEqual(saveEdit.mock.calls[0])
    expect(saveEdit).toHaveBeenLastCalledWith({
      itemId: 'queue-1',
      text: 'Changed: Read ',
      inlineItems: [
        {
          type: 'session',
          offset: 14,
          sessionId: 'source',
          title: 'Research',
          projectDir: null,
          tapeIncarnationId: 'tape'
        }
      ]
    })
    expect(wrapper.find('[role="textbox"]').exists()).toBe(false)
    expect(otherRow.element.matches(':disabled')).toBe(false)
    await otherRow.trigger('click')
    expect(wrapper.get('[role="textbox"]').text()).toBe('queue-queue-2')
    await wrapper.get('[role="textbox"]').trigger('keydown', { key: 'Escape' })
    await wrapper.findAll('[data-testid="pending-row-main"]')[0].trigger('click')
    expect(wrapper.get('[role="textbox"]').text()).toContain('Read')
    expect(saveEdit).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('labels reference-only inputs and permits saving them without text', async () => {
    const saveEdit = vi.fn().mockResolvedValue(true)
    const wrapper = mount(PendingInputLane, {
      props: {
        saveEdit,
        queueItems: [
          buildPendingInput('queue-1', 'queue', {
            payload: {
              text: '',
              files: [],
              inlineItems: [
                {
                  type: 'session',
                  offset: 0,
                  sessionId: 'source',
                  title: 'Launch research',
                  projectDir: null,
                  tapeIncarnationId: 'incarnation'
                }
              ]
            }
          })
        ]
      }
    })
    const row = wrapper.get('[data-testid="pending-row-main"]')
    expect(row.text()).toBe('Launch research')
    await row.trigger('click')
    const save = wrapper.findAll('button').find((button) => button.text() === 'Save')!
    expect((save.element as HTMLButtonElement).disabled).toBe(false)
    await save.trigger('click')
    expect(saveEdit.mock.calls).toEqual([
      [
        {
          itemId: 'queue-1',
          text: '',
          inlineItems: [
            {
              type: 'session',
              offset: 0,
              sessionId: 'source',
              title: 'Launch research',
              projectDir: null,
              tapeIncarnationId: 'incarnation'
            }
          ]
        }
      ]
    ])
    await wrapper.setProps({
      queueItems: [buildPendingInput('queue-1', 'queue', { payload: { text: '', files: [] } })]
    })
    await wrapper.get('[data-testid="pending-row-main"]').trigger('click')
    const emptySave = wrapper.findAll('button').find((button) => button.text() === 'Save')!
    expect((emptySave.element as HTMLButtonElement).disabled).toBe(true)
    await wrapper.get('[data-testid="pending-edit-textarea"]').trigger('keydown', { key: 'Enter' })
    expect(saveEdit).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('shows every recovered input and its actual count even above the admission limit', async () => {
    const queueItems = Array.from({ length: 11 }, (_, index) =>
      buildPendingInput(`queue-${index + 1}`, 'queue')
    )
    const wrapper = mount(PendingInputLane, {
      props: { queueItems, disableSteerAction: true }
    })

    expect(wrapper.findAll('[data-testid="pending-row"]')).toHaveLength(11)
    expect(wrapper.text()).toContain('Queue 11/10')
    expect(wrapper.text()).toContain('Waiting lane is full (10).')

    await wrapper.setProps({ queueItems: queueItems.slice(2), disableSteerAction: false })
    expect(wrapper.text()).toContain('Queue 9/10')
    expect(wrapper.text()).not.toContain('Waiting lane is full')
  })

  it('exposes one disabled-aware Queue resume action in the lane header', async () => {
    const wrapper = mount(PendingInputLane, {
      props: {
        queueItems: [buildPendingInput('queue-1', 'queue')],
        showResumeAction: true
      }
    })

    const resume = wrapper.get('[data-testid="pending-resume-queue"]')
    expect(resume.text()).toContain('Resume queue')
    await resume.trigger('click')
    expect(wrapper.emitted('resume-queue')).toEqual([[]])

    await wrapper.setProps({ resumeDisabled: true })
    expect((resume.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders compact rows only for queued inputs', () => {
    const wrapper = mount(PendingInputLane, {
      props: {
        queueItems: [buildPendingInput('queue-1', 'queue'), buildPendingInput('queue-2', 'queue')]
      }
    })

    expect(wrapper.findAll('[data-testid="pending-rail"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-testid="pending-row"]')).toHaveLength(2)

    const queueMain = wrapper.find('[data-mode="queue"] [data-testid="pending-row-main"] span')
    expect(queueMain.classes()).toContain('truncate')
  })

  it('shows inline file badges and becomes internally scrollable when more than three items exist', () => {
    const wrapper = mount(PendingInputLane, {
      props: {
        queueItems: [
          buildPendingInput('queue-1', 'queue', {
            payload: {
              text: 'queue-1',
              files: [{ name: 'a.txt', path: '/a.txt', mimeType: 'text/plain', size: 1 }]
            }
          }),
          buildPendingInput('queue-2', 'queue'),
          buildPendingInput('queue-3', 'queue'),
          buildPendingInput('queue-4', 'queue')
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

  it('emits steer-queue with the item id when the queue row interrupt button is clicked', async () => {
    const wrapper = mount(PendingInputLane, {
      props: {
        queueItems: [buildPendingInput('queue-1', 'queue')]
      }
    })

    const steerButtons = wrapper.findAll('[data-testid="pending-row-steer"]')
    expect(steerButtons).toHaveLength(1)
    expect(steerButtons[0].attributes('aria-label')).toBe('Steer')

    await steerButtons[0].trigger('click')

    expect(wrapper.emitted('steer-queue')).toEqual([['queue-1']])
  })

  it('disables the queue row interrupt button when disableQueueSteerAction is set', () => {
    const wrapper = mount(PendingInputLane, {
      props: {
        queueItems: [buildPendingInput('queue-1', 'queue')],
        disableQueueSteerAction: true
      }
    })

    const steerButton = wrapper.get('[data-testid="pending-row-steer"]')
    expect((steerButton.element as HTMLButtonElement).disabled).toBe(true)
    expect(steerButton.attributes('aria-label')).toBe("Can't interrupt right now")
  })

  it('renders blocked reasons and emits retry and explicit degradation actions', async () => {
    const blocked = buildPendingInput('queue-1', 'queue', {
      state: 'blocked',
      blocking: {
        status: 'needs_user_action',
        issues: [{ attachmentIndex: 0, reason: 'ocr_empty' }],
        suggestedActions: ['retry', 'send_without_image_content']
      }
    })
    const wrapper = mount(PendingInputLane, {
      props: {
        queueItems: [blocked]
      }
    })

    expect(wrapper.text()).toContain('No text found')
    expect(wrapper.get('[data-testid="draggable"]').attributes('data-disabled')).toBe('true')
    expect(wrapper.find('[data-testid="pending-row-steer"]').exists()).toBe(false)

    await wrapper.get('[data-testid="pending-blocked-retry"]').trigger('click')
    await wrapper.get('[data-testid="pending-blocked-send-without"]').trigger('click')

    expect(wrapper.emitted('resolve-blocked')).toEqual([
      [{ itemId: 'queue-1', action: 'retry' }],
      [{ itemId: 'queue-1', action: 'send_without_image_content' }]
    ])
  })

  it('exposes retry only for a retry-required Queue head and keeps edit-as-retry available', async () => {
    const released = buildPendingInput('queue-1', 'queue', { state: 'retry_required' })
    const wrapper = mount(PendingInputLane, {
      props: {
        queueItems: [released],
        retryingItemId: 'queue-1'
      }
    })

    expect(wrapper.text()).toContain("This message wasn't sent")
    expect(wrapper.get('[data-testid="draggable"]').attributes('data-disabled')).toBe('true')
    expect(wrapper.find('[data-testid="pending-row-steer"]').exists()).toBe(false)
    expect(
      (wrapper.get('[data-testid="pending-released-retry"]').element as HTMLButtonElement).disabled
    ).toBe(true)

    await wrapper.setProps({ retryingItemId: null })
    await wrapper.get('[data-testid="pending-released-retry"]').trigger('click')
    expect(wrapper.emitted('retry-queue')).toEqual([['queue-1']])

    await wrapper.get('[data-testid="pending-row-main"]').trigger('click')
    expect(wrapper.find('[data-testid="pending-edit-textarea"]').exists()).toBe(true)
  })

  it('does not show explicit retry for an ordinary pending Queue row', () => {
    const wrapper = mount(PendingInputLane, {
      props: {
        queueItems: [buildPendingInput('queue-1', 'queue')]
      }
    })

    expect(wrapper.find('[data-testid="pending-released-retry"]').exists()).toBe(false)
  })
})
