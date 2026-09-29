import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { MemoryItem, MemoryLineagePage } from '../../../src/shared/contracts/routes'

const ButtonStub = defineComponent({
  props: { disabled: { type: Boolean, default: false } },
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
})
const CollapsibleStub = defineComponent({
  props: { open: { type: Boolean, default: false } },
  emits: ['update:open'],
  template: '<div><slot /></div>'
})
const CollapsibleTriggerStub = defineComponent({
  emits: ['click'],
  template:
    '<button v-bind="$attrs" @click="$parent.$emit(\'update:open\', true)"><slot /></button>'
})
const passthrough = (name: string) => defineComponent({ name, template: '<div><slot /></div>' })

function memory(id: string, content: string): MemoryItem {
  return {
    id,
    agentId: 'deepchat',
    kind: 'semantic',
    category: null,
    content,
    importance: 0.5,
    status: 'embedded',
    sourceSession: 'private-session',
    sourceEntryIds: [654321],
    supersededBy: null,
    createdAt: 1700000000000,
    temporalKind: 'atemporal',
    validFrom: null,
    validUntil: null,
    temporalConfidence: null,
    temporalPrecision: null,
    temporalTimeZone: null
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => (resolve = next))
  return { promise, resolve }
}

async function setup(getLineage: ReturnType<typeof vi.fn>) {
  vi.resetModules()
  vi.doMock('@api/MemoryClient', () => ({ createMemoryClient: () => ({ getLineage }) }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({ t: (key: string) => key, locale: 'en-US' })
  }))
  vi.doMock('@iconify/vue', () => ({ Icon: passthrough('Icon') }))
  const Component = (
    await import('../../../src/renderer/settings/components/MemoryLineageSection.vue')
  ).default
  const wrapper = mount(Component, {
    props: { agentId: 'deepchat', memoryId: 'root', direction: 'parents' },
    global: {
      stubs: {
        DcButton: ButtonStub,
        Collapsible: CollapsibleStub,
        CollapsibleTrigger: CollapsibleTriggerStub,
        CollapsibleContent: passthrough('CollapsibleContent'),
        Icon: passthrough('Icon')
      }
    }
  })
  await wrapper.get('[data-testid="memory-lineage-parents-trigger"]').trigger('click')
  await flushPromises()
  return wrapper
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('MemoryLineageSection', () => {
  it('pages related claims, opens visible current content, and never exposes source identifiers', async () => {
    const related = memory('parent-1', 'current related claim')
    const cursor = { createdAt: 2, memoryId: 'parent-1', derivationKind: 'reflection' as const }
    const getLineage = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          { memoryId: related.id, derivationKind: 'reflection', createdAt: 1, memory: related }
        ],
        nextCursor: cursor
      } satisfies MemoryLineagePage)
      .mockResolvedValueOnce({
        items: [{ memoryId: 'missing', derivationKind: 'merge', createdAt: 2, memory: null }],
        nextCursor: null
      } satisfies MemoryLineagePage)
    const wrapper = await setup(getLineage)

    expect(wrapper.text()).toContain('current related claim')
    expect(wrapper.text()).toContain('settings.memory.redesign.lineageCurrentContent')
    expect(wrapper.text()).not.toContain('private-session')
    expect(wrapper.text()).not.toContain('654321')
    await wrapper.get('[data-testid="memory-lineage-open-parent-1"]').trigger('click')
    expect(wrapper.emitted('open-memory')?.[0]).toEqual([related])

    await wrapper.findAll('button').at(-1)!.trigger('click')
    await flushPromises()
    expect(getLineage).toHaveBeenLastCalledWith('deepchat', 'root', 'parents', { cursor })
    expect(wrapper.text()).toContain('settings.memory.redesign.relatedMemoryUnavailable')
    expect(wrapper.find('[data-testid="memory-lineage-open-missing"]').exists()).toBe(false)
  })

  it('invalidates visible content and pending pages on refresh of the same root', async () => {
    const related = memory('parent-1', 'deleted claim')
    const delayed = deferred<MemoryLineagePage | null>()
    const page: MemoryLineagePage = {
      items: [
        { memoryId: related.id, derivationKind: 'reflection', createdAt: 1, memory: related }
      ],
      nextCursor: { createdAt: 1, memoryId: related.id, derivationKind: 'reflection' }
    }
    const getLineage = vi
      .fn()
      .mockResolvedValueOnce(page)
      .mockReturnValueOnce(delayed.promise)
      .mockResolvedValueOnce({
        items: [{ ...page.items[0], memory: null }],
        nextCursor: null
      })
    const wrapper = await setup(getLineage)
    await wrapper.findAll('button').at(-1)!.trigger('click')
    await wrapper.setProps({ refreshToken: 1 })
    await flushPromises()
    expect(getLineage).toHaveBeenLastCalledWith('deepchat', 'root', 'parents', { cursor: null })
    expect(wrapper.text()).not.toContain('deleted claim')
    expect(wrapper.find('[data-testid="memory-lineage-open-parent-1"]').exists()).toBe(false)
    delayed.resolve(page)
    await flushPromises()
    expect(wrapper.text()).not.toContain('deleted claim')
    expect(wrapper.text()).toContain('settings.memory.redesign.relatedMemoryUnavailable')
  })

  it('shows unavailable roots and fences delayed responses after a memory change', async () => {
    const stale = deferred<MemoryLineagePage | null>()
    const getLineage = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValueOnce(null)
    const wrapper = await setup(getLineage)

    await wrapper.setProps({ memoryId: 'next' })
    await wrapper.get('[data-testid="memory-lineage-parents-trigger"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('settings.memory.redesign.lineageUnavailable')

    stale.resolve({
      items: [
        {
          memoryId: 'stale',
          derivationKind: 'reflection',
          createdAt: 1,
          memory: memory('stale', 'stale claim')
        }
      ],
      nextCursor: null
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('stale claim')
  })
})
