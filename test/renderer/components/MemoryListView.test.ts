import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { MemoryItem, MemorySearchResult } from '../../../src/shared/contracts/routes'

const passthrough = (name: string) => defineComponent({ name, template: '<div><slot /></div>' })

const ButtonStub = defineComponent({
  name: 'Button',
  props: { disabled: { type: Boolean, default: false } },
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const InputStub = defineComponent({
  name: 'Input',
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  template:
    '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
})

const CheckboxStub = defineComponent({
  name: 'Checkbox',
  props: { checked: { type: Boolean, default: false } },
  emits: ['update:checked'],
  template:
    '<input type="checkbox" :checked="checked" @change="$emit(\'update:checked\', $event.target.checked)" />'
})

const AlertDialogStub = defineComponent({
  name: 'AlertDialog',
  props: { open: { type: Boolean, default: false } },
  template: '<div data-testid="delete-confirm-dialog" :data-open="open"><slot v-if="open" /></div>'
})

const MemoryInlinePanelStub = defineComponent({
  name: 'MemoryInlinePanel',
  props: ['memory', 'mode', 'discardPrompt'],
  emits: ['close', 'edit', 'changed', 'saved', 'dirty', 'discard-pending', 'cancel-pending'],
  template:
    '<div data-testid="inline-panel" :data-mode="mode" :data-memory-id="memory?.id ?? \'\'" />'
})

const stubs = {
  Button: ButtonStub,
  Input: InputStub,
  Checkbox: CheckboxStub,
  Select: passthrough('Select'),
  SelectContent: passthrough('SelectContent'),
  SelectItem: passthrough('SelectItem'),
  SelectTrigger: passthrough('SelectTrigger'),
  SelectValue: passthrough('SelectValue'),
  ScrollArea: passthrough('ScrollArea'),
  AlertDialog: AlertDialogStub,
  AlertDialogAction: ButtonStub,
  AlertDialogCancel: ButtonStub,
  AlertDialogContent: passthrough('AlertDialogContent'),
  AlertDialogDescription: passthrough('AlertDialogDescription'),
  AlertDialogFooter: passthrough('AlertDialogFooter'),
  AlertDialogHeader: passthrough('AlertDialogHeader'),
  AlertDialogTitle: passthrough('AlertDialogTitle'),
  MemoryInlinePanel: MemoryInlinePanelStub,
  MemoryEmptyState: passthrough('MemoryEmptyState'),
  Icon: passthrough('Icon')
}

const originalScrollIntoView = Element.prototype.scrollIntoView

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function memory(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 'm1',
    agentId: 'deepchat',
    kind: 'semantic',
    category: null,
    content: 'user likes redis',
    importance: 0.5,
    status: 'embedded',
    sourceSession: null,
    sourceEntryIds: null,
    supersededBy: null,
    createdAt: 1700000000000,
    ...overrides
  }
}

async function setup(
  options: {
    rows?: MemoryItem[]
    searchRows?: MemorySearchResult[]
    agentId?: string
    refreshToken?: number
  } = {}
) {
  vi.resetModules()
  const memoryClient = {
    list: vi.fn().mockResolvedValue(options.rows ?? [memory()]),
    search: vi.fn().mockResolvedValue(
      options.searchRows ?? [
        {
          ...memory(),
          score: 1,
          sources: { fts: true }
        }
      ]
    ),
    archive: vi.fn().mockResolvedValue(true),
    restore: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true)
  }
  const toast = vi.fn()

  vi.doMock('@api/MemoryClient', () => ({ createMemoryClient: () => memoryClient }))
  vi.doMock('@/components/use-toast', () => ({ useToast: () => ({ toast }) }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({ t: (key: string) => key, locale: { value: 'en-US' } })
  }))
  vi.doMock('@iconify/vue', () => ({ Icon: passthrough('Icon') }))

  const MemoryListView = (
    await import('../../../src/renderer/settings/components/MemoryListView.vue')
  ).default
  const wrapper = mount(MemoryListView, {
    props: {
      agentId: options.agentId ?? 'deepchat',
      memoryEnabled: true,
      refreshToken: options.refreshToken ?? 0
    },
    global: { stubs }
  })
  await flushPromises()
  return { wrapper, memoryClient, toast }
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  if (originalScrollIntoView) {
    Element.prototype.scrollIntoView = originalScrollIntoView
  } else {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  }
})

describe('MemoryListView', () => {
  it('keeps search on refresh, but resets search and selection on agent change', async () => {
    vi.useFakeTimers()
    const { wrapper, memoryClient } = await setup()

    await wrapper.find('input[type="search"]').setValue('redis')
    vi.advanceTimersByTime(200)
    await flushPromises()
    expect(memoryClient.search).toHaveBeenLastCalledWith('deepchat', 'redis')

    await wrapper.setProps({ refreshToken: 1 })
    vi.advanceTimersByTime(0)
    await flushPromises()

    expect((wrapper.find('input[type="search"]').element as HTMLInputElement).value).toBe('redis')
    expect(memoryClient.search).toHaveBeenLastCalledWith('deepchat', 'redis')

    await wrapper.find('[role="button"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="inline-panel"]').attributes('data-mode')).toBe('view')
    expect(wrapper.find('[data-testid="inline-panel"]').attributes('data-memory-id')).toBe('m1')

    await wrapper.setProps({ agentId: 'other' })
    await flushPromises()

    expect((wrapper.find('input[type="search"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('[data-testid="inline-panel"]').exists()).toBe(false)
  })

  it('keeps the current list mounted during a background refresh instead of showing the loading placeholder', async () => {
    const { wrapper, memoryClient } = await setup({ rows: [memory()] })
    expect(wrapper.text()).toContain('user likes redis')

    let resolveNext!: (rows: MemoryItem[]) => void
    memoryClient.list.mockImplementationOnce(
      () =>
        new Promise<MemoryItem[]>((resolve) => {
          resolveNext = resolve
        })
    )

    await wrapper.setProps({ refreshToken: 1 })
    await flushPromises()

    // While the background refresh is in flight, the loading placeholder
    // must not replace the already-rendered list.
    expect(wrapper.text()).not.toContain('common.loading')
    expect(wrapper.text()).toContain('user likes redis')

    resolveNext([memory({ content: 'updated fact' })])
    await flushPromises()

    expect(wrapper.text()).toContain('updated fact')
  })

  it('ignores stale list failures after switching agents', async () => {
    const { wrapper, memoryClient, toast } = await setup({ rows: [memory()] })
    const staleLoad = deferred<MemoryItem[]>()
    memoryClient.list.mockReturnValueOnce(staleLoad.promise)

    await wrapper.setProps({ refreshToken: 1 })
    await flushPromises()
    expect(memoryClient.list).toHaveBeenLastCalledWith('deepchat')

    memoryClient.list.mockResolvedValueOnce([memory({ id: 'other-memory', content: 'other fact' })])
    await wrapper.setProps({ agentId: 'other' })
    await flushPromises()
    expect(memoryClient.list).toHaveBeenLastCalledWith('other')

    staleLoad.reject(new Error('stale failure'))
    await flushPromises()

    expect(toast).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('other fact')
  })

  it('opens rows as read-only details and row edit as an edit panel', async () => {
    const { wrapper } = await setup()

    await wrapper.find('[role="button"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="inline-panel"]').attributes('data-mode')).toBe('view')

    await wrapper.find('[data-testid="memory-row-edit"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="inline-panel"]').attributes('data-mode')).toBe('edit')
  })

  it('toggles the current row detail closed when selecting it again', async () => {
    const { wrapper } = await setup()
    const row = wrapper.find('[role="button"]')

    await row.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="inline-panel"]').attributes('data-memory-id')).toBe('m1')

    await row.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="inline-panel"]').exists()).toBe(false)
  })

  it('uses the discard prompt before collapsing a dirty current row', async () => {
    const { wrapper } = await setup()
    const row = wrapper.find('[role="button"]')

    await row.trigger('click')
    await flushPromises()
    const panel = wrapper.findComponent({ name: 'MemoryInlinePanel' })
    panel.vm.$emit('dirty', true)
    await flushPromises()

    await row.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="inline-panel"]').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'MemoryInlinePanel' }).props('discardPrompt')).toBe(true)

    wrapper.findComponent({ name: 'MemoryInlinePanel' }).vm.$emit('discard-pending')
    await flushPromises()
    expect(wrapper.find('[data-testid="inline-panel"]').exists()).toBe(false)
  })

  it('uses a direct permanent-delete row action without opening the inline panel', async () => {
    const { wrapper, memoryClient } = await setup()

    expect(wrapper.html()).not.toContain('lucide:ellipsis')
    expect(wrapper.findComponent({ name: 'DropdownMenu' }).exists()).toBe(false)

    const deleteButton = wrapper.find('[data-testid="memory-row-delete"]')
    expect(deleteButton.exists()).toBe(true)
    expect(deleteButton.attributes('aria-label')).toBe(
      'settings.deepchatAgents.memoryManager.deletePermanent'
    )

    await deleteButton.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="inline-panel"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="delete-confirm-dialog"]').attributes('data-open')).toBe(
      'true'
    )
    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.deleteConfirmTitle')

    const confirmButton = wrapper
      .findAll('button')
      .find((button) =>
        button.text().includes('settings.deepchatAgents.memoryManager.deletePermanent')
      )
    expect(confirmButton).toBeTruthy()
    await confirmButton!.trigger('click')
    await flushPromises()

    expect(memoryClient.remove).toHaveBeenCalledWith('deepchat', 'm1')
    expect(wrapper.text()).not.toContain('user likes redis')
  })

  it('shows a failure toast and keeps the row when permanent delete returns false', async () => {
    const { wrapper, memoryClient, toast } = await setup()
    memoryClient.remove.mockResolvedValueOnce(false)

    await wrapper.find('[data-testid="memory-row-delete"]').trigger('click')
    await flushPromises()
    const confirmButton = wrapper
      .findAll('button')
      .find((button) =>
        button.text().includes('settings.deepchatAgents.memoryManager.deletePermanent')
      )
    await confirmButton!.trigger('click')
    await flushPromises()

    expect(memoryClient.remove).toHaveBeenCalledWith('deepchat', 'm1')
    expect(toast).toHaveBeenCalled()
    expect(wrapper.text()).toContain('user likes redis')
  })

  it('removes an expanded row locally and closes its inline panel after permanent delete', async () => {
    const { wrapper } = await setup()

    await wrapper.find('[role="button"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="inline-panel"]').exists()).toBe(true)

    await wrapper.find('[data-testid="memory-row-delete"]').trigger('click')
    await flushPromises()
    const confirmButton = wrapper
      .findAll('button')
      .find((button) =>
        button.text().includes('settings.deepchatAgents.memoryManager.deletePermanent')
      )
    await confirmButton!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('user likes redis')
    expect(wrapper.find('[data-testid="inline-panel"]').exists()).toBe(false)
  })

  it('keeps the direct permanent-delete action available on archived rows', async () => {
    const { wrapper } = await setup({
      rows: [memory({ status: 'archived' })]
    })

    await wrapper.find('input[type="checkbox"]').setChecked(true)
    await flushPromises()

    expect(wrapper.find('[data-testid="memory-row-restore"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="memory-row-delete"]').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'DropdownMenu' }).exists()).toBe(false)
  })

  it('updates the local list when archive succeeds and reports false archive results', async () => {
    const { wrapper, memoryClient, toast } = await setup()

    await wrapper.find('[data-testid="memory-row-archive"]').trigger('click')
    await flushPromises()

    expect(memoryClient.archive).toHaveBeenCalledWith('deepchat', 'm1')
    expect(wrapper.text()).not.toContain('user likes redis')

    memoryClient.list.mockResolvedValueOnce([memory({ id: 'm2', content: 'visible fact' })])
    await wrapper.setProps({ refreshToken: 1 })
    await flushPromises()
    memoryClient.archive.mockResolvedValueOnce(false)

    await wrapper.find('[data-testid="memory-row-archive"]').trigger('click')
    await flushPromises()

    expect(toast).toHaveBeenCalled()
    expect(wrapper.text()).toContain('visible fact')
  })

  it('updates the active search result when archive succeeds', async () => {
    vi.useFakeTimers()
    const { wrapper, memoryClient } = await setup({
      rows: [memory({ content: 'redis search fact' })],
      searchRows: [
        { ...memory({ content: 'redis search fact' }), score: 1, sources: { fts: true } }
      ]
    })

    await wrapper.find('input[type="search"]').setValue('redis')
    vi.advanceTimersByTime(200)
    await flushPromises()
    expect(memoryClient.search).toHaveBeenLastCalledWith('deepchat', 'redis')
    expect(wrapper.text()).toContain('redis search fact')

    await wrapper.find('[data-testid="memory-row-archive"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('redis search fact')
  })

  it('updates the local archived row when restore succeeds and reports false restore results', async () => {
    const archived = memory({ status: 'archived' })
    const { wrapper, memoryClient, toast } = await setup({ rows: [archived] })

    await wrapper.find('input[type="checkbox"]').setChecked(true)
    await flushPromises()
    await wrapper.find('[data-testid="memory-row-restore"]').trigger('click')
    await flushPromises()

    expect(memoryClient.restore).toHaveBeenCalledWith('deepchat', 'm1')
    expect(wrapper.find('[data-testid="memory-row-archive"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="memory-row-restore"]').exists()).toBe(false)

    memoryClient.list.mockResolvedValueOnce([archived])
    await wrapper.setProps({ refreshToken: 1 })
    await flushPromises()
    memoryClient.restore.mockResolvedValueOnce(false)

    await wrapper.find('[data-testid="memory-row-restore"]').trigger('click')
    await flushPromises()

    expect(toast).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="memory-row-restore"]').exists()).toBe(true)
  })

  it('routes openCreate through the dirty-prompt guard instead of discarding unsaved edits', async () => {
    const { wrapper } = await setup()

    await wrapper.find('[role="button"]').trigger('click')
    await flushPromises()
    const panel = wrapper.findComponent({ name: 'MemoryInlinePanel' })
    expect(panel.props('mode')).toBe('view')

    panel.vm.$emit('dirty', true)
    await flushPromises()

    const addButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('addMemory'))
    expect(addButton).toBeTruthy()
    await addButton!.trigger('click')
    await flushPromises()

    // Unsaved edits must not be silently discarded: mode stays on the
    // dirty memory and the discard prompt is surfaced instead.
    expect(panel.props('mode')).toBe('view')
    expect(panel.props('memory')?.id).toBe('m1')
    expect(panel.props('discardPrompt')).toBe(true)

    panel.vm.$emit('discard-pending')
    await flushPromises()

    const createPanel = wrapper.findComponent({ name: 'MemoryInlinePanel' })
    expect(createPanel.props('mode')).toBe('create')
    expect(createPanel.props('memory')).toBeFalsy()
    expect(createPanel.props('discardPrompt')).toBe(false)
  })

  it('keeps only one inline panel open while switching rows', async () => {
    const { wrapper } = await setup({
      rows: [memory({ id: 'm1', content: 'first' }), memory({ id: 'm2', content: 'second' })]
    })

    await wrapper.findAll('[role="button"]')[0].trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="inline-panel"]').attributes('data-memory-id')).toBe('m1')

    await wrapper.findAll('[role="button"]')[1].trigger('click')
    await flushPromises()
    const panels = wrapper.findAll('[data-testid="inline-panel"]')
    expect(panels).toHaveLength(1)
    expect(panels[0].attributes('data-memory-id')).toBe('m2')
  })

  it('clears the stale unsaved-changes prompt once the panel stops being dirty', async () => {
    const { wrapper } = await setup()

    await wrapper.find('[role="button"]').trigger('click')
    await flushPromises()
    const panel = wrapper.findComponent({ name: 'MemoryInlinePanel' })

    panel.vm.$emit('dirty', true)
    await flushPromises()
    panel.vm.$emit('close')
    await flushPromises()
    expect(panel.props('discardPrompt')).toBe(true)

    // An in-flight save completes after the user already clicked close.
    panel.vm.$emit('dirty', false)
    await flushPromises()
    const refreshedPanel = wrapper.findComponent({ name: 'MemoryInlinePanel' })
    expect(refreshedPanel.props('discardPrompt')).toBe(false)
  })

  it('keeps an expanded memory across refresh and closes it when the row disappears', async () => {
    const { wrapper, memoryClient } = await setup({ rows: [memory()] })

    await wrapper.find('[role="button"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="inline-panel"]').attributes('data-memory-id')).toBe('m1')

    memoryClient.list.mockResolvedValueOnce([memory({ id: 'm1', content: 'updated' })])
    await wrapper.setProps({ refreshToken: 1 })
    await flushPromises()
    expect(wrapper.find('[data-testid="inline-panel"]').attributes('data-memory-id')).toBe('m1')

    memoryClient.list.mockResolvedValueOnce([])
    await wrapper.setProps({ refreshToken: 2 })
    await flushPromises()
    expect(wrapper.find('[data-testid="inline-panel"]').exists()).toBe(false)
  })

  it('selects the saved memory and scrolls the inline panel into view', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const replacement = memory({ id: 'm2', content: 'replacement' })
    const { wrapper } = await setup({ rows: [memory()] })

    await wrapper.find('[role="button"]').trigger('click')
    await flushPromises()
    wrapper.findComponent({ name: 'MemoryInlinePanel' }).vm.$emit('saved', replacement)
    await flushPromises()

    expect(wrapper.find('[data-testid="inline-panel"]').attributes('data-memory-id')).toBe('m2')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('shows archived local substring matches in their own group while search is active', async () => {
    vi.useFakeTimers()
    const archived = memory({
      id: 'archived',
      content: 'archived redis fact',
      status: 'archived',
      createdAt: 1700000001000
    })
    const { wrapper, memoryClient } = await setup({
      rows: [memory(), archived],
      searchRows: []
    })

    await wrapper.find('input[type="checkbox"]').setChecked(true)
    await wrapper.find('input[type="search"]').setValue('archived')
    vi.advanceTimersByTime(200)
    await flushPromises()

    expect(memoryClient.search).toHaveBeenLastCalledWith('deepchat', 'archived')
    expect(wrapper.text()).toContain('settings.memory.redesign.archivedMatches')
    expect(wrapper.text()).toContain('archived redis fact')
  })
})
