import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AgentMcpSelector from '@/components/mcp-config/AgentMcpSelector.vue'

const configClient = vi.hoisted(() => ({
  getMcpServers: vi.fn(),
  getAcpSharedMcpSelections: vi.fn(),
  setAcpSharedMcpSelections: vi.fn()
}))

const notifyRenderer = vi.hoisted(() => vi.fn())

vi.mock('@api/ConfigClient', () => ({
  createConfigClient: () => configClient
}))

vi.mock('@renderer-notifications/rendererNotificationPort', () => ({
  notifyRenderer
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    props: {
      icon: {
        type: String,
        required: true
      }
    },
    template: '<span :data-icon="icon" />'
  })
}))

const checkboxStub = defineComponent({
  name: 'Checkbox',
  props: {
    checked: {
      type: Boolean,
      default: false
    },
    disabled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:checked'],
  template:
    '<input type="checkbox" :checked="checked" :disabled="disabled" @click="$emit(\'update:checked\', !checked)" />'
})

const buttonStub = defineComponent({
  name: 'Button',
  props: {
    disabled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['click'],
  template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
})

const mountSelector = () =>
  mount(AgentMcpSelector, {
    global: {
      stubs: {
        Checkbox: checkboxStub,
        DcButton: buttonStub
      }
    }
  })

describe('AgentMcpSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configClient.getMcpServers.mockResolvedValue({
      filesystem: {
        type: 'stdio'
      }
    })
    configClient.getAcpSharedMcpSelections.mockResolvedValue([])
    configClient.setAcpSharedMcpSelections.mockResolvedValue(undefined)
  })

  it('shows load failures inline and retries without presenting an empty state', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    configClient.getMcpServers.mockRejectedValueOnce(new Error('offline'))
    const wrapper = mountSelector()
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('common.error.requestFailed')
    expect(wrapper.text()).not.toContain('settings.acp.mcpAccessEmpty')

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(true)
    consoleError.mockRestore()
  })

  it('disables persistence while saving and reports a success toast', async () => {
    let resolveSave: () => void = () => undefined
    configClient.setAcpSharedMcpSelections.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        })
    )
    const wrapper = mountSelector()
    await flushPromises()

    await wrapper.get('input[type="checkbox"]').trigger('click')

    expect(wrapper.get('input[type="checkbox"]').attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('persistence-state')?.at(-1)).toEqual(['saving'])

    resolveSave()
    await flushPromises()

    expect(configClient.setAcpSharedMcpSelections).toHaveBeenCalledWith(['filesystem'])
    expect(notifyRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'success',
        code: 'settings.agentMcpSelections.saved',
        title: 'common.saved'
      })
    )
    expect(wrapper.emitted('update:selections')?.[0]).toEqual([['filesystem']])
    expect(wrapper.emitted('persistence-state')?.at(-1)).toEqual(['idle'])
  })

  it('keeps persistence guarded while a save is in flight', async () => {
    let resolveSave: () => void = () => undefined
    configClient.setAcpSharedMcpSelections.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        })
    )
    const wrapper = mountSelector()
    await flushPromises()

    await wrapper.get('input[type="checkbox"]').trigger('click')

    expect(wrapper.get('input[type="checkbox"]').attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('persistence-state')?.at(-1)).toEqual(['saving'])

    resolveSave()
    await flushPromises()

    expect(configClient.setAcpSharedMcpSelections).toHaveBeenCalledWith(['filesystem'])
    expect(wrapper.emitted('persistence-state')?.at(-1)).toEqual(['idle'])
  })

  it('reverts failed selections and reports an error toast', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    configClient.setAcpSharedMcpSelections.mockRejectedValueOnce(new Error('disk full'))
    const wrapper = mountSelector()
    await flushPromises()

    await wrapper.get('input[type="checkbox"]').trigger('click')
    await flushPromises()

    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
    expect(notifyRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        code: 'settings.agentMcpSelections.saveFailed',
        title: 'common.error.operationFailed'
      })
    )
    expect(wrapper.emitted('persistence-state')).toEqual([['idle'], ['saving'], ['retryable']])
    consoleError.mockRestore()
  })

  it('discards retained retry intent when its owner confirms navigation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    configClient.setAcpSharedMcpSelections.mockRejectedValueOnce(new Error('disk full'))
    const wrapper = mountSelector()
    await flushPromises()

    await wrapper.get('input[type="checkbox"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('persistence-state')?.at(-1)).toEqual(['retryable'])

    wrapper.vm.discardRetryIntent()

    expect(wrapper.emitted('persistence-state')?.at(-1)).toEqual(['idle'])
    consoleError.mockRestore()
  })
})
