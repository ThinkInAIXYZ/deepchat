import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
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

afterEach(() => {
  vi.clearAllMocks()
})

describe('AcpSettings', () => {
  it('uninstalls an installed registry agent after confirmation', async () => {
    vi.resetModules()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
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
        t: (key: string, params?: Record<string, string>) =>
          key === 'settings.acp.registryUninstallConfirm' ? `confirm:${params?.name ?? ''}` : key
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
      .find((button) => button.text().includes('settings.acp.registryUninstallAction'))

    expect(uninstallButton).toBeDefined()

    await uninstallButton!.trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledWith('confirm:Codex ACP')
    expect(configPresenter.uninstallAcpRegistryAgent).toHaveBeenCalledWith('codex-acp')
    expect(configPresenter.listAcpRegistryAgents).toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith({
      title: 'settings.acp.deleteSuccess'
    })
  })
})
