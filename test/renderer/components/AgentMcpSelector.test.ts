import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, type ShallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AgentMcpSelector from '@/components/mcp-config/AgentMcpSelector.vue'

const configClient = vi.hoisted(() => ({
  getMcpServers: vi.fn(),
  getAcpSharedMcpSelections: vi.fn(),
  setAcpSharedMcpSelections: vi.fn()
}))

const feedback = vi.hoisted(() => ({
  snapshot: null as ShallowRef<any> | null,
  controller: {
    begin: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    clearSettled: vi.fn()
  }
}))

vi.mock('@api/ConfigClient', () => ({
  createConfigClient: () => configClient
}))

vi.mock('@renderer-notifications/rendererNotificationRuntime', () => ({
  createRendererSurfaceFeedbackController: () => feedback.controller
}))

vi.mock('@renderer-notifications/useSurfaceFeedback', async () => {
  const { shallowRef } = await vi.importActual<typeof import('vue')>('vue')
  feedback.snapshot = shallowRef({ status: 'idle', version: 0 })
  return {
    useSurfaceFeedback: () => ({
      snapshot: feedback.snapshot,
      setActive: vi.fn()
    })
  }
})

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
        Button: buttonStub
      }
    }
  })

describe('AgentMcpSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    feedback.snapshot!.value = { status: 'idle', version: 0 }
    feedback.controller.begin.mockImplementation((operationId: string, label: string) => {
      feedback.snapshot!.value = {
        status: 'pending',
        operationId,
        label,
        version: feedback.snapshot!.value.version + 1
      }
    })
    feedback.controller.succeed.mockImplementation(
      (result: { code: string; title: string; description?: string }) => {
        feedback.snapshot!.value = {
          status: 'success',
          operationId: feedback.snapshot!.value.operationId,
          ...result,
          version: feedback.snapshot!.value.version + 1
        }
      }
    )
    feedback.controller.fail.mockImplementation(
      (result: { code: string; title: string; description?: string }) => {
        feedback.snapshot!.value = {
          status: 'error',
          operationId: feedback.snapshot!.value.operationId,
          ...result,
          version: feedback.snapshot!.value.version + 1
        }
      }
    )
    feedback.controller.clearSettled.mockImplementation(() => {
      feedback.snapshot!.value = {
        status: 'idle',
        version: feedback.snapshot!.value.version + 1
      }
    })
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

  it('uses compact pending and success feedback for persisted selections', async () => {
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

    expect(wrapper.get('[data-testid="inline-operation-feedback"]').text()).toBe('common.saving')
    expect(wrapper.get('input[type="checkbox"]').attributes('disabled')).toBeDefined()

    resolveSave()
    await flushPromises()

    expect(configClient.setAcpSharedMcpSelections).toHaveBeenCalledWith(['filesystem'])
    expect(wrapper.get('[data-testid="inline-operation-feedback"]').text()).toBe('common.saved')
    expect(wrapper.emitted('update:selections')?.[0]).toEqual([['filesystem']])
  })

  it('keeps persistence guarded when feedback cannot begin', async () => {
    let resolveSave: () => void = () => undefined
    feedback.controller.begin.mockImplementationOnce(() => false)
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

  it('reverts failed selections and retries the intended value inline', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    configClient.setAcpSharedMcpSelections.mockRejectedValueOnce(new Error('disk full'))
    const wrapper = mountSelector()
    await flushPromises()

    await wrapper.get('input[type="checkbox"]').trigger('click')
    await flushPromises()

    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.get('[data-testid="inline-operation-feedback"]').attributes('data-status')).toBe(
      'error'
    )

    await wrapper.get('[data-testid="inline-operation-feedback"] button').trigger('click')
    await flushPromises()

    expect(configClient.setAcpSharedMcpSelections).toHaveBeenNthCalledWith(2, ['filesystem'])
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.get('[data-testid="inline-operation-feedback"]').text()).toBe('common.saved')
    expect(wrapper.emitted('persistence-state')).toEqual([
      ['idle'],
      ['saving'],
      ['retryable'],
      ['saving'],
      ['idle']
    ])
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

    expect(feedback.controller.clearSettled).toHaveBeenCalledOnce()
    expect(wrapper.emitted('persistence-state')?.at(-1)).toEqual(['idle'])
    consoleError.mockRestore()
  })
})
