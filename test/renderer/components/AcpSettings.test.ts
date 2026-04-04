import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, inject, provide } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const ButtonStub = defineComponent({
  name: 'ButtonStub',
  props: {
    disabled: {
      type: Boolean,
      default: false
    }
  },
  template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const InputStub = defineComponent({
  name: 'InputStub',
  props: {
    modelValue: {
      type: String,
      default: ''
    }
  },
  emits: ['update:modelValue'],
  template:
    '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
})

const TextareaStub = defineComponent({
  name: 'TextareaStub',
  props: {
    modelValue: {
      type: String,
      default: ''
    }
  },
  emits: ['update:modelValue'],
  template:
    '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
})

const SwitchStub = defineComponent({
  name: 'SwitchStub',
  props: {
    modelValue: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:modelValue'],
  template:
    '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />'
})

const DialogStub = defineComponent({
  name: 'DialogStub',
  props: {
    open: {
      type: Boolean,
      default: false
    }
  },
  template: '<div v-if="open"><slot /></div>'
})

const ALERT_DIALOG_CLOSE = Symbol('alert-dialog-close')

const AlertDialogStub = defineComponent({
  name: 'AlertDialogStub',
  props: {
    open: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:open'],
  setup(_, { emit }) {
    provide(ALERT_DIALOG_CLOSE, () => emit('update:open', false))
  },
  template: '<div v-if="open"><slot /></div>'
})

const AlertDialogActionStub = defineComponent({
  name: 'AlertDialogActionStub',
  props: {
    disabled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['click'],
  setup(_, { emit }) {
    const closeDialog = inject<() => void>(ALERT_DIALOG_CLOSE, () => {})

    const handleClick = (event: MouseEvent) => {
      closeDialog()
      emit('click', event)
    }

    return {
      handleClick
    }
  },
  template: '<button :disabled="disabled" @click="handleClick"><slot /></button>'
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('AcpSettings', () => {
  it('uninstalls an installed registry agent through the alert dialog', async () => {
    vi.resetModules()
    const toast = vi.fn()
    const listAcpRegistryAgents = vi
      .fn()
      .mockResolvedValue([])
      .mockResolvedValueOnce([
        {
          id: 'codex-acp',
          name: 'Codex ACP',
          version: '0.10.0',
          description: 'Registry agent',
          source: 'registry',
          enabled: true,
          distribution: {
            npx: {
              package: '@zed-industries/codex-acp'
            }
          },
          installState: {
            status: 'installed'
          }
        }
      ])

    const configPresenter = {
      getAcpEnabled: vi.fn().mockResolvedValue(true),
      listAcpRegistryAgents,
      listManualAcpAgents: vi.fn().mockResolvedValue([]),
      getAcpSharedMcpSelections: vi.fn().mockResolvedValue([]),
      uninstallAcpRegistryAgent: vi.fn().mockResolvedValue(undefined)
    }

    vi.doMock('@/composables/usePresenter', () => ({
      usePresenter: () => configPresenter
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string, params?: Record<string, string>) => {
          if (key === 'settings.acp.registryUninstallAction') return 'Uninstall'
          if (key === 'settings.acp.registryUninstallConfirm') {
            return `confirm:${params?.name ?? ''}`
          }
          if (key === 'settings.acp.registryUninstallDescription') return 'desc'
          if (key === 'settings.acp.deleteSuccess') return 'Deleted'
          return key
        }
      })
    }))
    vi.doMock('@/components/use-toast', () => ({
      useToast: () => ({ toast })
    }))
    vi.doMock('../../../src/renderer/settings/components/AcpDebugDialog.vue', () => ({
      default: passthrough('AcpDebugDialog')
    }))
    vi.doMock('@/components/mcp-config/AgentMcpSelector.vue', () => ({
      default: passthrough('AgentMcpSelector')
    }))
    vi.doMock('@/components/icons/AcpAgentIcon.vue', () => ({
      default: passthrough('AcpAgentIcon')
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))

    const AcpSettings = (await import('../../../src/renderer/settings/components/AcpSettings.vue'))
      .default

    const wrapper = mount(AcpSettings, {
      global: {
        stubs: {
          Card: passthrough('Card'),
          CardContent: passthrough('CardContent'),
          CardDescription: passthrough('CardDescription'),
          CardHeader: passthrough('CardHeader'),
          CardTitle: passthrough('CardTitle'),
          Badge: passthrough('Badge'),
          Button: ButtonStub,
          Switch: SwitchStub,
          Separator: passthrough('Separator'),
          Input: InputStub,
          Textarea: TextareaStub,
          Label: passthrough('Label'),
          Collapsible: passthrough('Collapsible'),
          CollapsibleContent: passthrough('CollapsibleContent'),
          AlertDialog: AlertDialogStub,
          AlertDialogAction: AlertDialogActionStub,
          AlertDialogCancel: ButtonStub,
          AlertDialogContent: passthrough('AlertDialogContent'),
          AlertDialogDescription: passthrough('AlertDialogDescription'),
          AlertDialogFooter: passthrough('AlertDialogFooter'),
          AlertDialogHeader: passthrough('AlertDialogHeader'),
          AlertDialogTitle: passthrough('AlertDialogTitle'),
          Dialog: DialogStub,
          DialogContent: passthrough('DialogContent'),
          DialogDescription: passthrough('DialogDescription'),
          DialogFooter: passthrough('DialogFooter'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
          AcpDebugDialog: passthrough('AcpDebugDialog'),
          AgentMcpSelector: passthrough('AgentMcpSelector'),
          AcpAgentIcon: passthrough('AcpAgentIcon'),
          Icon: true
        }
      }
    })

    await flushPromises()

    const uninstallButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Uninstall'))

    expect(uninstallButton).toBeDefined()

    await uninstallButton!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('confirm:Codex ACP')
    expect(wrapper.text()).toContain('desc')

    const uninstallActions = wrapper
      .findAll('button')
      .filter((button) => button.text().includes('Uninstall'))

    expect(uninstallActions).toHaveLength(2)

    await uninstallActions[uninstallActions.length - 1].trigger('click')
    await flushPromises()

    expect(configPresenter.uninstallAcpRegistryAgent).toHaveBeenCalledWith('codex-acp')
    expect(configPresenter.listAcpRegistryAgents).toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith({
      title: 'Deleted'
    })
  })
})
