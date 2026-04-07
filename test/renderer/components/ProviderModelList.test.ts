import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { ModelType } from '../../../src/shared/model'

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
  emits: ['click'],
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

const DynamicScrollerStub = defineComponent({
  name: 'DynamicScrollerStub',
  props: {
    items: {
      type: Array,
      default: () => []
    }
  },
  template: '<div><slot v-for="item in items" :key="item.id" :item="item" :active="true" /></div>'
})

const DynamicScrollerItemStub = defineComponent({
  name: 'DynamicScrollerItemStub',
  template: '<div><slot /></div>'
})

const ModelConfigItemStub = defineComponent({
  name: 'ModelConfigItemStub',
  props: {
    modelId: {
      type: String,
      required: true
    },
    modelName: {
      type: String,
      required: true
    }
  },
  template: '<div class="model-item" :data-model-id="modelId">{{ modelName }}</div>'
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('ProviderModelList', () => {
  it('filters by capability and type, then switches sorting from status to name', async () => {
    vi.resetModules()

    const modelStore = {
      removeCustomModel: vi.fn().mockResolvedValue(undefined),
      enableAllModels: vi.fn(),
      disableAllModels: vi.fn()
    }

    vi.doMock('@/stores/modelStore', () => ({
      useModelStore: () => modelStore
    }))
    vi.doMock('@vueuse/core', () => ({
      useElementSize: () => ({ height: ref(48) })
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string, params?: Record<string, number | string>) => {
          if (key === 'model.filter.visibleCount') {
            return `visible:${params?.visible}/${params?.total}`
          }
          return key
        }
      })
    }))

    const ProviderModelList = (
      await import('../../../src/renderer/settings/components/ProviderModelList.vue')
    ).default

    const wrapper = mount(ProviderModelList, {
      props: {
        providerModels: [
          {
            providerId: 'anthropic',
            models: [
              {
                id: 'zeta-vision',
                name: 'Zeta Vision',
                group: 'default',
                providerId: 'anthropic',
                enabled: true,
                vision: true,
                type: ModelType.Chat
              },
              {
                id: 'alpha-vision',
                name: 'Alpha Vision',
                group: 'default',
                providerId: 'anthropic',
                enabled: false,
                vision: true,
                type: ModelType.Chat
              },
              {
                id: 'beta-embedding',
                name: 'Beta Embedding',
                group: 'default',
                providerId: 'anthropic',
                enabled: true,
                type: ModelType.Embedding
              }
            ]
          }
        ],
        customModels: [
          {
            id: 'custom-reasoner',
            name: 'Custom Reasoner',
            group: 'default',
            providerId: 'anthropic',
            enabled: true,
            reasoning: true,
            type: ModelType.Chat,
            isCustom: true
          }
        ],
        providers: [{ id: 'anthropic', name: 'Anthropic' }],
        isLoading: false
      },
      global: {
        stubs: {
          Input: InputStub,
          Button: ButtonStub,
          Badge: passthrough('Badge'),
          Popover: passthrough('Popover'),
          PopoverContent: passthrough('PopoverContent'),
          PopoverTrigger: passthrough('PopoverTrigger'),
          DynamicScroller: DynamicScrollerStub,
          DynamicScrollerItem: DynamicScrollerItemStub,
          AddCustomModelButton: passthrough('AddCustomModelButton'),
          ModelConfigItem: ModelConfigItemStub,
          Icon: true
        }
      }
    })

    await flushPromises()

    await wrapper.get('[data-testid="model-capability-filter-vision"]').trigger('click')
    await wrapper.get('[data-testid="model-type-filter-chat"]').trigger('click')
    await flushPromises()

    const getVisibleIds = () =>
      wrapper.findAll('[data-model-id]').map((item) => item.attributes('data-model-id'))

    expect(getVisibleIds()).toEqual(['zeta-vision', 'alpha-vision'])
    expect(wrapper.text()).toContain('visible:2/4')

    await wrapper.get('[data-testid="model-sort-name"]').trigger('click')
    await flushPromises()

    expect(getVisibleIds()).toEqual(['alpha-vision', 'zeta-vision'])
  })
})
