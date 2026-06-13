import { describe, expect, it, vi } from 'vitest'
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

describe('NowledgeMemSettings', () => {
  async function setup() {
    vi.resetModules()

    const nowledgeMemClient = {
      getConfig: vi.fn().mockResolvedValue({
        baseUrl: 'http://loaded.local',
        apiKey: 'loaded-key',
        timeout: 45000
      }),
      updateConfig: vi.fn().mockResolvedValue({
        baseUrl: 'http://127.0.0.1:14242',
        apiKey: '',
        timeout: 30000
      }),
      testConnection: vi.fn().mockResolvedValue({
        success: true,
        message: 'Connection successful'
      })
    }
    const toast = vi.fn()

    vi.doMock('@api/NowledgeMemClient', () => ({
      createNowledgeMemClient: () => nowledgeMemClient
    }))
    vi.doMock('@/components/use-toast', () => ({
      useToast: () => ({ toast })
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    vi.doMock('@shadcn/components/ui/button', () => ({
      Button: buttonStub
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
        }
      }
    })
    await flushPromises()

    return {
      wrapper,
      nowledgeMemClient,
      toast
    }
  }

  it('loads, saves, tests, and resets through NowledgeMemClient', async () => {
    const { wrapper, nowledgeMemClient, toast } = await setup()

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
    expect(nowledgeMemClient.testConnection).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith({
      title: 'settings.knowledgeBase.nowledgeMem.testConnection',
      description: 'Connection successful'
    })
    expect(nowledgeMemClient.updateConfig).toHaveBeenNthCalledWith(2, {
      baseUrl: 'http://127.0.0.1:14242',
      apiKey: '',
      timeout: 30000
    })
  })
})
