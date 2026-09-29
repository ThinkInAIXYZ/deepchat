import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { MemoryItem } from '../../../src/shared/contracts/routes'

const ButtonStub = defineComponent({
  props: { disabled: { type: Boolean, default: false } },
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
})
const CheckboxStub = defineComponent({
  props: {
    checked: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false }
  },
  emits: ['update:checked'],
  template:
    '<button type="button" v-bind="$attrs" :disabled="disabled" @click="$emit(\'update:checked\', !checked)">{{ checked }}</button>'
})
const CollapsibleStub = defineComponent({
  props: { open: { type: Boolean, default: false } },
  emits: ['update:open'],
  template: '<div><slot /></div>'
})
const CollapsibleTriggerStub = defineComponent({
  template:
    '<button v-bind="$attrs" @click="$parent.$emit(\'update:open\', true)"><slot /></button>'
})
const passthrough = (name: string) => defineComponent({ name, template: '<div><slot /></div>' })

function memory(id: string): MemoryItem {
  return {
    id,
    agentId: 'agent',
    kind: 'reflection',
    category: null,
    content: `claim ${id}`,
    importance: 0.5,
    status: 'embedded',
    sourceSession: null,
    sourceEntryIds: [],
    supersededBy: null,
    createdAt: 1,
    temporalKind: 'atemporal',
    validFrom: null,
    validUntil: null,
    temporalConfidence: null,
    temporalPrecision: null,
    temporalTimeZone: null
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('MemoryImpactReview', () => {
  it.each(['source mutation', 'archive batch', 'unmount'])(
    'reconciles refresh and busy state after %s',
    async (operation) => {
      vi.resetModules()
      const getImpact = vi.fn().mockResolvedValue({
        items: [{ memory: memory('old'), revision: 1 }],
        nextCursor: null
      })
      let finish!: (result: { action: string }) => void
      const archiveImpact = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      vi.doMock('@api/MemoryClient', () => ({
        createMemoryClient: () => ({ getImpact, archiveImpact })
      }))
      vi.doMock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
      vi.doMock('@iconify/vue', () => ({ Icon: passthrough('Icon') }))
      const Component = (
        await import('../../../src/renderer/settings/components/MemoryImpactReview.vue')
      ).default
      const onBusy = vi.fn()
      const wrapper = mount(Component, {
        props: { agentId: 'agent', memoryId: 'source', refreshToken: 0, onBusy },
        global: {
          stubs: {
            DcButton: ButtonStub,
            Checkbox: CheckboxStub,
            Collapsible: CollapsibleStub,
            CollapsibleTrigger: CollapsibleTriggerStub,
            CollapsibleContent: passthrough('CollapsibleContent'),
            Spinner: passthrough('Spinner'),
            Icon: passthrough('Icon')
          }
        }
      })
      await wrapper.get('[data-testid="memory-impact-trigger"]').trigger('click')
      await flushPromises()
      if (operation === 'source mutation') {
        await wrapper.setProps({ disabled: true })
      } else {
        await wrapper
          .get('[aria-label="settings.memory.redesign.impactSelectItem"]')
          .trigger('click')
        await wrapper.get('[data-testid="memory-impact-archive-selected"]').trigger('click')
      }
      getImpact.mockResolvedValue({
        items: [{ memory: memory('new'), revision: 2 }],
        nextCursor: null
      })
      await wrapper.setProps({ refreshToken: 1 })
      expect(getImpact).toHaveBeenCalledTimes(1)
      if (operation === 'unmount') {
        expect(onBusy).toHaveBeenLastCalledWith(true)
        wrapper.unmount()
        expect(onBusy).toHaveBeenLastCalledWith(false)
        finish({ action: 'applied' })
        await flushPromises()
        expect(onBusy.mock.calls).toEqual([[true], [false]])
        expect(getImpact).toHaveBeenCalledTimes(1)
        expect(archiveImpact).toHaveBeenCalledTimes(1)
        return
      }
      if (operation === 'source mutation') await wrapper.setProps({ disabled: false })
      else finish({ action: 'applied' })
      await flushPromises()
      expect(wrapper.text()).toContain('claim new')
      expect(getImpact).toHaveBeenCalledTimes(2)
      expect(
        wrapper.get('[data-testid="memory-impact-archive-selected"]').attributes('disabled')
      ).toBeDefined()
      if (operation === 'archive batch') {
        expect(wrapper.get('[data-testid="memory-impact-status-old"]').text()).toContain(
          'impactStatusApplied'
        )
      }
      wrapper.unmount()
    }
  )

  it('archives only selected rows, keeps partial outcomes visible, and resets on refresh', async () => {
    vi.resetModules()
    const getImpact = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          { memory: memory('one'), revision: 1 },
          { memory: memory('two'), revision: 2 },
          { memory: memory('three'), revision: 3 },
          { memory: memory('four'), revision: 4 }
        ],
        nextCursor: null
      })
      .mockResolvedValueOnce({
        items: [{ memory: memory('four'), revision: 4 }],
        nextCursor: null
      })
      .mockResolvedValue({
        items: [
          { memory: memory('fresh'), revision: 4 },
          { memory: memory('other'), revision: 5 }
        ],
        nextCursor: null
      })
    const archiveImpact = vi
      .fn()
      .mockResolvedValueOnce({ action: 'applied' })
      .mockResolvedValueOnce({ action: 'rejected', reason: 'stale' })
      .mockRejectedValueOnce(new Error('offline'))
    vi.doMock('@api/MemoryClient', () => ({
      createMemoryClient: () => ({ getImpact, archiveImpact })
    }))
    vi.doMock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
    vi.doMock('@iconify/vue', () => ({ Icon: passthrough('Icon') }))
    const Component = (
      await import('../../../src/renderer/settings/components/MemoryImpactReview.vue')
    ).default
    const wrapper = mount(Component, {
      props: { agentId: 'agent', memoryId: 'source', refreshToken: 0 },
      global: {
        stubs: {
          DcButton: ButtonStub,
          Checkbox: CheckboxStub,
          Collapsible: CollapsibleStub,
          CollapsibleTrigger: CollapsibleTriggerStub,
          CollapsibleContent: passthrough('CollapsibleContent'),
          Spinner: passthrough('Spinner'),
          Icon: passthrough('Icon')
        }
      }
    })

    await wrapper.get('[data-testid="memory-impact-trigger"]').trigger('click')
    await flushPromises()
    const choices = wrapper.findAll('[aria-label="settings.memory.redesign.impactSelectItem"]')
    await choices[0].trigger('click')
    await choices[1].trigger('click')
    await choices[2].trigger('click')
    await wrapper.get('[data-testid="memory-impact-archive-selected"]').trigger('click')
    await flushPromises()

    expect(archiveImpact.mock.calls).toEqual([
      ['agent', 'source', 'one', 1],
      ['agent', 'source', 'two', 2],
      ['agent', 'source', 'three', 3]
    ])
    expect(wrapper.get('[data-testid="memory-impact-status-one"]').text()).toContain(
      'impactStatusApplied'
    )
    expect(wrapper.get('[data-testid="memory-impact-status-two"]').text()).toContain(
      'impactStatusRejected'
    )
    expect(wrapper.get('[data-testid="memory-impact-status-three"]').text()).toContain(
      'impactStatusNetwork'
    )
    expect(wrapper.text()).toContain('claim four')

    await wrapper.setProps({ refreshToken: 1 })
    await flushPromises()
    expect(wrapper.text()).toContain('claim fresh')
    expect(wrapper.text()).toContain('impactStatusApplied')
    await wrapper.get('[data-testid="memory-impact-refresh"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('impactStatusApplied')
    expect(
      wrapper.get('[data-testid="memory-impact-archive-selected"]').attributes('disabled')
    ).toBeDefined()

    // A scope switch must stop issuing the rest of a batch, not just hide its responses.
    let finish!: (result: { action: string }) => void
    archiveImpact.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const refreshedChoices = wrapper.findAll(
      '[aria-label="settings.memory.redesign.impactSelectItem"]'
    )
    await refreshedChoices[0].trigger('click')
    await refreshedChoices[1].trigger('click')
    await wrapper.get('[data-testid="memory-impact-archive-selected"]').trigger('click')
    await wrapper.setProps({ memoryId: 'different-source' })
    finish({ action: 'applied' })
    await flushPromises()
    expect(archiveImpact).toHaveBeenCalledTimes(4)
    expect(wrapper.text()).not.toContain('claim fresh')
    expect(wrapper.emitted('busy')?.at(-1)).toEqual([false])
  })
})
