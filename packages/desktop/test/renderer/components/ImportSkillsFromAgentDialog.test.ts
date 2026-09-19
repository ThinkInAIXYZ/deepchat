import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, inject, isProxy, provide } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const mocks = vi.hoisted(() => ({
  skillClient: {
    listAgentImportSources: vi.fn(),
    previewAgentImport: vi.fn(),
    executeAgentImport: vi.fn()
  }
}))

vi.mock('@api/SkillClient', () => ({
  createSkillClient: () => mocks.skillClient
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
  name: 'DcButton',
  inheritAttrs: false,
  props: { disabled: Boolean },
  template: '<button v-bind="$attrs" :disabled="disabled"><slot /></button>'
})

const CheckboxStub = defineComponent({
  name: 'Checkbox',
  props: { modelValue: [Boolean, String], disabled: Boolean },
  emits: ['update:modelValue'],
  template:
    '<button type="button" role="checkbox" :disabled="disabled" @click="$emit(\'update:modelValue\', !modelValue)" />'
})

const radioGroupKey = 'test-radio-group-update'
const RadioGroupStub = defineComponent({
  name: 'RadioGroup',
  props: { modelValue: String },
  emits: ['update:modelValue'],
  setup(_props, { emit }) {
    provide(radioGroupKey, (value: string) => emit('update:modelValue', value))
  },
  template: '<div><slot /></div>'
})

const RadioGroupItemStub = defineComponent({
  name: 'RadioGroupItem',
  props: { value: { type: String, required: true }, disabled: Boolean },
  setup() {
    return { select: inject<(value: string) => void>(radioGroupKey) }
  },
  template: '<button type="button" :disabled="disabled" @click="select?.(value)" />'
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

const mountDialog = async () => {
  const Dialog = (
    await import('../../../src/renderer/src/pages/plugins/skills/ImportSkillsFromAgentDialog.vue')
  ).default
  return mount(Dialog, {
    props: {
      open: true,
      agents: [{ id: 'target-a', name: 'Target Agent' }]
    },
    global: {
      stubs: {
        Dialog: DialogStub,
        DialogContent: passthrough('DialogContent'),
        DialogDescription: passthrough('DialogDescription'),
        DialogFooter: passthrough('DialogFooter'),
        DialogHeader: passthrough('DialogHeader'),
        DialogTitle: passthrough('DialogTitle'),
        DcBadge: passthrough('DcBadge'),
        DcButton: ButtonStub,
        Checkbox: CheckboxStub,
        RadioGroup: RadioGroupStub,
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
    mocks.skillClient.listAgentImportSources.mockResolvedValue([
      {
        id: 'external:codex',
        source: { kind: 'external', toolId: 'codex' },
        name: 'Codex',
        available: true,
        skillCount: 3
      }
    ])
    mocks.skillClient.previewAgentImport.mockResolvedValue({
      source: { kind: 'external', toolId: 'codex' },
      items: [
        { name: 'ready-skill', description: 'Ready', status: 'ready' },
        { name: 'same-skill', description: 'Same', status: 'same' },
        {
          name: 'conflict-skill',
          description: 'Conflict',
          status: 'conflict',
          suggestedTargetName: 'conflict-skill-copy',
          affectedAgentIds: ['target-a']
        }
      ]
    })
  })

  it('imports external snapshots globally with explicit conflict impact', async () => {
    mocks.skillClient.executeAgentImport.mockResolvedValue({
      success: true,
      imported: ['ready-skill', 'conflict-skill'],
      reused: ['same-skill'],
      skipped: [],
      failed: []
    })
    const wrapper = await mountDialog()
    await flushPromises()

    expect(mocks.skillClient.listAgentImportSources).toHaveBeenCalledWith()
    expect(mocks.skillClient.previewAgentImport).toHaveBeenLastCalledWith({
      source: { kind: 'external', toolId: 'codex' }
    })
    expect(isProxy(mocks.skillClient.previewAgentImport.mock.calls[0]?.[0].source)).toBe(false)
    expect(
      wrapper
        .get('[data-testid="agent-import-skill-ready-skill"] [role="checkbox"]')
        .attributes('aria-label')
    ).toBe('ready-skill')
    expect(wrapper.text()).toContain(
      'settings.skills.agentImport.overwriteImpact:{"agents":"Target Agent"}'
    )

    await wrapper
      .get('[data-testid="agent-import-strategy-conflict-skill-overwrite"] button')
      .trigger('click')
    await wrapper.get('[data-testid="agent-import-execute"]').trigger('click')
    await flushPromises()

    expect(mocks.skillClient.executeAgentImport).toHaveBeenCalledWith({
      source: { kind: 'external', toolId: 'codex' },
      items: [
        { skillName: 'ready-skill', strategy: 'skip', acknowledgedAgentIds: undefined },
        { skillName: 'same-skill', strategy: 'skip', acknowledgedAgentIds: undefined },
        {
          skillName: 'conflict-skill',
          strategy: 'overwrite',
          acknowledgedAgentIds: ['target-a']
        }
      ]
    })
    expect(wrapper.emitted('imported')).toHaveLength(1)
    expect(wrapper.text()).toContain(
      'settings.skills.agentImport.resultSummaryV3:{"imported":2,"reused":1,"skipped":0,"failed":0}'
    )
  })

  it('blocks dismissal during execution and hides internal diagnostics on failure', async () => {
    const execution = deferred<never>()
    mocks.skillClient.executeAgentImport.mockReturnValue(execution.promise)
    const wrapper = await mountDialog()
    await flushPromises()

    await wrapper.get('[data-testid="agent-import-execute"]').trigger('click')
    await wrapper.get('[data-testid="dialog-dismiss"]').trigger('click')
    expect(wrapper.emitted('update:open')).toBeUndefined()

    execution.reject(new Error('secret filesystem path'))
    await flushPromises()

    expect(wrapper.text()).toContain('common.error.requestFailed')
    expect(wrapper.text()).not.toContain('secret filesystem path')
  })
})
