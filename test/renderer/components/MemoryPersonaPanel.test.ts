import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { MemoryCommandResult, MemoryItem } from '../../../src/shared/contracts/routes'

const passthrough = (name: string) => defineComponent({ name, template: '<div><slot /></div>' })

const ButtonStub = defineComponent({
  name: 'Button',
  props: { disabled: { type: Boolean, default: false } },
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const AlertDialogStub = defineComponent({
  name: 'AlertDialog',
  props: { open: { type: Boolean, default: false } },
  template: '<div v-if="open"><slot /></div>'
})

const stubs = {
  AlertDialog: AlertDialogStub,
  AlertDialogAction: ButtonStub,
  AlertDialogAsyncAction: ButtonStub,
  AlertDialogCancel: ButtonStub,
  AlertDialogContent: passthrough('AlertDialogContent'),
  AlertDialogDescription: passthrough('AlertDialogDescription'),
  AlertDialogFooter: passthrough('AlertDialogFooter'),
  AlertDialogHeader: passthrough('AlertDialogHeader'),
  AlertDialogTitle: passthrough('AlertDialogTitle'),
  AlertDialogTrigger: passthrough('AlertDialogTrigger'),
  Badge: passthrough('Badge'),
  DcButton: ButtonStub,
  Icon: passthrough('Icon'),
  ScrollArea: passthrough('ScrollArea'),
  Spinner: passthrough('Spinner')
}

function persona(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 'persona-active',
    agentId: 'deepchat',
    kind: 'persona',
    category: null,
    content: 'Active persona',
    importance: 1,
    status: 'embedded',
    sourceSession: null,
    sourceEntryIds: null,
    supersededBy: null,
    createdAt: 1700000000000,
    personaState: 'active',
    isAnchor: false,
    ...overrides
  }
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

async function setup() {
  vi.resetModules()
  const memoryClient = {
    listPersonaVersions: vi.fn().mockResolvedValue([
      persona(),
      persona({
        id: 'persona-old',
        content: 'Previous persona',
        personaState: 'superseded',
        supersededBy: 'persona-active'
      })
    ]),
    rollbackPersona: vi.fn().mockResolvedValue({ action: 'applied' }),
    setPersonaAnchor: vi.fn().mockResolvedValue({ action: 'applied' })
  }
  vi.doMock('@api/MemoryClient', () => ({ createMemoryClient: () => memoryClient }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({ t: (key: string) => key, locale: 'en-US' })
  }))
  vi.doMock('@iconify/vue', () => ({ Icon: passthrough('Icon') }))

  const Component = (
    await import('../../../src/renderer/settings/components/MemoryPersonaPanel.vue')
  ).default
  const wrapper = mount(Component, {
    props: {
      agentId: 'deepchat',
      personaEvolutionEnabled: true,
      refreshToken: 0
    },
    global: { stubs }
  })
  await flushPromises()
  return { wrapper, memoryClient }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MemoryPersonaPanel', () => {
  it('keeps rollback progress and failures inside the confirmation until retry succeeds', async () => {
    const pending = deferred<MemoryCommandResult>()
    const { wrapper, memoryClient } = await setup()
    memoryClient.rollbackPersona.mockReturnValueOnce(pending.promise)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await wrapper.get('[data-testid="memory-persona-rollback-trigger"]').trigger('click')
    await wrapper.get('[data-testid="memory-persona-rollback-confirm"]').trigger('click')
    await flushPromises()

    expect(
      wrapper.get('[data-testid="memory-persona-rollback-confirm"]').attributes('disabled')
    ).toBeDefined()
    expect(
      wrapper.get('[data-testid="memory-persona-rollback-cancel"]').attributes('disabled')
    ).toBeDefined()
    expect(wrapper.find('[data-testid="memory-persona-rollback-spinner"]').exists()).toBe(true)

    pending.reject(new Error('secret rollback failure'))
    await flushPromises()

    expect(wrapper.find('[data-testid="memory-persona-rollback-confirm"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="memory-inline-feedback"]').text()).toContain(
      'settings.deepchatAgents.memoryManager.actionFailed'
    )

    await wrapper.get('[data-testid="memory-persona-rollback-confirm"]').trigger('click')
    await flushPromises()

    expect(memoryClient.rollbackPersona).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="memory-persona-rollback-confirm"]').exists()).toBe(false)
    consoleError.mockRestore()
  })

  it('explains an anchored rollback rejection without dismissing its target', async () => {
    const { wrapper, memoryClient } = await setup()
    memoryClient.rollbackPersona.mockResolvedValueOnce({
      action: 'rejected',
      reason: 'anchored'
    })
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await wrapper.get('[data-testid="memory-persona-rollback-trigger"]').trigger('click')
    await wrapper.get('[data-testid="memory-persona-rollback-confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="memory-persona-rollback-confirm"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="memory-inline-feedback"]').text()).toContain(
      'settings.deepchatAgents.memoryManager.commandRejected.anchored'
    )
    consoleWarn.mockRestore()
  })

  it('closes and reloads after a stale rollback rejection', async () => {
    const { wrapper, memoryClient } = await setup()
    memoryClient.rollbackPersona.mockResolvedValueOnce({
      action: 'rejected',
      reason: 'stale'
    })
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await wrapper.get('[data-testid="memory-persona-rollback-trigger"]').trigger('click')
    await wrapper.get('[data-testid="memory-persona-rollback-confirm"]').trigger('click')
    await flushPromises()

    expect(memoryClient.listPersonaVersions).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="memory-persona-rollback-confirm"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="memory-inline-feedback"]').text()).toContain(
      'settings.deepchatAgents.memoryManager.commandRejected.stale'
    )
    consoleWarn.mockRestore()
  })

  it('prevents duplicate anchor commands while the first request is pending', async () => {
    const pending = deferred<MemoryCommandResult>()
    const { wrapper, memoryClient } = await setup()
    memoryClient.setPersonaAnchor.mockReturnValueOnce(pending.promise)
    const anchor = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.deepchatAgents.memoryManager.anchor'))!

    await anchor.trigger('click')
    await flushPromises()
    await anchor.trigger('click')

    expect(memoryClient.setPersonaAnchor).toHaveBeenCalledOnce()
    expect(anchor.attributes('disabled')).toBeDefined()

    pending.resolve({ action: 'applied' })
    await flushPromises()
    expect(anchor.attributes('disabled')).toBeUndefined()
  })

  it('keeps mutation errors inline without exposing backend exception text', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { wrapper, memoryClient } = await setup()
    memoryClient.setPersonaAnchor.mockRejectedValueOnce(new Error('secret persona failure'))
    const anchor = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.deepchatAgents.memoryManager.anchor'))!

    await anchor.trigger('click')
    await flushPromises()

    const feedback = wrapper.get('[data-testid="memory-inline-feedback"]')
    expect(feedback.attributes('data-tone')).toBe('error')
    expect(feedback.text()).toContain('settings.deepchatAgents.memoryManager.actionFailed')
    expect(feedback.text()).not.toContain('secret persona failure')
    expect(consoleError).toHaveBeenCalledWith(
      '[MemoryPersonaPanel] Action failed',
      expect.any(Error)
    )
  })

  it('shows inline feedback when a persona command is rejected without throwing', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { wrapper, memoryClient } = await setup()
    memoryClient.setPersonaAnchor.mockResolvedValueOnce({
      action: 'rejected',
      reason: 'stale'
    })
    const anchor = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.deepchatAgents.memoryManager.anchor'))!

    await anchor.trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="memory-inline-feedback"]').attributes('data-tone')).toBe(
      'error'
    )
    expect(consoleWarn).toHaveBeenCalledWith('[MemoryPersonaPanel] Command rejected', {
      reason: 'stale'
    })
  })
})
