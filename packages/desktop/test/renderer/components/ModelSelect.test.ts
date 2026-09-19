import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { ModelType } from '../../../src/shared/model'

const setup = async (
  options: {
    currentMode?: 'agent' | 'acp agent'
    props?: Record<string, unknown>
  } = {}
) => {
  vi.resetModules()

  const currentMode = options.currentMode ?? 'agent'

  vi.doMock('@/stores/providerStore', () => ({
    useProviderStore: () => ({
      sortedProviders: [
        { id: 'acp', name: 'ACP', enable: true },
        { id: 'ollama', name: 'Ollama', enable: true },
        { id: 'openai', name: 'OpenAI', enable: true }
      ]
    })
  }))

  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => ({
      enabledModels: [
        {
          providerId: 'ollama',
          models: [
            { id: 'deepseek-r1:1.5b', name: 'deepseek-r1:1.5b', type: 'chat' },
            { id: 'nomic-embed-text:latest', name: 'nomic-embed-text:latest', type: 'embedding' }
          ]
        },
        {
          providerId: 'acp',
          models: [{ id: 'acp-agent', name: 'ACP Agent', type: 'chat' }]
        }
      ]
    })
  }))

  vi.doMock('@/stores/theme', () => ({
    useThemeStore: () => ({
      isDark: false
    })
  }))

  vi.doMock('@/stores/language', () => ({
    useLanguageStore: () => ({
      dir: 'ltr'
    })
  }))

  vi.doMock('@/components/chat-input/composables/useChatMode', () => ({
    useChatMode: () => ({
      currentMode: ref(currentMode)
    })
  }))

  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))

  vi.doMock('@shadcn/components/ui/input', () => ({
    Input: {
      name: 'Input',
      props: ['modelValue'],
      emits: ['update:modelValue'],
      template:
        '<input :value="modelValue ?? \'\'" @input="$emit(\'update:modelValue\', $event.target.value)" />'
    }
  }))

  vi.doMock('@/components/icons/ModelIcon.vue', () => ({
    default: {
      name: 'ModelIcon',
      template: '<span class="model-icon-stub" />'
    }
  }))

  const ModelSelect = (await import('@/components/ModelSelect.vue')).default

  return mount(ModelSelect, {
    props: {
      type: [ModelType.Chat],
      ...options.props
    }
  })
}

describe('ModelSelect', () => {
  it('includes Ollama chat models and excludes Ollama embedding models', async () => {
    const wrapper = await setup()

    expect(wrapper.text()).toContain('deepseek-r1:1.5b')
    expect(wrapper.text()).not.toContain('nomic-embed-text:latest')

    const firstOption = wrapper.findAll('.cursor-pointer')[0]
    await firstOption.trigger('click')

    expect(wrapper.emitted('update:model')).toEqual([
      [{ id: 'deepseek-r1:1.5b', name: 'deepseek-r1:1.5b', type: 'chat' }, 'ollama']
    ])
  })

  it('can ignore chat mode filtering for settings pickers', async () => {
    const wrapper = await setup({
      currentMode: 'acp agent',
      props: {
        excludeProviders: ['acp'],
        respectChatMode: false
      }
    })

    expect(wrapper.text()).toContain('deepseek-r1:1.5b')
    expect(wrapper.text()).not.toContain('ACP Agent')
  })
})
