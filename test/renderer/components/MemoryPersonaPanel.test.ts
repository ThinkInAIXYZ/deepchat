import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { MemoryItem } from '../../../src/shared/contracts/routes'

const passthrough = (name: string) => defineComponent({ name, template: '<div><slot /></div>' })

const ButtonStub = defineComponent({
  name: 'Button',
  props: { disabled: { type: Boolean, default: false } },
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const stubs = {
  AlertDialog: passthrough('AlertDialog'),
  AlertDialogAction: ButtonStub,
  AlertDialogCancel: ButtonStub,
  AlertDialogContent: passthrough('AlertDialogContent'),
  AlertDialogDescription: passthrough('AlertDialogDescription'),
  AlertDialogFooter: passthrough('AlertDialogFooter'),
  AlertDialogHeader: passthrough('AlertDialogHeader'),
  AlertDialogTitle: passthrough('AlertDialogTitle'),
  AlertDialogTrigger: passthrough('AlertDialogTrigger'),
  Badge: passthrough('Badge'),
  Button: ButtonStub,
  Icon: passthrough('Icon'),
  ScrollArea: passthrough('ScrollArea')
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
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
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
    rollbackPersona: vi.fn().mockResolvedValue(undefined),
    setPersonaAnchor: vi.fn().mockResolvedValue(undefined)
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
  it('prevents duplicate anchor commands while the first request is pending', async () => {
    const pending = deferred<void>()
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

    pending.resolve()
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
})
