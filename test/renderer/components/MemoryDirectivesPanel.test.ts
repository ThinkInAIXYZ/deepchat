import { describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type {
  MemoryCommandResult,
  MemoryDirectiveCommandResult,
  MemoryDirectiveItem
} from '../../../src/shared/contracts/routes'
import {
  AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT,
  AGENT_MEMORY_DIRECTIVE_CONTENT_MAX_CHARS,
  AGENT_MEMORY_DIRECTIVE_TOPIC_MAX_CHARS
} from '../../../src/shared/types/agent-memory'

const passthrough = (name: string, tag = 'div') =>
  defineComponent({ name, template: `<${tag}><slot /></${tag}>` })

const modelStub = (name: string, tag = 'div') =>
  defineComponent({
    name,
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: tag === 'input' ? '<input />' : `<${tag}><slot /></${tag}>`
  })

const AlertDialogStub = defineComponent({
  name: 'AlertDialog',
  props: { open: { type: Boolean, default: false } },
  template: '<div v-if="open"><slot /></div>'
})

const stubs = {
  AlertDialog: AlertDialogStub,
  AlertDialogAction: passthrough('AlertDialogAction', 'button'),
  AlertDialogAsyncAction: passthrough('AlertDialogAsyncAction', 'button'),
  AlertDialogCancel: passthrough('AlertDialogCancel', 'button'),
  AlertDialogContent: passthrough('AlertDialogContent'),
  AlertDialogDescription: passthrough('AlertDialogDescription'),
  AlertDialogFooter: passthrough('AlertDialogFooter'),
  AlertDialogHeader: passthrough('AlertDialogHeader'),
  AlertDialogTitle: passthrough('AlertDialogTitle'),
  AlertDialogTrigger: passthrough('AlertDialogTrigger'),
  Badge: passthrough('Badge'),
  DcButton: defineComponent({
    name: 'Button',
    inheritAttrs: false,
    template: '<button v-bind="$attrs"><slot /></button>'
  }),
  Empty: passthrough('Empty'),
  EmptyDescription: passthrough('EmptyDescription'),
  EmptyHeader: passthrough('EmptyHeader'),
  EmptyMedia: passthrough('EmptyMedia'),
  EmptyTitle: passthrough('EmptyTitle'),
  Icon: passthrough('Icon'),
  Input: modelStub('Input', 'input'),
  ScrollArea: passthrough('ScrollArea'),
  Select: modelStub('Select'),
  SelectContent: passthrough('SelectContent'),
  SelectItem: passthrough('SelectItem'),
  SelectTrigger: passthrough('SelectTrigger'),
  SelectValue: passthrough('SelectValue'),
  Spinner: passthrough('Spinner'),
  Textarea: modelStub('Textarea', 'textarea')
}

function directive(
  id: string,
  status: MemoryDirectiveItem['status'] = 'active',
  overrides: Partial<MemoryDirectiveItem> = {}
): MemoryDirectiveItem {
  return {
    id,
    agentId: 'deepchat',
    kind: 'instruction',
    status,
    source: status === 'draft' ? 'derived_suggestion' : 'manual',
    content: `Directive ${id}`,
    topic: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

async function setup(initial: MemoryDirectiveItem[] = []) {
  vi.resetModules()
  const memoryClient = {
    listDirectives: vi.fn().mockResolvedValue(initial),
    createDirective: vi.fn(),
    approveDirective: vi.fn(),
    rejectDirective: vi.fn(),
    deleteDirective: vi.fn()
  }
  vi.doMock('@api/MemoryClient', () => ({ createMemoryClient: () => memoryClient }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      locale: ref('en-US'),
      t: (key: string, params?: Record<string, unknown>) =>
        params ? `${key}:${JSON.stringify(params)}` : key
    })
  }))

  const Component = (
    await import('../../../src/renderer/settings/components/MemoryDirectivesPanel.vue')
  ).default
  const wrapper = mount(Component, {
    props: { agentId: 'deepchat', memoryEnabled: true, refreshToken: 0 },
    global: { stubs }
  })
  await flushPromises()
  return { wrapper, memoryClient }
}

function buttonContaining(wrapper: Awaited<ReturnType<typeof setup>>['wrapper'], text: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().includes(text))
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
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

describe('MemoryDirectivesPanel', () => {
  it('loads and orders active, draft, and rejected directives', async () => {
    const { wrapper, memoryClient } = await setup([
      directive('rejected', 'rejected', { updatedAt: 30 }),
      directive('draft', 'draft', { updatedAt: 20 }),
      directive('active', 'active', { updatedAt: 10 })
    ])

    expect(memoryClient.listDirectives).toHaveBeenCalledWith('deepchat', { limit: 200 })
    expect(memoryClient.listDirectives).toHaveBeenCalledWith('deepchat', {
      statuses: ['active'],
      limit: AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT
    })
    expect(
      wrapper
        .findAll('li[data-testid^="memory-directive-"]')
        .map((row) => row.attributes('data-testid'))
    ).toEqual(['memory-directive-active', 'memory-directive-draft', 'memory-directive-rejected'])
  })

  it('keeps active directives visible when they are outside the recent page', async () => {
    const { wrapper, memoryClient } = await setup()
    memoryClient.listDirectives
      .mockResolvedValueOnce([directive('recent-rejected', 'rejected')])
      .mockResolvedValueOnce([directive('older-active', 'active')])

    await buttonContaining(wrapper, 'settings.memory.redesign.refresh').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="memory-directive-older-active"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="memory-directive-recent-rejected"]').exists()).toBe(true)
  })

  it('creates an explicit instruction and adds the returned active row', async () => {
    const { wrapper, memoryClient } = await setup()
    const created = directive('created', 'active', { content: 'Keep answers concise.' })
    memoryClient.createDirective.mockResolvedValue({ action: 'applied', directive: created })

    wrapper
      .findComponent({ name: 'Textarea' })
      .vm.$emit('update:modelValue', '  Keep answers concise.  ')
    await flushPromises()
    await wrapper.find('[data-testid="memory-directive-create"]').trigger('click')
    await flushPromises()

    expect(memoryClient.createDirective).toHaveBeenCalledWith('deepchat', {
      kind: 'instruction',
      content: 'Keep answers concise.'
    })
    expect(wrapper.find('[data-testid="memory-directive-created"]').text()).toContain(
      'Keep answers concise.'
    )
  })

  it('requires a topic for suppression and preserves separate topic and instruction fields', async () => {
    const { wrapper, memoryClient } = await setup()
    const created = directive('suppression', 'active', {
      kind: 'suppress_topic',
      content: 'Do not proactively mention Project X.',
      topic: 'Project X'
    })
    memoryClient.createDirective.mockResolvedValue({ action: 'applied', directive: created })

    wrapper.findComponent({ name: 'Select' }).vm.$emit('update:modelValue', 'suppress_topic')
    await flushPromises()
    wrapper
      .findComponent({ name: 'Textarea' })
      .vm.$emit('update:modelValue', 'Do not proactively mention Project X.')
    await flushPromises()
    expect(wrapper.find('[data-testid="memory-directive-create"]').attributes('disabled')).toBe('')

    wrapper.findComponent({ name: 'Input' }).vm.$emit('update:modelValue', '  Project X  ')
    await flushPromises()
    await wrapper.find('[data-testid="memory-directive-create"]').trigger('click')
    await flushPromises()

    expect(memoryClient.createDirective).toHaveBeenCalledWith('deepchat', {
      kind: 'suppress_topic',
      content: 'Do not proactively mention Project X.',
      topic: 'Project X'
    })
  })

  it('explains and rejects overbroad single-character CJK topics', async () => {
    const { wrapper } = await setup()
    const createButton = wrapper.find('[data-testid="memory-directive-create"]')

    wrapper.findComponent({ name: 'Select' }).vm.$emit('update:modelValue', 'suppress_topic')
    await flushPromises()
    wrapper
      .findComponent({ name: 'Textarea' })
      .vm.$emit('update:modelValue', 'Do not recall this topic.')
    wrapper.findComponent({ name: 'Input' }).vm.$emit('update:modelValue', '工\u200d')
    await flushPromises()

    expect(createButton.attributes('disabled')).toBe('')
    expect(wrapper.findComponent({ name: 'Input' }).attributes('aria-invalid')).toBe('true')
    expect(wrapper.find('[data-testid="memory-directive-topic-specificity"]').text()).toContain(
      'settings.memory.redesign.directiveTopicTooBroad'
    )

    wrapper.findComponent({ name: 'Input' }).vm.$emit('update:modelValue', '工作')
    await flushPromises()

    expect(createButton.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid="memory-directive-topic-specificity"]').exists()).toBe(false)
  })

  it('uses trimmed Unicode code points for content and topic limits', async () => {
    const { wrapper } = await setup()
    const createButton = wrapper.find('[data-testid="memory-directive-create"]')

    wrapper
      .findComponent({ name: 'Textarea' })
      .vm.$emit('update:modelValue', `  ${'😀'.repeat(AGENT_MEMORY_DIRECTIVE_CONTENT_MAX_CHARS)}  `)
    await flushPromises()
    expect(createButton.attributes('disabled')).toBeUndefined()

    wrapper
      .findComponent({ name: 'Textarea' })
      .vm.$emit('update:modelValue', '😀'.repeat(AGENT_MEMORY_DIRECTIVE_CONTENT_MAX_CHARS + 1))
    await flushPromises()
    expect(createButton.attributes('disabled')).toBe('')

    wrapper.findComponent({ name: 'Select' }).vm.$emit('update:modelValue', 'suppress_topic')
    wrapper
      .findComponent({ name: 'Textarea' })
      .vm.$emit('update:modelValue', 'Suppress this topic.')
    await flushPromises()
    wrapper
      .findComponent({ name: 'Input' })
      .vm.$emit('update:modelValue', ` ${'😀'.repeat(AGENT_MEMORY_DIRECTIVE_TOPIC_MAX_CHARS)} `)
    await flushPromises()
    expect(createButton.attributes('disabled')).toBeUndefined()

    wrapper
      .findComponent({ name: 'Input' })
      .vm.$emit('update:modelValue', '😀'.repeat(AGENT_MEMORY_DIRECTIVE_TOPIC_MAX_CHARS + 1))
    await flushPromises()
    expect(createButton.attributes('disabled')).toBe('')
  })

  it('does not let a stale refresh overwrite a completed create', async () => {
    const { wrapper, memoryClient } = await setup()
    const stale = deferred<MemoryDirectiveItem[]>()
    const created = directive('created', 'active', { content: 'Keep answers concise.' })
    memoryClient.listDirectives.mockReturnValueOnce(stale.promise)
    memoryClient.createDirective.mockResolvedValue({ action: 'applied', directive: created })

    await buttonContaining(wrapper, 'settings.memory.redesign.refresh').trigger('click')
    wrapper
      .findComponent({ name: 'Textarea' })
      .vm.$emit('update:modelValue', 'Keep answers concise.')
    await flushPromises()
    await wrapper.find('[data-testid="memory-directive-create"]').trigger('click')
    await flushPromises()

    stale.resolve([])
    await flushPromises()

    expect(wrapper.find('[data-testid="memory-directive-created"]').text()).toContain(
      'Keep answers concise.'
    )
  })

  it('registers a directive draft and its create request with the leave guard', async () => {
    const pending = deferred<MemoryDirectiveCommandResult>()
    const created = directive('created', 'active', { content: 'Keep answers concise.' })
    const { wrapper, memoryClient } = await setup()
    const { settingsLeaveGuard } =
      await import('../../../src/renderer/settings/services/settingsLeaveGuard')
    memoryClient.createDirective.mockReturnValueOnce(pending.promise)

    wrapper
      .findComponent({ name: 'Textarea' })
      .vm.$emit('update:modelValue', 'Keep answers concise.')
    await flushPromises()
    expect(settingsLeaveGuard.getSnapshot().risk).toBe('dirty')

    await wrapper.find('[data-testid="memory-directive-create"]').trigger('click')
    await flushPromises()
    expect(settingsLeaveGuard.getSnapshot().risk).toBe('busy')

    pending.resolve({ action: 'applied', directive: created })
    await flushPromises()
    expect(settingsLeaveGuard.getSnapshot().risk).toBe('clean')
    wrapper.unmount()
  })

  it('approves drafts and deletes directives without waiting for a reload', async () => {
    const draft = directive('draft', 'draft')
    const active = { ...draft, status: 'active' as const, updatedAt: 2 }
    const { wrapper, memoryClient } = await setup([draft])
    memoryClient.approveDirective.mockResolvedValue({ action: 'applied', directive: active })
    memoryClient.deleteDirective.mockResolvedValue({ action: 'applied' })

    await buttonContaining(wrapper, 'settings.deepchatAgents.memoryManager.approve').trigger(
      'click'
    )
    await flushPromises()
    expect(memoryClient.approveDirective).toHaveBeenCalledWith('deepchat', 'draft')
    expect(wrapper.find('[data-testid="memory-directive-draft"]').text()).toContain(
      'settings.memory.redesign.directiveStatus.active'
    )

    await wrapper.get('[data-testid="memory-directive-delete-trigger"]').trigger('click')
    await wrapper.get('[data-testid="memory-directive-delete-confirm"]').trigger('click')
    await flushPromises()
    expect(memoryClient.deleteDirective).toHaveBeenCalledWith('deepchat', 'draft')
    expect(wrapper.find('[data-testid="memory-directive-draft"]').exists()).toBe(false)
  })

  it('keeps directive deletion pending and failure feedback inside its confirmation', async () => {
    const pending = deferred<MemoryCommandResult>()
    const { wrapper, memoryClient } = await setup([directive('active')])
    memoryClient.deleteDirective.mockReturnValueOnce(pending.promise)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await wrapper.get('[data-testid="memory-directive-delete-trigger"]').trigger('click')
    await wrapper.get('[data-testid="memory-directive-delete-confirm"]').trigger('click')
    await flushPromises()

    expect(
      wrapper.get('[data-testid="memory-directive-delete-confirm"]').attributes('disabled')
    ).toBeDefined()
    expect(
      wrapper.get('[data-testid="memory-directive-delete-cancel"]').attributes('disabled')
    ).toBeDefined()
    expect(wrapper.find('[data-testid="memory-directive-delete-spinner"]').exists()).toBe(true)

    pending.reject(new Error('secret directive failure'))
    await flushPromises()

    const feedback = wrapper.get('[data-testid="memory-inline-feedback"]')
    expect(feedback.attributes('data-tone')).toBe('error')
    expect(feedback.text()).toContain('settings.deepchatAgents.memoryManager.actionFailed')
    expect(wrapper.find('[data-testid="memory-directive-delete-confirm"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="memory-directive-active"]').exists()).toBe(true)

    memoryClient.deleteDirective.mockResolvedValueOnce({ action: 'applied' })
    await wrapper.get('[data-testid="memory-directive-delete-confirm"]').trigger('click')
    await flushPromises()

    expect(memoryClient.deleteDirective).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="memory-directive-delete-confirm"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="memory-directive-active"]').exists()).toBe(false)
    consoleError.mockRestore()
  })

  it('reconciles the directive list after a not-found deletion result', async () => {
    const { wrapper, memoryClient } = await setup([directive('stale')])
    memoryClient.deleteDirective.mockResolvedValueOnce({
      action: 'rejected',
      reason: 'not-found'
    })
    memoryClient.listDirectives.mockResolvedValue([])
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await wrapper.get('[data-testid="memory-directive-delete-trigger"]').trigger('click')
    await wrapper.get('[data-testid="memory-directive-delete-confirm"]').trigger('click')
    await flushPromises()

    expect(memoryClient.listDirectives).toHaveBeenCalledTimes(4)
    expect(wrapper.find('[data-testid="memory-directive-stale"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="memory-directive-delete-confirm"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="memory-inline-feedback"]').text()).toContain(
      'settings.deepchatAgents.memoryManager.commandRejected.notFound'
    )
    consoleWarn.mockRestore()
  })

  it('rejects a draft without activating it', async () => {
    const draft = directive('draft', 'draft')
    const rejected = { ...draft, status: 'rejected' as const, updatedAt: 2 }
    const { wrapper, memoryClient } = await setup([draft])
    memoryClient.rejectDirective.mockResolvedValue({
      action: 'applied',
      directive: rejected
    })

    await buttonContaining(wrapper, 'settings.deepchatAgents.memoryManager.reject').trigger('click')
    await flushPromises()

    expect(memoryClient.rejectDirective).toHaveBeenCalledWith('deepchat', 'draft')
    expect(wrapper.find('[data-testid="memory-directive-draft"]').text()).toContain(
      'settings.memory.redesign.directiveStatus.rejected'
    )
    expect(memoryClient.approveDirective).not.toHaveBeenCalled()
  })

  it('keeps a draft visible and explains an unavailable rejection', async () => {
    const draft = directive('draft', 'draft')
    const { wrapper, memoryClient } = await setup([draft])
    const listCallCount = memoryClient.listDirectives.mock.calls.length
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    memoryClient.rejectDirective.mockResolvedValue({
      action: 'rejected',
      directive: null,
      reason: 'unavailable'
    })

    await buttonContaining(wrapper, 'settings.deepchatAgents.memoryManager.reject').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="memory-directive-draft"]').text()).toContain(
      'settings.memory.redesign.directiveStatus.draft'
    )
    expect(wrapper.get('[data-testid="memory-inline-feedback"]').text()).toContain(
      'settings.deepchatAgents.memoryManager.commandRejected.unavailable'
    )
    expect(memoryClient.listDirectives).toHaveBeenCalledTimes(listCallCount)
    consoleWarn.mockRestore()
  })

  it('explains active-capacity rejection for create and approval', async () => {
    const draft = directive('draft', 'draft')
    const { wrapper, memoryClient } = await setup([draft])
    memoryClient.createDirective.mockResolvedValue({
      action: 'rejected',
      directive: null,
      reason: 'capacity'
    })
    memoryClient.approveDirective.mockResolvedValue({
      action: 'rejected',
      directive: null,
      reason: 'capacity'
    })

    wrapper
      .findComponent({ name: 'Textarea' })
      .vm.$emit('update:modelValue', 'Keep answers concise.')
    await flushPromises()
    await wrapper.find('[data-testid="memory-directive-create"]').trigger('click')
    await flushPromises()
    await buttonContaining(wrapper, 'settings.deepchatAgents.memoryManager.approve').trigger(
      'click'
    )
    await flushPromises()

    expect(wrapper.find('[data-testid="memory-directive-draft"]').text()).toContain(
      'settings.memory.redesign.directiveStatus.draft'
    )
    expect(memoryClient.createDirective).toHaveBeenCalledOnce()
    expect(memoryClient.approveDirective).toHaveBeenCalledOnce()
    const feedback = wrapper.get('[data-testid="memory-inline-feedback"]')
    expect(feedback.attributes('data-tone')).toBe('error')
    expect(feedback.text()).toContain('settings.memory.redesign.directiveCapacityTitle')
    expect(feedback.text()).toContain(String(AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT))
  })
})
