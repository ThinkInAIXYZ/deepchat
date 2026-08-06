import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, isProxy } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'

vi.mock('@renderer-notifications/rendererNotificationPort', () => ({
  notifyRenderer: vi.fn()
}))

const mocks = vi.hoisted(() => ({
  listAgentImportSources: vi.fn(),
  previewAgentImport: vi.fn(),
  executeAgentImport: vi.fn()
}))

vi.mock('@api/SkillClient', () => ({
  createSkillClient: () => mocks
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({ name: 'Icon', template: '<span />' })
}))

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const DialogStub = defineComponent({
  name: 'Dialog',
  props: { open: Boolean },
  emits: ['update:open'],
  template:
    '<div><button data-testid="dialog-dismiss" @click="$emit(\'update:open\', false)" /><slot /></div>'
})

const ButtonStub = defineComponent({
  name: 'Button',
  inheritAttrs: false,
  props: { disabled: Boolean },
  template: '<button v-bind="$attrs" :disabled="disabled"><slot /></button>'
})

const RadioGroupItemStub = defineComponent({
  name: 'RadioGroupItem',
  props: {
    value: { type: String, required: true },
    disabled: Boolean
  },
  template: '<input type="radio" :value="value" :disabled="disabled" />'
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

const mountDialog = async () => {
  const Dialog = (
    await import('../../../src/renderer/settings/components/skills/ImportSkillsFromAgentDialog.vue')
  ).default
  return mount(Dialog, {
    props: {
      open: true,
      targetAgentId: 'target-agent',
      targetAgentName: 'Target Agent'
    },
    global: {
      stubs: {
        Dialog: DialogStub,
        DialogContent: passthrough('DialogContent'),
        DialogDescription: passthrough('DialogDescription'),
        DialogFooter: passthrough('DialogFooter'),
        DialogHeader: passthrough('DialogHeader'),
        DialogTitle: passthrough('DialogTitle'),
        Empty: passthrough('Empty'),
        EmptyDescription: passthrough('EmptyDescription'),
        EmptyHeader: passthrough('EmptyHeader'),
        EmptyMedia: passthrough('EmptyMedia'),
        EmptyTitle: passthrough('EmptyTitle'),
        Badge: passthrough('Badge'),
        DcButton: ButtonStub,
        Checkbox: passthrough('Checkbox'),
        RadioGroup: passthrough('RadioGroup'),
        RadioGroupItem: RadioGroupItemStub,
        Spinner: passthrough('Spinner'),
        Icon: true
      }
    }
  })
}

describe('ImportSkillsFromAgentDialog', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.listAgentImportSources.mockResolvedValue([
      {
        id: 'internal:source-a',
        source: { kind: 'internal', agentId: 'source-a' },
        name: 'Source A',
        available: true,
        skillCount: 1
      },
      {
        id: 'internal:source-b',
        source: { kind: 'internal', agentId: 'source-b' },
        name: 'Source B',
        available: true,
        skillCount: 1
      }
    ])
    mocks.previewAgentImport.mockResolvedValue({
      targetAgentId: 'target-agent',
      source: { kind: 'internal', agentId: 'source-a' },
      items: [
        {
          name: 'skill-a',
          description: 'Skill A',
          status: 'ready'
        }
      ]
    })
  })

  it('preserves array result counts and locks source and close actions while executing', async () => {
    const execution = deferred<{
      success: boolean
      imported: string[]
      skipped: string[]
      failed: Array<{ skillName: string; reason: string }>
    }>()
    mocks.executeAgentImport.mockReturnValue(execution.promise)
    const wrapper = await mountDialog()
    await flushPromises()

    expect(mocks.previewAgentImport).toHaveBeenCalledTimes(1)
    expect(isProxy(mocks.previewAgentImport.mock.calls[0]?.[0].source)).toBe(false)
    await wrapper.get('[data-testid="agent-import-execute"]').trigger('click')
    await flushPromises()

    expect(mocks.executeAgentImport).toHaveBeenCalledWith({
      targetAgentId: 'target-agent',
      source: { kind: 'internal', agentId: 'source-a' },
      items: [{ skillName: 'skill-a', strategy: 'skip' }]
    })
    expect(isProxy(mocks.executeAgentImport.mock.calls[0]?.[0].source)).toBe(false)

    await wrapper.get('[data-testid="agent-import-source-internal:source-b"]').trigger('click')
    await wrapper.get('[data-testid="dialog-dismiss"]').trigger('click')

    expect(mocks.previewAgentImport).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('update:open')).toBeUndefined()

    execution.resolve({
      success: true,
      imported: ['skill-a'],
      skipped: ['skill-b'],
      failed: []
    })
    await flushPromises()

    expect(wrapper.text()).toContain(
      'settings.skills.agentImport.resultSummary:{"imported":1,"skipped":1,"failed":0}'
    )
  })

  it('drops stale sources and previews after the target Agent changes', async () => {
    const staleSources = deferred<
      Array<{
        id: string
        source: { kind: 'internal'; agentId: string }
        name: string
        available: boolean
        skillCount: number
      }>
    >()
    mocks.listAgentImportSources.mockImplementation((targetAgentId: string) => {
      if (targetAgentId === 'target-agent') return staleSources.promise
      return Promise.resolve([
        {
          id: 'internal:source-b',
          source: { kind: 'internal' as const, agentId: 'source-b' },
          name: 'Source B',
          available: true,
          skillCount: 1
        }
      ])
    })
    mocks.previewAgentImport.mockImplementation(({ targetAgentId }: { targetAgentId: string }) =>
      Promise.resolve({
        targetAgentId,
        source: { kind: 'internal', agentId: 'source-b' },
        items: [{ name: 'skill-b', description: 'Skill B', status: 'ready' }]
      })
    )
    const wrapper = await mountDialog()
    await Promise.resolve()

    await wrapper.setProps({ targetAgentId: 'target-agent-b', targetAgentName: 'Target B' })
    await flushPromises()

    expect(wrapper.find('[data-testid="agent-import-source-internal:source-b"]').exists()).toBe(
      true
    )
    expect(wrapper.find('[data-testid="agent-import-skill-skill-b"]').exists()).toBe(true)

    staleSources.resolve([
      {
        id: 'internal:source-a',
        source: { kind: 'internal', agentId: 'source-a' },
        name: 'Source A',
        available: true,
        skillCount: 1
      }
    ])
    await flushPromises()

    expect(wrapper.find('[data-testid="agent-import-source-internal:source-a"]').exists()).toBe(
      false
    )
    expect(mocks.previewAgentImport).toHaveBeenCalledWith({
      targetAgentId: 'target-agent-b',
      source: { kind: 'internal', agentId: 'source-b' }
    })
  })

  it('executes the selected per-conflict strategy for an external Agent source', async () => {
    mocks.listAgentImportSources.mockResolvedValue([
      {
        id: 'external:codex',
        source: { kind: 'external', toolId: 'codex' },
        name: 'Codex',
        available: true,
        skillCount: 1
      }
    ])
    mocks.previewAgentImport.mockResolvedValue({
      targetAgentId: 'target-agent',
      source: { kind: 'external', toolId: 'codex' },
      items: [
        {
          name: 'skill-a',
          description: 'Skill A',
          status: 'conflict',
          suggestedTargetName: 'skill-a-copy'
        }
      ]
    })
    mocks.executeAgentImport.mockResolvedValue({
      success: true,
      imported: ['skill-a'],
      skipped: [],
      failed: []
    })
    const wrapper = await mountDialog()
    await flushPromises()

    await wrapper.get('[data-testid="agent-import-strategy-skill-a-overwrite"]').trigger('click')
    await wrapper.get('[data-testid="agent-import-execute"]').trigger('click')
    await flushPromises()

    expect(mocks.executeAgentImport).toHaveBeenCalledWith({
      targetAgentId: 'target-agent',
      source: { kind: 'external', toolId: 'codex' },
      items: [{ skillName: 'skill-a', strategy: 'overwrite' }]
    })
  })

  it('keeps execution diagnostics out of the failure feedback', async () => {
    mocks.executeAgentImport.mockRejectedValue(new Error('secret filesystem path'))
    const wrapper = await mountDialog()
    await flushPromises()

    await wrapper.get('[data-testid="agent-import-execute"]').trigger('click')
    await flushPromises()

    // 失败反馈走按钮 ⚠ + 内联错误，不再弹 toast
    expect(notifyRenderer).not.toHaveBeenCalled()
    expect((wrapper.vm as any).executeStatus).toBe('error')
    expect(wrapper.text()).toContain('common.error.requestFailed')
    expect(wrapper.text()).not.toContain('secret filesystem path')
  })
})
