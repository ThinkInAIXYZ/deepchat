import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'

const ButtonStub = defineComponent({
  name: 'ButtonStub',
  props: {
    disabled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

describe('ProviderModelManager', () => {
  it('emits refresh-models from the models header refresh button', async () => {
    vi.resetModules()
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    vi.doMock('@shadcn/components/ui/label', () => ({
      Label: passthrough('Label')
    }))
    vi.doMock('@shadcn/components/ui/button', () => ({
      Button: ButtonStub
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: passthrough('Icon')
    }))
    vi.doMock('../../../src/renderer/settings/components/ProviderModelList.vue', () => ({
      default: passthrough('ProviderModelList')
    }))

    const ProviderModelManager = (
      await import('../../../src/renderer/settings/components/ProviderModelManager.vue')
    ).default

    const wrapper = mount(ProviderModelManager, {
      props: {
        provider: {
          id: 'openai-codex',
          name: 'OpenAI Codex',
          apiType: 'openai-codex',
          baseUrl: 'https://chatgpt.com/backend-api/codex',
          enable: true,
          custom: false
        },
        enabledModels: [],
        totalModelsCount: 0,
        providerModels: [],
        customModels: [],
        isModelListLoading: false,
        isRefreshingModels: false
      }
    })

    await wrapper.get('[data-testid="provider-models-refresh-button"]').trigger('click')

    expect(wrapper.emitted('refresh-models')).toHaveLength(1)
  })
})
