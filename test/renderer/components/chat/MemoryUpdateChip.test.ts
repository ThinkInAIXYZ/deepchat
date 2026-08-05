import { flushPromises, mount } from '@vue/test-utils'
import { computed, defineComponent, h, inject, provide } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MemoryUpdateChip from '@/components/chat/MemoryUpdateChip.vue'

const memoryActivity = vi.hoisted(() => ({ store: null as any }))
const popoverBehavior = vi.hoisted(() => ({ forceContent: false }))

vi.mock('@/stores/ui/memoryActivity', async () => {
  const { reactive } = await vi.importActual<typeof import('vue')>('vue')
  const store = reactive({
    hasChip: true,
    chipItems: [] as any[],
    displayChipItems: [] as any[],
    chipDraft: null as null | { memoryId: string; text: string; carryoverItem: any | null },
    clearChip: vi.fn(() => {
      store.hasChip = false
      store.chipItems = []
      store.displayChipItems = []
      store.chipDraft = null
    }),
    startChipEdit: vi.fn((item: any) => {
      store.chipDraft = { memoryId: item.id, text: item.memory.content, carryoverItem: null }
    }),
    setChipDraftText: vi.fn((text: string) => {
      if (store.chipDraft) store.chipDraft = { ...store.chipDraft, text }
    }),
    cancelChipEdit: vi.fn(() => {
      store.chipDraft = null
    }),
    undoCreated: vi.fn(),
    forget: vi.fn(),
    amend: vi.fn()
  })
  memoryActivity.store = store
  return {
    useMemoryActivityStore: () => store
  }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params?.count === undefined ? key : `${key}:${params.count}`
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
    template:
      '<button type="button" :disabled="disabled" v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>'
  })
}))

const popoverContextKey = Symbol('PopoverContext')

vi.mock('@shadcn/components/ui/popover', () => ({
  Popover: defineComponent({
    name: 'Popover',
    props: {
      open: {
        type: Boolean,
        default: false
      }
    },
    emits: ['update:open'],
    setup(props, { emit, slots }) {
      provide(popoverContextKey, {
        open: computed(() => props.open),
        setOpen: (open: boolean) => emit('update:open', open)
      })
      return () => h('div', { 'data-open': String(props.open) }, slots.default?.())
    }
  }),
  PopoverContent: defineComponent({
    name: 'PopoverContent',
    setup(_props, { slots }) {
      const context = inject<any>(popoverContextKey)
      return () =>
        popoverBehavior.forceContent || context?.open.value
          ? h('div', { 'data-testid': 'popover-content' }, slots.default?.())
          : null
    }
  }),
  PopoverTrigger: defineComponent({
    name: 'PopoverTrigger',
    setup(_props, { slots }) {
      const context = inject<any>(popoverContextKey)
      return () =>
        h(
          'div',
          {
            'data-testid': 'popover-trigger',
            onClick: () => context?.setOpen(true)
          },
          slots.default?.()
        )
    }
  })
}))

vi.mock('@shadcn/components/ui/textarea', () => ({
  Textarea: defineComponent({
    name: 'Textarea',
    props: {
      modelValue: {
        type: String,
        default: ''
      }
    },
    emits: ['update:modelValue'],
    setup(_props, { emit }) {
      const handleInput = (event: Event) => {
        emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
      }
      return { handleInput }
    },
    template: '<textarea :value="modelValue" v-bind="$attrs" @input="handleInput" />'
  })
}))

function makeChipItem(error: string | null = null, memoryOverrides: Record<string, unknown> = {}) {
  const id = typeof memoryOverrides.id === 'string' ? memoryOverrides.id : 'm1'
  return {
    id,
    busy: false,
    error,
    memory: {
      id,
      agentId: 'deepchat',
      kind: 'semantic',
      category: null,
      content: 'memory content',
      importance: 0.5,
      status: 'embedded',
      sourceSession: null,
      sourceEntryIds: null,
      supersededBy: null,
      createdAt: 1000,
      ...memoryOverrides
    }
  }
}

async function openChipPopover(wrapper: ReturnType<typeof mount>): Promise<void> {
  await wrapper.find('[data-testid="popover-trigger"]').trigger('click')
  await flushPromises()
}

describe('MemoryUpdateChip', () => {
  beforeEach(() => {
    const store = memoryActivity.store
    store.hasChip = true
    store.chipItems = [makeChipItem()]
    store.displayChipItems = store.chipItems
    store.chipDraft = null
    store.clearChip.mockClear()
    store.startChipEdit.mockClear()
    store.setChipDraftText.mockClear()
    store.cancelChipEdit.mockClear()
    store.undoCreated.mockReset()
    store.forget.mockReset()
    store.amend.mockReset()
    popoverBehavior.forceContent = false
  })

  it('renders retryable amend errors with a specific message', async () => {
    memoryActivity.store.chipItems = [makeChipItem('amend_failed_retry')]
    memoryActivity.store.displayChipItems = memoryActivity.store.chipItems

    const wrapper = mount(MemoryUpdateChip)
    await openChipPopover(wrapper)

    expect(wrapper.text()).toContain('chat.memory.errors.amendRetryable')
  })

  it('renders unrecovered amend errors with a specific message', async () => {
    memoryActivity.store.chipItems = [makeChipItem('amend_restore_failed')]
    memoryActivity.store.displayChipItems = memoryActivity.store.chipItems

    const wrapper = mount(MemoryUpdateChip)
    await openChipPopover(wrapper)

    expect(wrapper.text()).toContain('chat.memory.errors.amendRestoreFailed')
  })

  it('keeps edit mode open when amend fails', async () => {
    memoryActivity.store.amend.mockResolvedValue(null)
    const wrapper = mount(MemoryUpdateChip)
    await openChipPopover(wrapper)

    await wrapper.find('button[aria-label="chat.memory.actions.edit"]').trigger('click')
    await wrapper.find('textarea').setValue('edited content')
    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'common.save')
    expect(saveButton).toBeDefined()

    await saveButton!.trigger('click')
    await flushPromises()

    expect(memoryActivity.store.amend).toHaveBeenCalledWith('m1', 'edited content')
    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.find('textarea').attributes('aria-label')).toBe('chat.memory.actions.edit')
  })

  it('disables undo and edit actions for archived chip items', async () => {
    memoryActivity.store.chipItems = [makeChipItem(null, { status: 'archived' })]
    memoryActivity.store.displayChipItems = memoryActivity.store.chipItems
    const wrapper = mount(MemoryUpdateChip)
    await openChipPopover(wrapper)

    expect(
      wrapper.find('button[aria-label="chat.memory.actions.undo"]').attributes('disabled')
    ).toBeDefined()
    expect(
      wrapper.find('button[aria-label="chat.memory.actions.forget"]').attributes('disabled')
    ).toBeDefined()
    const editButton = wrapper.find('button[aria-label="chat.memory.actions.edit"]')
    expect(editButton.attributes('disabled')).toBeDefined()

    await editButton.trigger('click')

    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(memoryActivity.store.amend).not.toHaveBeenCalled()
  })

  it('blocks busy chip mutations in the component layer', async () => {
    const busyItem = { ...makeChipItem(), busy: true }
    memoryActivity.store.chipItems = [busyItem]
    memoryActivity.store.displayChipItems = memoryActivity.store.chipItems
    memoryActivity.store.chipDraft = {
      memoryId: 'm1',
      text: 'edited content',
      carryoverItem: null
    }
    const wrapper = mount(MemoryUpdateChip)
    await openChipPopover(wrapper)

    const undoButton = wrapper.find('button[aria-label="chat.memory.actions.undo"]')
    const forgetButton = wrapper.find('button[aria-label="chat.memory.actions.forget"]')
    const editButton = wrapper.find('button[aria-label="chat.memory.actions.edit"]')
    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'common.save')

    expect(undoButton.attributes('disabled')).toBeDefined()
    expect(forgetButton.attributes('disabled')).toBeDefined()
    expect(editButton.attributes('disabled')).toBeDefined()
    expect(saveButton?.attributes('disabled')).toBeDefined()

    await undoButton.trigger('click')
    await forgetButton.trigger('click')
    await editButton.trigger('click')
    await saveButton!.trigger('click')
    await flushPromises()

    expect(memoryActivity.store.undoCreated).not.toHaveBeenCalled()
    expect(memoryActivity.store.forget).not.toHaveBeenCalled()
    expect(memoryActivity.store.startChipEdit).not.toHaveBeenCalled()
    expect(memoryActivity.store.amend).not.toHaveBeenCalled()
  })

  it('clears the chip through the close action', async () => {
    const wrapper = mount(MemoryUpdateChip)
    await openChipPopover(wrapper)

    expect(wrapper.find('button[data-testid="memory-chip-clear"]').attributes('aria-label')).toBe(
      'common.clear'
    )

    await wrapper.find('button[data-testid="memory-chip-clear"]').trigger('click')

    expect(memoryActivity.store.clearChip).toHaveBeenCalledTimes(1)
  })

  it('keeps the store-owned draft when the visible chip list changes', async () => {
    const wrapper = mount(MemoryUpdateChip)
    await openChipPopover(wrapper)

    await wrapper.find('button[aria-label="chat.memory.actions.edit"]').trigger('click')
    await wrapper.find('textarea').setValue('edited content')
    memoryActivity.store.chipItems = [makeChipItem(null, { id: 'm2', content: 'new memory' })]
    memoryActivity.store.displayChipItems = [makeChipItem(), ...memoryActivity.store.chipItems]
    await flushPromises()

    expect(wrapper.find('textarea').exists()).toBe(true)
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('edited content')
  })

  it('closes portal content when hidden without clearing the store-owned draft', async () => {
    const wrapper = mount(MemoryUpdateChip)
    await openChipPopover(wrapper)

    await wrapper.find('button[aria-label="chat.memory.actions.edit"]').trigger('click')
    await wrapper.find('textarea').setValue('edited content')

    expect(wrapper.find('[data-testid="popover-content"]').exists()).toBe(true)

    await wrapper.setProps({ visible: false })
    await flushPromises()

    expect(wrapper.find('[data-testid="popover-content"]').exists()).toBe(false)
    expect(memoryActivity.store.chipDraft).toMatchObject({
      memoryId: 'm1',
      text: 'edited content'
    })
    expect(memoryActivity.store.clearChip).not.toHaveBeenCalled()
    expect(memoryActivity.store.cancelChipEdit).not.toHaveBeenCalled()
  })

  it('does not open the popover or run actions while hidden', async () => {
    const wrapper = mount(MemoryUpdateChip, {
      props: {
        visible: false
      }
    })

    await wrapper.find('[data-testid="popover-trigger"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="popover-content"]').exists()).toBe(false)
    expect(memoryActivity.store.clearChip).not.toHaveBeenCalled()
    expect(memoryActivity.store.undoCreated).not.toHaveBeenCalled()
    expect(memoryActivity.store.forget).not.toHaveBeenCalled()
    expect(memoryActivity.store.startChipEdit).not.toHaveBeenCalled()
    expect(memoryActivity.store.amend).not.toHaveBeenCalled()
  })

  it('blocks leaked portal actions while hidden', async () => {
    popoverBehavior.forceContent = true
    memoryActivity.store.chipDraft = {
      memoryId: 'm1',
      text: 'edited content',
      carryoverItem: null
    }
    const wrapper = mount(MemoryUpdateChip, {
      props: {
        visible: false
      }
    })

    expect(wrapper.find('[data-testid="popover-content"]').exists()).toBe(true)
    const textarea = wrapper.find('textarea')
    expect(textarea.attributes('disabled')).toBeDefined()

    await textarea.setValue('hidden edit')
    await wrapper.find('button[data-testid="memory-chip-clear"]').trigger('click')
    await wrapper.find('button[aria-label="chat.memory.actions.undo"]').trigger('click')
    await wrapper.find('button[aria-label="chat.memory.actions.forget"]').trigger('click')
    await wrapper.find('button[aria-label="chat.memory.actions.edit"]').trigger('click')
    const cancelButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'common.cancel')
    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'common.save')
    await cancelButton!.trigger('click')
    await saveButton!.trigger('click')
    await flushPromises()

    expect(memoryActivity.store.clearChip).not.toHaveBeenCalled()
    expect(memoryActivity.store.undoCreated).not.toHaveBeenCalled()
    expect(memoryActivity.store.forget).not.toHaveBeenCalled()
    expect(memoryActivity.store.startChipEdit).not.toHaveBeenCalled()
    expect(memoryActivity.store.cancelChipEdit).not.toHaveBeenCalled()
    expect(memoryActivity.store.setChipDraftText).not.toHaveBeenCalled()
    expect(memoryActivity.store.amend).not.toHaveBeenCalled()
    expect(memoryActivity.store.chipDraft).toMatchObject({
      memoryId: 'm1',
      text: 'edited content'
    })
  })
})
