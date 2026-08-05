import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const buttonStub = defineComponent({
  name: 'Button',
  inheritAttrs: false,
  props: {
    disabled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
})

const inputStub = defineComponent({
  name: 'Input',
  inheritAttrs: false,
  props: {
    modelValue: {
      type: [String, Number],
      default: ''
    }
  },
  emits: ['update:modelValue', 'update:model-value'],
  setup(_, { emit }) {
    const handleInput = (event: Event) => {
      const value = (event.target as HTMLInputElement).value
      emit('update:modelValue', value)
      emit('update:model-value', value)
    }

    return { handleInput }
  },
  template: '<input v-bind="$attrs" :value="modelValue" @input="handleInput" />'
})

const labelStub = defineComponent({
  name: 'Label',
  inheritAttrs: false,
  template: '<label v-bind="$attrs"><slot /></label>'
})

const iconStub = defineComponent({
  name: 'Icon',
  template: '<i />'
})

const findButtonByText = (wrapper: ReturnType<typeof mount>, text: string) => {
  const button = wrapper.findAll('button').find((item) => item.text().includes(text))
  if (!button) {
    throw new Error(`Button not found: ${text}`)
  }
  return button
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('NowledgeMemSettings', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function setup() {
    vi.resetModules()

    const nowledgeMemClient = {
      getConfig: vi.fn().mockResolvedValue({
        baseUrl: 'http://loaded.local',
        apiKey: 'loaded-key',
        timeout: 45000
      }),
      updateConfig: vi.fn(async (config) => config),
      testConnection: vi.fn().mockResolvedValue({
        success: true,
        message: 'Connection successful'
      })
    }
    const notifyRenderer = vi.fn(() => true)

    vi.doMock('@api/NowledgeMemClient', () => ({
      createNowledgeMemClient: () => nowledgeMemClient
    }))
    vi.doMock('@renderer-notifications/rendererNotificationPort', () => ({
      notifyRenderer
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    vi.doMock('@dc-ui/components/button', () => ({
      DcButton: buttonStub
    }))
    vi.doMock('@shadcn/components/ui/input', () => ({
      Input: inputStub
    }))
    vi.doMock('@shadcn/components/ui/label', () => ({
      Label: labelStub
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: iconStub
    }))

    const NowledgeMemSettings = (
      await import('../../../src/renderer/settings/components/NowledgeMemSettings.vue')
    ).default
    const wrapper = mount(NowledgeMemSettings, {
      global: {
        mocks: {
          $t: (key: string) => key
        },
        stubs: {
          Icon: iconStub
        }
      }
    })
    await flushPromises()

    return {
      wrapper,
      nowledgeMemClient,
      notifyRenderer
    }
  }

  it('loads, saves, tests, and resets through NowledgeMemClient', async () => {
    const { wrapper, nowledgeMemClient, notifyRenderer } = await setup()

    await wrapper.find('.cursor-default').trigger('click')
    await flushPromises()

    expect(nowledgeMemClient.getConfig).toHaveBeenCalledTimes(1)
    expect((wrapper.get('#baseUrl').element as HTMLInputElement).value).toBe('http://loaded.local')
    expect((wrapper.get('#apiKey').element as HTMLInputElement).value).toBe('loaded-key')

    await wrapper.get('#baseUrl').setValue('http://127.0.0.1:14242')
    await wrapper.get('#apiKey').setValue('secret')
    await findButtonByText(wrapper, 'settings.knowledgeBase.nowledgeMem.saveConfig').trigger(
      'click'
    )
    await flushPromises()

    await findButtonByText(wrapper, 'settings.knowledgeBase.nowledgeMem.testConnection').trigger(
      'click'
    )
    await flushPromises()

    await findButtonByText(wrapper, 'settings.knowledgeBase.nowledgeMem.resetConfig').trigger(
      'click'
    )
    await flushPromises()

    expect(nowledgeMemClient.updateConfig).toHaveBeenNthCalledWith(1, {
      baseUrl: 'http://127.0.0.1:14242',
      apiKey: 'secret',
      timeout: 45000
    })
    expect(nowledgeMemClient.testConnection).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:14242',
      apiKey: 'secret',
      timeout: 45000
    })
    expect(nowledgeMemClient.updateConfig).toHaveBeenNthCalledWith(2, {
      baseUrl: 'http://127.0.0.1:14242',
      apiKey: '',
      timeout: 30000
    })
    // 成功反馈走按钮 ✅ 态，不再弹 toast
    expect(notifyRenderer).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('reports failed saves as an inline error and retries the same draft', async () => {
    const { wrapper, nowledgeMemClient, notifyRenderer } = await setup()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const apiError = new Error('request rejected for loaded-key', {
      cause: new Error('token loaded-key rejected')
    })
    nowledgeMemClient.updateConfig.mockRejectedValueOnce(apiError)

    await wrapper.find('.cursor-default').trigger('click')
    await wrapper.get('#baseUrl').setValue('http://changed.local')
    await wrapper.get('[data-testid="nowledge-mem-save-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain(
      'settings.knowledgeBase.nowledgeMem.configSaveFailed'
    )
    expect(notifyRenderer).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('loaded-key')
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('loaded-key')
    const diagnosticError = consoleError.mock.calls.find(
      ([message]) => message === '[NowledgeMemSettings] save configuration failed'
    )?.[1]
    expect(diagnosticError).toBeInstanceOf(Error)
    expect(diagnosticError).toMatchObject({
      name: 'Error',
      message: 'request rejected for [redacted]',
      cause: expect.objectContaining({
        name: 'Error',
        message: 'token [redacted] rejected'
      })
    })
    expect((diagnosticError as Error).stack).not.toContain('loaded-key')
    expect(wrapper.get('[data-testid="nowledge-mem-save-button"]').attributes('disabled')).toBe(
      undefined
    )

    await wrapper.get('[data-testid="nowledge-mem-save-button"]').trigger('click')
    await flushPromises()

    expect(nowledgeMemClient.updateConfig).toHaveBeenCalledTimes(2)
    // 重试成功走按钮 ✅ 态，内联错误清除
    expect(notifyRenderer).not.toHaveBeenCalled()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('settings.knowledgeBase.nowledgeMem.configSaveFailed')
    wrapper.unmount()
  })

  it('explains invalid endpoints before save or connection testing', async () => {
    const { wrapper, nowledgeMemClient } = await setup()

    await wrapper.find('.cursor-default').trigger('click')
    await wrapper.get('#baseUrl').setValue('file:///private/config')

    expect(wrapper.get('#baseUrl').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('[role="alert"]').text()).toBe(
      'settings.knowledgeBase.nowledgeMem.invalidBaseUrl'
    )
    expect(
      wrapper.get('[data-testid="nowledge-mem-save-button"]').attributes('disabled')
    ).toBeDefined()
    expect(
      wrapper.get('[data-testid="nowledge-mem-test-button"]').attributes('disabled')
    ).toBeDefined()
    expect(nowledgeMemClient.updateConfig).not.toHaveBeenCalled()
    expect(nowledgeMemClient.testConnection).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('locks the draft during a connection test and reports success on the button', async () => {
    const { wrapper, nowledgeMemClient, notifyRenderer } = await setup()
    const pending = deferred<{ success: boolean; message: string }>()
    nowledgeMemClient.testConnection.mockReturnValueOnce(pending.promise)

    await wrapper.find('.cursor-default').trigger('click')
    await wrapper.get('[data-testid="nowledge-mem-test-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('#baseUrl').attributes('disabled')).toBeDefined()

    pending.resolve({ success: true, message: 'Connection successful' })
    await flushPromises()
    // 成功反馈走按钮 ✅ 态
    expect(notifyRenderer).not.toHaveBeenCalled()
    expect(wrapper.get('#baseUrl').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })
})
