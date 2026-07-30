import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { MemoryItem, MemorySourceSpan } from '../../../src/shared/contracts/routes'

const passthrough = (name: string) => defineComponent({ name, template: '<div><slot /></div>' })

const ButtonStub = defineComponent({
  name: 'Button',
  props: { disabled: { type: Boolean, default: false } },
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const TextareaStub = defineComponent({
  name: 'Textarea',
  props: { modelValue: { type: String, default: '' }, disabled: { type: Boolean, default: false } },
  emits: ['update:modelValue'],
  template:
    '<textarea v-bind="$attrs" :disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
})

const SelectStub = defineComponent({
  name: 'Select',
  props: ['modelValue', 'disabled'],
  emits: ['update:modelValue'],
  template: '<div><slot /></div>'
})

const DialogStub = defineComponent({
  name: 'AlertDialog',
  props: { open: { type: Boolean, default: false } },
  emits: ['update:open'],
  template: '<div><slot /></div>'
})

const CollapsibleStub = defineComponent({
  name: 'Collapsible',
  props: { open: { type: Boolean, default: false } },
  emits: ['update:open'],
  template: '<div><slot /></div>'
})

const stubs = {
  Button: ButtonStub,
  Textarea: TextareaStub,
  Select: SelectStub,
  SelectContent: passthrough('SelectContent'),
  SelectItem: passthrough('SelectItem'),
  SelectTrigger: passthrough('SelectTrigger'),
  SelectValue: passthrough('SelectValue'),
  Collapsible: CollapsibleStub,
  CollapsibleContent: passthrough('CollapsibleContent'),
  CollapsibleTrigger: passthrough('CollapsibleTrigger'),
  AlertDialog: DialogStub,
  AlertDialogAction: ButtonStub,
  AlertDialogCancel: ButtonStub,
  AlertDialogContent: passthrough('AlertDialogContent'),
  AlertDialogDescription: passthrough('AlertDialogDescription'),
  AlertDialogFooter: passthrough('AlertDialogFooter'),
  AlertDialogHeader: passthrough('AlertDialogHeader'),
  AlertDialogTitle: passthrough('AlertDialogTitle'),
  AlertDialogTrigger: passthrough('AlertDialogTrigger'),
  MemoryLifecyclePanel: passthrough('MemoryLifecyclePanel'),
  Spinner: passthrough('Spinner'),
  Icon: passthrough('Icon')
}

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
    importance: 0.42,
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
    item?: MemoryItem | null
    mode?: 'view' | 'edit' | 'create'
    sourceSpans?: Array<Promise<MemorySourceSpan>>
    discardPrompt?: boolean
  } = {}
) {
  vi.resetModules()
  const memoryClient = {
    add: vi.fn().mockResolvedValue({ action: 'created', memoryId: 'created' }),
    update: vi.fn().mockResolvedValue({ action: 'updated', memoryId: options.item?.id ?? 'm1' }),
    getByIds: vi.fn().mockResolvedValue([]),
    archive: vi.fn().mockResolvedValue(true),
    restore: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true),
    getSourceSpan: vi.fn(),
    getLifecycle: vi.fn().mockResolvedValue(null)
  }
  for (const span of options.sourceSpans ?? []) {
    memoryClient.getSourceSpan.mockReturnValueOnce(span)
  }
  vi.doMock('@api/MemoryClient', () => ({ createMemoryClient: () => memoryClient }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({ t: (key: string) => key, locale: 'en-US' })
  }))
  vi.doMock('@iconify/vue', () => ({ Icon: passthrough('Icon') }))

  const MemoryInlinePanel = (
    await import('../../../src/renderer/settings/components/MemoryInlinePanel.vue')
  ).default
  const wrapper = mount(MemoryInlinePanel, {
    props: {
      agentId: 'deepchat',
      memory: options.item === undefined ? memory() : options.item,
      mode: options.mode ?? 'edit',
      discardPrompt: options.discardPrompt ?? false
    },
    global: { stubs }
  })
  await flushPromises()
  return { wrapper, memoryClient }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('MemoryInlinePanel', () => {
  it('renders view mode as read-only details and does not become dirty', async () => {
    const { wrapper } = await setup({ mode: 'view' })

    expect(wrapper.find('[data-testid="memory-inline-content"]').text()).toContain(
      'user likes redis'
    )
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.emitted('dirty')?.at(-1)).toEqual([false])
    expect(wrapper.find('[data-testid="memory-inline-edit"]').exists()).toBe(true)

    wrapper.unmount()
  })

  it('does not mark precise non-quantized importance dirty until the control is touched', async () => {
    const { wrapper } = await setup()

    expect(wrapper.emitted('dirty')?.at(-1)).toEqual([false])
    wrapper.unmount()
  })

  it('does not submit quantized importance when only content was edited', async () => {
    const { wrapper, memoryClient } = await setup()

    await wrapper.find('textarea').setValue('user likes valkey')
    await flushPromises()
    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'common.save')
    await saveButton!.trigger('click')
    await flushPromises()

    expect(memoryClient.update).toHaveBeenCalledTimes(1)
    const patch = memoryClient.update.mock.calls[0][2]
    expect(patch).toEqual({ content: 'user likes valkey', category: null })
    expect('importance' in patch).toBe(false)
    wrapper.unmount()
  })

  it('keeps save progress visible and locks the editor until persistence settles', async () => {
    const pending = deferred<{ action: 'updated'; memoryId: string }>()
    const { wrapper, memoryClient } = await setup()
    memoryClient.update.mockReturnValueOnce(pending.promise)

    await wrapper.find('textarea').setValue('user likes valkey')
    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'common.save')!
    await saveButton.trigger('click')
    await flushPromises()

    expect(saveButton.text()).toContain('common.saving')
    expect(saveButton.attributes('disabled')).toBeDefined()
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button[aria-label="common.close"]').attributes('disabled')).toBeDefined()

    pending.resolve({ action: 'updated', memoryId: 'm1' })
    await flushPromises()

    expect(wrapper.emitted('saved')).toBeDefined()
  })

  it('shows inline feedback and keeps the panel open when an edit is refused', async () => {
    const { wrapper, memoryClient } = await setup()
    memoryClient.update.mockResolvedValueOnce({ action: 'noop', reason: 'conflict' })

    await wrapper.find('textarea').setValue('user likes valkey')
    await flushPromises()
    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'common.save')
    await saveButton!.trigger('click')
    await flushPromises()

    const feedback = wrapper.get('[data-testid="memory-inline-feedback"]')
    expect(feedback.attributes('data-tone')).toBe('warning')
    expect(feedback.text()).toContain('settings.memory.redesign.editRejected')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.emitted('saved')).toBeUndefined()
    wrapper.unmount()
  })

  it.each(['superseded', 'folded'] as const)(
    'selects the returned memory after a %s update',
    async (action) => {
      const replacement = memory({ id: `${action}-memory`, content: 'replacement fact' })
      const { wrapper, memoryClient } = await setup()
      memoryClient.update.mockResolvedValueOnce({
        action,
        memoryId: replacement.id,
        supersededId: 'm1'
      })
      memoryClient.getByIds.mockResolvedValueOnce([replacement])

      await wrapper.find('textarea').setValue('replacement fact')
      await flushPromises()
      const saveButton = wrapper.findAll('button').find((button) => button.text() === 'common.save')
      await saveButton!.trigger('click')
      await flushPromises()

      expect(wrapper.emitted('saved')?.[0]).toEqual([replacement])
      wrapper.unmount()
    }
  )

  it('surfaces create outcomes without silently closing duplicates or conflicts', async () => {
    const { wrapper, memoryClient } = await setup({ item: null, mode: 'create' })
    memoryClient.add.mockResolvedValueOnce({ action: 'noop', reason: 'duplicate' })

    await wrapper.find('textarea').setValue('remember this')
    const addButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'settings.memory.redesign.addMemory')
    await addButton!.trigger('click')
    await flushPromises()

    const duplicateFeedback = wrapper.get('[data-testid="memory-inline-feedback"]')
    expect(duplicateFeedback.attributes('data-tone')).toBe('info')
    expect(duplicateFeedback.text()).toContain('settings.deepchatAgents.memoryManager.addDuplicate')
    expect(wrapper.emitted('saved')).toBeUndefined()

    const challenged = memory({ id: 'challenger', content: 'challenged memory' })
    memoryClient.add.mockResolvedValueOnce({ action: 'challenged', memoryId: challenged.id })
    memoryClient.getByIds.mockResolvedValueOnce([challenged])
    await addButton!.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('feedback')?.[0]).toEqual([
      {
        tone: 'warning',
        title: 'settings.deepchatAgents.memoryManager.addConflict'
      }
    ])
    expect(wrapper.emitted('saved')?.[0]).toEqual([challenged])
    wrapper.unmount()
  })

  it('archives from the footer and closes the inline panel on success', async () => {
    const { wrapper, memoryClient } = await setup()

    const archiveButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'settings.memory.redesign.archive')
    await archiveButton!.trigger('click')
    await flushPromises()

    expect(memoryClient.archive).toHaveBeenCalledWith('deepchat', 'm1')
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('restores from the footer and keeps the inline panel open on success', async () => {
    const { wrapper, memoryClient } = await setup({ item: memory({ status: 'archived' }) })

    const restoreButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'settings.deepchatAgents.memoryManager.restore')
    await restoreButton!.trigger('click')
    await flushPromises()

    expect(memoryClient.restore).toHaveBeenCalledWith('deepchat', 'm1')
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  it('permanently deletes from the footer and closes the inline panel on success', async () => {
    const { wrapper, memoryClient } = await setup()

    const deleteButton = wrapper
      .findAll('button')
      .find((button) =>
        button.text().includes('settings.deepchatAgents.memoryManager.deletePermanent')
      )
    await deleteButton!.trigger('click')
    await flushPromises()

    expect(memoryClient.remove).toHaveBeenCalledWith('deepchat', 'm1')
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it.each([
    ['archive', 'settings.memory.redesign.archive'],
    ['restore', 'settings.deepchatAgents.memoryManager.restore'],
    ['remove', 'settings.deepchatAgents.memoryManager.deletePermanent']
  ] as const)(
    'shows inline feedback when the footer %s action returns false',
    async (action, label) => {
      const { wrapper, memoryClient } = await setup({
        item: action === 'restore' ? memory({ status: 'archived' }) : memory()
      })
      memoryClient[action].mockResolvedValueOnce(false)

      const button = wrapper.findAll('button').find((candidate) => candidate.text().includes(label))
      await button!.trigger('click')
      await flushPromises()

      expect(wrapper.get('[data-testid="memory-inline-feedback"]').attributes('data-tone')).toBe(
        'error'
      )
      expect(wrapper.emitted('changed')).toBeUndefined()
      expect(wrapper.emitted('close')).toBeUndefined()
      wrapper.unmount()
    }
  )

  it('drops stale source responses after switching to another memory', async () => {
    const sourceA = deferred<MemorySourceSpan>()
    const sourceB = deferred<MemorySourceSpan>()
    const { wrapper } = await setup({
      item: memory({ id: 'a', sourceSession: 'session-a' }),
      sourceSpans: [sourceA.promise, sourceB.promise]
    })

    wrapper.findAllComponents({ name: 'Collapsible' })[0].vm.$emit('update:open', true)
    await flushPromises()
    await wrapper.setProps({ memory: memory({ id: 'b', sourceSession: 'session-b' }) })
    sourceA.resolve({
      sessionId: 'session-a',
      entries: [{ entryId: 1, role: 'user', content: 'stale source text', orderSeq: 1 }]
    })
    await flushPromises()

    expect(wrapper.text()).not.toContain('stale source text')

    wrapper.findAllComponents({ name: 'Collapsible' })[0].vm.$emit('update:open', true)
    sourceB.resolve({
      sessionId: 'session-b',
      entries: [{ entryId: 2, role: 'assistant', content: 'current source text', orderSeq: 2 }]
    })
    await flushPromises()

    expect(wrapper.text()).toContain('current source text')
    wrapper.unmount()
  })

  it('keeps source failures local and does not render backend exception text', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const source = deferred<MemorySourceSpan>()
    const { wrapper } = await setup({
      item: memory({ sourceSession: 'session-a' }),
      sourceSpans: [source.promise]
    })

    wrapper.findAllComponents({ name: 'Collapsible' })[0].vm.$emit('update:open', true)
    await flushPromises()
    source.reject(new Error('secret source failure'))
    await flushPromises()

    const sourceAlert = wrapper.get('[data-testid="memory-source-scroll"] [role="alert"]')
    expect(sourceAlert.text()).toContain('settings.deepchatAgents.memoryManager.actionFailed')
    expect(sourceAlert.text()).not.toContain('secret source failure')
    expect(consoleError).toHaveBeenCalledWith(
      '[MemoryInlinePanel] Failed to load source span',
      expect.any(Error)
    )
    consoleError.mockRestore()
  })

  it('keeps source and lifecycle details bounded inside the inline panel', async () => {
    const { wrapper } = await setup({ item: memory({ sourceSession: 'session-a' }) })

    expect(wrapper.find('[data-testid="memory-source-scroll"]').classes()).toContain('max-h-64')
    expect(wrapper.find('[data-testid="memory-source-scroll"]').classes()).toContain(
      'overflow-y-auto'
    )
    expect(wrapper.find('[data-testid="memory-lifecycle-scroll"]').classes()).toContain('max-h-64')
    expect(wrapper.find('[data-testid="memory-lifecycle-scroll"]').classes()).toContain(
      'overflow-y-auto'
    )
    wrapper.unmount()
  })

  it('renders the discard prompt as an inline overlay and routes its actions', async () => {
    const { wrapper } = await setup({ discardPrompt: true })

    const prompt = wrapper.find('[data-testid="memory-discard-prompt"]')
    expect(prompt.exists()).toBe(true)
    expect(prompt.classes()).toContain('absolute')

    const buttons = prompt.findAll('button')
    await buttons.find((button) => button.text() === 'common.cancel')!.trigger('click')
    await buttons
      .find((button) => button.text() === 'settings.memory.redesign.discardChanges')!
      .trigger('click')

    expect(wrapper.emitted('cancel-pending')).toHaveLength(1)
    expect(wrapper.emitted('discard-pending')).toHaveLength(1)
    wrapper.unmount()
  })

  it('cancels the discard prompt on panel Escape but ignores global Escape', async () => {
    const { wrapper } = await setup({ discardPrompt: true })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('cancel-pending')).toBeUndefined()

    await wrapper.find('[data-testid="memory-inline-panel"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('cancel-pending')).toHaveLength(1)
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  it('ignores Escape when the event was already consumed by an inner layer', async () => {
    const { wrapper } = await setup({ discardPrompt: true })

    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    event.preventDefault()
    wrapper.find('[data-testid="memory-inline-panel"]').element.dispatchEvent(event)
    await flushPromises()

    expect(wrapper.emitted('cancel-pending')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  it('reseeds a blank form when create mode is reopened after a submit', async () => {
    const { wrapper } = await setup()
    await wrapper.setProps({ mode: 'create', memory: null })
    await flushPromises()

    await wrapper.find('textarea').setValue('remember this')
    await flushPromises()
    expect(wrapper.find('textarea').element.value).toBe('remember this')

    await wrapper.setProps({ mode: 'view', memory: memory() })
    await wrapper.setProps({ mode: 'create', memory: null })
    await flushPromises()

    expect(wrapper.find('textarea').element.value).toBe('')
    wrapper.unmount()
  })

  it('does not mark trailing-whitespace content dirty on open', async () => {
    const { wrapper } = await setup({ item: memory({ content: 'user likes redis\n' }) })

    expect(wrapper.emitted('dirty')?.at(-1)).toEqual([false])
    wrapper.unmount()
  })
})
