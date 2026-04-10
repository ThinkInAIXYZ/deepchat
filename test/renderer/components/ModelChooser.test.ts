import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { ModelType } from '../../../src/shared/model'

const setup = async () => {
  vi.resetModules()

  vi.doMock('@/stores/providerStore', () => ({
    useProviderStore: () => ({
      sortedProviders: [
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
      currentMode: ref('agent')
    })
  }))

  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))

  vi.doMock('@shadcn/components/ui/badge', () => ({
    Badge: {
      name: 'Badge',
      template: '<div><slot /></div>'
    }
  }))

  vi.doMock('@shadcn/components/ui/button', () => ({
    Button: {
      name: 'Button',
      props: {
        type: { type: String, default: 'button' }
      },
      emits: ['click'],
      template: '<button :type="type" @click="$emit(\'click\', $event)"><slot /></button>'
    }
  }))

  vi.doMock('@shadcn/components/ui/card', () => ({
    Card: {
      name: 'Card',
      template: '<div><slot /></div>'
    },
    CardContent: {
      name: 'CardContent',
      template: '<div><slot /></div>'
    }
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

  vi.doMock('@shadcn/components/ui/scroll-area', () => ({
    ScrollArea: {
      name: 'ScrollArea',
      template: '<div><slot /></div>'
    }
  }))

  vi.doMock('@/components/icons/ModelIcon.vue', () => ({
    default: {
      name: 'ModelIcon',
      template: '<span class="model-icon-stub" />'
    }
  }))

  vi.doMock('@iconify/vue', () => ({
    Icon: {
      name: 'Icon',
      template: '<span class="icon-stub" />'
    }
  }))

  const ModelChooser = (await import('@/components/ModelChooser.vue')).default

  return mount(ModelChooser, {
    props: {
      type: [ModelType.Chat]
    }
  })
}

describe('ModelChooser', () => {
  it('includes Ollama chat models and excludes Ollama embedding models', async () => {
    const wrapper = await setup()

    expect(wrapper.text()).toContain('deepseek-r1:1.5b')
    expect(wrapper.text()).not.toContain('nomic-embed-text:latest')

    const firstButton = wrapper.find('button')
    await firstButton.trigger('click')

    expect(wrapper.emitted('update:model')?.[0]).toEqual([
      { id: 'deepseek-r1:1.5b', name: 'deepseek-r1:1.5b', type: 'chat' },
      'ollama'
    ])
  })
})
