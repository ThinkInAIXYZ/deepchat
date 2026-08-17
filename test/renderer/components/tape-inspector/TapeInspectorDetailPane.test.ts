import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    d: (value: Date) => value.toISOString()
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
  messageDiagnostics: false
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

  it('shows timing and sanitized raw data and opens message diagnostics', async () => {
    const wrapper = mount(TapeInspectorDetailPane, {
      props: {
        row: {
          recordType: 'fact',
          key: 'entry:1',
          record: { ...firstDetail.detail.record, messageId: 'message-1' },
          parentGroupKey: null,
          depth: 0,
          status: null,
          statusState: 'not_applicable',
          durationMs: 25,
          timingState: 'span',
          sequenceEntryId: 1,
          sequenceStart: 0,
          actualStartAt: 100,
          actualEndAt: 125,
          actualStart: 0,
          actualWidth: 1
        },
        detail: firstDetail,
        capabilities: { ...capabilities, raw: true, messageDiagnostics: true },
        loading: false,
        errorCode: null
      }
    })

    expect(wrapper.text()).toContain('tapeInspector.detail.timing')
    expect(wrapper.text()).toContain('"durationMs": 25')
    expect(wrapper.text()).toContain('tapeInspector.detail.raw')
    expect(wrapper.text()).toContain('"disclosure": "structured"')

    await wrapper.get('[data-testid="tape-inspector-open-message-diagnostics"]').trigger('click')
    expect(wrapper.emitted('openMessageDiagnostics')).toEqual([
      [{ messageId: 'message-1', requestSeq: undefined }]
    ])
  })

  it('shows the latest request context before the complete sanitized request payload', () => {
    const wrapper = mount(TapeInspectorDetailPane, {
      props: {
        row: {
          recordType: 'evidence',
          key: 'trace:trace-1',
          record: {
            recordType: 'evidence',
            key: 'trace:trace-1',
            traceId: 'trace-1',
            messageId: 'message-1',
            requestSeq: 2,
            providerId: 'provider-1',
            modelId: 'model-1',
            createdAt: 300,
            truncated: false
          },
          parentGroupKey: null,
          association: 'request',
          depth: 1,
          status: null,
          statusState: 'not_applicable',
          durationMs: null,
          timingState: 'point',
          sequenceEntryId: null,
          sequenceStart: 1,
          actualStartAt: 300,
          actualEndAt: null,
          actualStart: 1,
          actualWidth: 0
        },
        detail: {
          source: 'request',
          trace: {
            id: 'trace-1',
            messageId: 'message-1',
            sessionId: 'session-1',
            providerId: 'provider-1',
            modelId: 'model-1',
            requestSeq: 2,
            logicalRound: 1,
            physicalAttempt: 0,
            endpoint: 'https://example.com/chat',
            headersJson: '{"authorization":"Bearer ****1234"}',
            bodyJson: '{"messages":[{"role":"tool","content":"result"}]}',
            truncated: false,
            createdAt: 300
          }
        },
        capabilities: {
          source: 'message_trace',
          summary: true,
          payload: true,
          timing: true,
          provenance: false,
          integrity: false,
          raw: true,
          messageDiagnostics: true
        },
        loading: false,
        errorCode: null,
        requestObservation: {
          before: [
            {
              key: 'tool-1',
              kind: 'tool',
              text: 'files / read_file',
              preview: 'files / read_file',
              timestamp: 250,
              blockIndex: 0,
              truncated: false
            }
          ],
          after: [
            {
              key: 'answer-1',
              kind: 'assistant',
              text: 'Final accumulated answer',
              preview: 'Final accumulated answer',
              timestamp: 350,
              blockIndex: 1,
              providerRequestSeq: 2,
              providerPhysicalAttempt: 1,
              truncated: false
            }
          ],
          afterBasis: 'identity',
          afterTruncated: false
        }
      }
    })

    expect(wrapper.get('[data-testid="tape-inspector-request-context"]').text()).toContain(
      'files / read_file'
    )
    expect(wrapper.get('[data-testid="tape-inspector-request-result"]').text()).toContain(
      'Final accumulated answer'
    )
    expect(wrapper.get('[data-testid="tape-inspector-request-result"]').text()).toContain(
      'tapeInspector.detail.finalSnapshot'
    )
    const payload = wrapper.text().slice(wrapper.text().indexOf('tapeInspector.detail.payload'))
    expect(payload).toContain('"body"')
    expect(payload).toContain('"headers"')
    expect(payload.indexOf('"body"')).toBeLessThan(payload.indexOf('"headers"'))
  })

  it('explains standalone model requests once on the request lane', () => {
    const wrapper = mount(TapeInspectorDetailPane, {
      props: {
        row: {
          recordType: 'evidence_lane',
          key: 'evidence-lane:request',
          laneKind: 'request',
          count: 3,
          collapsed: false,
          depth: 0,
          status: null,
          statusState: 'not_applicable',
          durationMs: null,
          timingState: 'not_applicable',
          sequenceEntryId: null,
          sequenceStart: 1,
          actualStartAt: null,
          actualEndAt: null,
          actualStart: 1,
          actualWidth: 0
        },
        detail: { source: 'evidence_lane', laneKind: 'request', count: 3 },
        capabilities: {
          source: 'derived',
          summary: true,
          payload: false,
          timing: false,
          provenance: false,
          integrity: false,
          raw: false,
          messageDiagnostics: false
        },
        loading: false,
        errorCode: null
      }
    })

    expect(wrapper.get('[data-testid="tape-inspector-standalone-request-hint"]').text()).toBe(
      'tapeInspector.evidence.standaloneHint'
    )
    expect(wrapper.text().match(/tapeInspector\.evidence\.standaloneHint/g)).toHaveLength(1)
  })

  it('distinguishes a recorded Memory manifest from the exact historical prompt', () => {
    const record = {
      ...firstDetail.detail.record,
      kind: 'anchor' as const,
      family: 'anchor' as const,
      name: 'memory/view_assembled'
    }
    const wrapper = mount(TapeInspectorDetailPane, {
      props: {
        row: {
          recordType: 'fact',
          key: 'fact:incarnation-1:entry:1',
          record,
          depth: 0,
          status: null,
          statusState: 'not_applicable',
          durationMs: null,
          timingState: 'point',
          sequenceEntryId: 1,
          sequenceStart: 0,
          actualStartAt: 100,
          actualEndAt: null,
          actualStart: 0,
          actualWidth: 0
        },
        detail: {
          source: 'tape',
          detail: {
            ...firstDetail.detail,
            record,
            data: {
              name: 'memory/view_assembled',
              manifest: {
                selected: [{ id: 'memory-1', kind: 'semantic' }],
                dropped: [],
                tokenBudget: 256,
                estimatedTokens: 90
              }
            }
          }
        },
        capabilities,
        loading: false,
        errorCode: null
      }
    })

    expect(wrapper.get('[data-testid="tape-inspector-memory-manifest-hint"]').text()).toBe(
      'tapeInspector.detail.memoryManifestHint'
    )
    expect(wrapper.text()).toContain('"id": "memory-1"')
  })

  it('focuses an overlay detail and closes it with Escape', async () => {
    const previousFocus = document.createElement('button')
    document.body.append(previousFocus)
    previousFocus.focus()
    const wrapper = mount(TapeInspectorDetailPane, {
      attachTo: document.body,
      props: {
        row: {
          recordType: 'fact',
          key: 'fact:incarnation-1:entry:1',
          record: firstDetail.detail.record,
          depth: 0,
          status: null,
          statusState: 'not_applicable',
          durationMs: null,
          timingState: 'point',
          sequenceEntryId: 1,
          sequenceStart: 0,
          actualStartAt: 100,
          actualEndAt: null,
          actualStart: 0,
          actualWidth: 0
        },
        detail: firstDetail,
        capabilities,
        loading: false,
        errorCode: null,
        placement: 'overlay'
      }
    })
    await flushPromises()

    expect(wrapper.attributes('role')).toBe('dialog')
    expect(wrapper.attributes('aria-modal')).toBe('true')
    expect(wrapper.element.contains(document.activeElement)).toBe(true)

    await wrapper.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
    await vi.runOnlyPendingTimersAsync()
    expect(document.activeElement).toBe(previousFocus)
    previousFocus.remove()
  })
})
