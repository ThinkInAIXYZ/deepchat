import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import MemoryTurnDialog from '@/components/chat/MemoryTurnDialog.vue'

const memoryActivity = vi.hoisted(() => ({
  selectedTurn: null as any,
  isTurnPanelOpen: true,
  readOnly: false,
  closeTurnPanel: vi.fn(),
  forget: vi.fn()
}))

const toast = vi.hoisted(() => vi.fn())

vi.mock('@/stores/ui/memoryActivity', () => ({
  useMemoryActivityStore: () => memoryActivity
}))

vi.mock('@/components/use-toast', () => ({
  useToast: () => ({ toast })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
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

vi.mock('@shadcn/components/ui/badge', () => ({
  Badge: defineComponent({
    name: 'Badge',
    template: '<span><slot /></span>'
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
    template:
      '<button type="button" :disabled="disabled" v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>'
  })
}))

vi.mock('@shadcn/components/ui/dialog', () => ({
  Dialog: defineComponent({
    name: 'Dialog',
    props: {
      open: {
        type: Boolean,
        default: false
      }
    },
    emits: ['update:open'],
    template: '<div v-if="open"><slot /></div>'
  }),
  DialogContent: defineComponent({
    name: 'DialogContent',
    template: '<div><slot /></div>'
  }),
  DialogHeader: defineComponent({
    name: 'DialogHeader',
    template: '<div><slot /></div>'
  }),
  DialogTitle: defineComponent({
    name: 'DialogTitle',
    template: '<h2><slot /></h2>'
  })
}))

function makeTurn(overrides: Record<string, unknown> = {}) {
  return {
    messageId: 'assistant-1',
    userMessageId: 'user-1',
    status: 'ready',
    manifest: {
      sessionId: 'session-1',
      messageId: 'user-1',
      entryId: 12,
      policyVersion: 1,
      tokenBudget: 1000,
      estimatedTokens: 100,
      selectedCount: 1,
      selectedIds: ['m1'],
      droppedCount: 0,
      queryHash: 'hash',
      createdAt: 200
    },
    details: [
      {
        id: 'm1',
        memory: {
          id: 'm1',
          agentId: 'deepchat',
          kind: 'semantic',
          category: null,
          content: 'memory content',
          importance: 0.5,
          status: 'embedded',
          sourceSession: null,
          sourceEntryIds: null,
          supersededBy: null,
          createdAt: 1000
        }
      }
    ],
    error: null,
    stale: false,
    ...overrides
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

describe('MemoryTurnDialog', () => {
  beforeEach(() => {
    memoryActivity.selectedTurn = makeTurn()
    memoryActivity.isTurnPanelOpen = true
    memoryActivity.readOnly = false
    memoryActivity.closeTurnPanel.mockClear()
    memoryActivity.forget.mockReset()
    toast.mockClear()
  })

  it('shows an explicit error state instead of the empty state', () => {
    memoryActivity.selectedTurn = makeTurn({
      status: 'error',
      manifest: null,
      details: [],
      error: 'load failed'
    })

    const wrapper = mount(MemoryTurnDialog)

    expect(wrapper.text()).toContain('chat.memory.turn.error')
    expect(wrapper.text()).not.toContain('chat.memory.turn.empty')
  })

  it('shows a refresh failure notice while keeping stale ready content visible', () => {
    memoryActivity.selectedTurn = makeTurn({
      stale: true,
      error: 'db down'
    })

    const wrapper = mount(MemoryTurnDialog)

    expect(wrapper.text()).toContain('chat.memory.turn.refreshFailed')
    expect(wrapper.text()).toContain('chat.memory.turn.selected')
    expect(wrapper.text()).toContain('memory content')
    expect(wrapper.text()).not.toContain('chat.memory.turn.error')
    expect(wrapper.text()).not.toContain('db down')
  })

  it('disables forget mutations in read-only mode', async () => {
    const wrapper = mount(MemoryTurnDialog, {
      props: {
        readOnly: true
      }
    })

    const forgetButton = wrapper.find('button[aria-label="chat.memory.actions.forget"]')
    expect(forgetButton.attributes('disabled')).toBeDefined()

    await forgetButton.trigger('click')
    expect(memoryActivity.forget).not.toHaveBeenCalled()
  })

  it('allows forget mutations when the dialog is writable', async () => {
    memoryActivity.forget.mockResolvedValue(true)
    const wrapper = mount(MemoryTurnDialog)

    await wrapper.find('button[aria-label="chat.memory.actions.forget"]').trigger('click')

    expect(memoryActivity.forget).toHaveBeenCalledWith('m1')
    expect(toast).toHaveBeenCalledWith({
      title: 'chat.memory.toast.forgetSuccess',
      variant: 'default'
    })
  })

  it('prevents duplicate forget mutations while a memory is busy', async () => {
    const pending = deferred<boolean>()
    memoryActivity.forget.mockReturnValue(pending.promise)
    const wrapper = mount(MemoryTurnDialog)
    const forgetButton = wrapper.find('button[aria-label="chat.memory.actions.forget"]')

    await forgetButton.trigger('click')
    await forgetButton.trigger('click')

    expect(memoryActivity.forget).toHaveBeenCalledTimes(1)
    expect(forgetButton.attributes('disabled')).toBeDefined()

    pending.resolve(true)
    await flushPromises()

    expect(toast).toHaveBeenCalledWith({
      title: 'chat.memory.toast.forgetSuccess',
      variant: 'default'
    })
  })
})
