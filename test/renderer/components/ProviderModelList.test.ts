import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive, ref } from 'vue'
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

const RecycleScrollerStub = defineComponent({
  name: 'RecycleScrollerStub',
  props: {
    items: {
      type: Array,
      default: () => []
    }
  },
  template:
    '<div><slot v-for="(item, index) in items.slice(0, 19)" :key="item.id" :item="item" :index="index" :active="true" /></div>'
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
    },
    enabled: Boolean
  },
  template:
    '<button class="model-item" :data-model-id="modelId" role="switch" :aria-checked="enabled">{{ modelName }}</button>'
})

afterEach(() => {
  vi.clearAllMocks()
})

async function setup(ready = true) {
  vi.resetModules()

  const modelStore = {
    removeCustomModel: vi.fn().mockResolvedValue(undefined),
    enableAllModels: vi.fn(),
    disableAllModels: vi.fn()
  }

  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => modelStore
  }))
  vi.doMock('@/stores/uiSettingsStore', () => ({
    useUiSettingsStore: () => ({
      traceDebugEnabled: false
    })
  }))
  const accessibilityEnabled = ref(false)
  const accessibilityReady = ref(ready)
  vi.doMock('@/composables/useAccessibilitySupport', () => ({
    useAccessibilitySupport: () => ({ accessibilityEnabled, accessibilityReady })
  }))
  vi.doMock('@vueuse/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@vueuse/core')>()),
    refDebounced: (source: unknown) => source,
    useDebounceFn: (fn: (...args: unknown[]) => unknown) => fn,
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

  const providerModels = reactive([
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
        }
      ]
    }
  ])
  const wrapper = mount(ProviderModelList, {
    props: {
      providerModels,
      customModels: [],
      providers: [{ id: 'anthropic', name: 'Anthropic' }],
      isLoading: false
    },
    global: {
      stubs: {
        Input: InputStub,
        DcButton: ButtonStub,
        Badge: passthrough('Badge'),
        Popover: passthrough('Popover'),
        PopoverContent: passthrough('PopoverContent'),
        PopoverTrigger: passthrough('PopoverTrigger'),
        RecycleScroller: RecycleScrollerStub,
        AddCustomModelButton: passthrough('AddCustomModelButton'),
        ModelConfigItem: ModelConfigItemStub,
        Icon: true
      }
    }
  })
  await flushPromises()
  return { wrapper, providerModels, accessibilityEnabled, accessibilityReady }
}

describe('ProviderModelList', () => {
  it('waits for native accessibility status before mounting model rows', async () => {
    const { wrapper, accessibilityEnabled, accessibilityReady } = await setup(false)
    accessibilityEnabled.value = true
    await flushPromises()
    expect(wrapper.findAll('[data-model-id]')).toHaveLength(0)
    accessibilityEnabled.value = false
    accessibilityReady.value = true
    await flushPromises()
    expect(wrapper.findAll('[data-model-id]')).toHaveLength(2)
    expect(wrapper.find('[data-testid="accessible-model-list"]').exists()).toBe(false)
  })

  it.each([false, true])(
    'updates visible switches in place (accessibility: %s)',
    async (accessible) => {
      const { wrapper, providerModels, accessibilityEnabled } = await setup()
      accessibilityEnabled.value = accessible
      await flushPromises()
      const first = () => wrapper.get('[data-model-id="zeta-vision"]')
      const second = () => wrapper.get('[data-model-id="alpha-vision"]')
      expect(first().attributes('aria-checked')).toBe('true')
      providerModels[0].models[0].enabled = false
      await flushPromises()
      expect(first().attributes('aria-checked')).toBe('false')
      // A failed persistence write rolls the same model back without remounting the list.
      providerModels[0].models[0].enabled = true
      providerModels[0].models[1].enabled = true
      await flushPromises()
      expect(first().attributes('aria-checked')).toBe('true')
      expect(second().attributes('aria-checked')).toBe('true')
      for (const model of providerModels[0].models) model.enabled = false
      await flushPromises()
      expect(first().attributes('aria-checked')).toBe('false')
      expect(second().attributes('aria-checked')).toBe('false')
    }
  )

  it('filters by capability and type, then switches sorting from status to name', async () => {
    const { wrapper, accessibilityEnabled } = await setup()
    await wrapper.setProps({
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

    await wrapper.get('[data-testid="model-capability-filter-vision"]').trigger('click')
    await wrapper.get('[data-testid="model-type-filter-chat"]').trigger('click')
    await wrapper.setProps({
      customModels: [],
      providerModels: [
        {
          providerId: 'anthropic',
          models: Array.from({ length: 250 }, (_, index) => ({
            id: `model-${String(index + 1).padStart(3, '0')}`,
            name: `Model ${String(index + 1).padStart(3, '0')}`,
            group: 'default',
            providerId: 'anthropic',
            enabled: true,
            type: ModelType.Chat
          }))
        }
      ]
    })
    await flushPromises()
    expect(getVisibleIds().length).toBeLessThan(250)
    accessibilityEnabled.value = true
    await flushPromises()
    expect(getVisibleIds()).toHaveLength(250)
    expect(getVisibleIds().at(-1)).toBe('model-250')
    wrapper.unmount()
  })
})
