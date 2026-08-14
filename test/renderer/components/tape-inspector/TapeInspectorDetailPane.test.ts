import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    template: '<span />'
  })
}))

vi.mock('@dc-ui/components/button', () => ({
  DcButton: defineComponent({
    name: 'DcButton',
    props: ['icon'],
    emits: ['click'],
    template: '<button :data-icon="icon" @click="$emit(\'click\')"><slot /></button>'
  })
}))

import TapeInspectorDetailPane from '@/components/tape-inspector/TapeInspectorDetailPane.vue'

const firstDetail = {
  source: 'tape' as const,
  detail: {
    record: {
      recordType: 'fact' as const,
      key: 'entry:1' as const,
      entryId: 1,
      kind: 'event' as const,
      family: 'journal' as const,
      name: 'execution/run_terminal',
      createdAt: 100,
      hashes: { payloadHash: 'a'.repeat(64), metaHash: 'b'.repeat(64) }
    },
    disclosure: 'structured' as const,
    provenance: { sourceType: 'runtime_event' as const, sourceId: 'run-1', sourceSeq: 0 },
    hashes: { payloadHash: 'a'.repeat(64), metaHash: 'b'.repeat(64) },
    sizes: { payloadBytes: 100, metaBytes: 20 },
    data: { outcome: 'completed' }
  }
}

const capabilities = {
  source: 'tape' as const,
  summary: true,
  payload: true,
  timing: true,
  provenance: true,
  integrity: false,
  raw: false,
  transcriptNavigation: false
}

describe('TapeInspectorDetailPane', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    writeText.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('copies only the projected detail and clears success when selection changes', async () => {
    const wrapper = mount(TapeInspectorDetailPane, {
      props: {
        row: null,
        detail: firstDetail,
        capabilities,
        loading: false,
        errorCode: null
      }
    })
    const copy = wrapper.get('[data-testid="tape-inspector-copy-selected"]')

    await copy.trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith(JSON.stringify(firstDetail.detail, null, 2))
    expect(copy.attributes('data-icon')).toBe('lucide:check')

    await wrapper.setProps({
      detail: {
        source: 'derived',
        group: { key: 'group:run:2', kind: 'run', runId: 'run-2' }
      }
    })

    expect(copy.attributes('data-icon')).toBe('lucide:copy')
    wrapper.unmount()
    vi.runAllTimers()
  })

  it('drops a late clipboard completion after selection changes', async () => {
    let resolveCopy!: () => void
    writeText.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveCopy = resolve
      })
    )
    const wrapper = mount(TapeInspectorDetailPane, {
      props: {
        row: null,
        detail: firstDetail,
        capabilities,
        loading: false,
        errorCode: null
      }
    })

    await wrapper.get('[data-testid="tape-inspector-copy-selected"]').trigger('click')
    await wrapper.setProps({
      detail: {
        source: 'derived',
        group: { key: 'group:run:2', kind: 'run', runId: 'run-2' }
      }
    })
    resolveCopy()
    await flushPromises()

    expect(
      wrapper.get('[data-testid="tape-inspector-copy-selected"]').attributes('data-icon')
    ).toBe('lucide:copy')
  })

  it('keeps copy failures non-fatal and does not show success', async () => {
    const error = new Error('clipboard unavailable')
    writeText.mockRejectedValueOnce(error)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const wrapper = mount(TapeInspectorDetailPane, {
      props: {
        row: null,
        detail: firstDetail,
        capabilities,
        loading: false,
        errorCode: null
      }
    })

    await wrapper.get('[data-testid="tape-inspector-copy-selected"]').trigger('click')
    await flushPromises()

    expect(consoleError).toHaveBeenCalledWith(
      '[TapeInspector] Failed to copy selected record',
      error
    )
    expect(
      wrapper.get('[data-testid="tape-inspector-copy-selected"]').attributes('data-icon')
    ).toBe('lucide:copy')
    consoleError.mockRestore()
  })
})
