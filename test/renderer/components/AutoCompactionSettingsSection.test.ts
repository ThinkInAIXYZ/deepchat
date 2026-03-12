import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { mount } from '@vue/test-utils'

const createInputStub = () =>
  defineComponent({
    name: 'Input',
    inheritAttrs: false,
    props: {
      modelValue: {
        type: [String, Number],
        default: ''
      },
      disabled: {
        type: Boolean,
        default: false
      }
    },
    emits: ['update:modelValue'],
    template:
      '<input v-bind="$attrs" :disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  })

const createSliderStub = () =>
  defineComponent({
    name: 'Slider',
    inheritAttrs: false,
    props: {
      modelValue: {
        type: Array,
        default: () => []
      },
      disabled: {
        type: Boolean,
        default: false
      }
    },
    emits: ['update:modelValue'],
    template:
      '<button v-bind="$attrs" :data-disabled="String(disabled)" @click="$emit(\'update:modelValue\', [85])">slider</button>'
  })

const createToggleStub = () =>
  defineComponent({
    name: 'SettingToggleRow',
    props: {
      modelValue: {
        type: Boolean,
        default: false
      }
    },
    emits: ['update:modelValue'],
    template:
      '<button data-testid="auto-compaction-toggle" @click="$emit(\'update:modelValue\', !modelValue)">toggle</button>'
  })

const setup = async (enabled = true) => {
  vi.resetModules()

  const store = reactive({
    autoCompactionEnabled: enabled,
    autoCompactionTriggerThreshold: 80,
    autoCompactionRetainRecentPairs: 2,
    setAutoCompactionEnabled: vi.fn((value: boolean) => {
      store.autoCompactionEnabled = value
      return Promise.resolve()
    }),
    setAutoCompactionTriggerThreshold: vi.fn((value: number) => {
      store.autoCompactionTriggerThreshold = value
      return Promise.resolve()
    }),
    setAutoCompactionRetainRecentPairs: vi.fn((value: number) => {
      store.autoCompactionRetainRecentPairs = value
      return Promise.resolve()
    })
  })

  vi.doMock('@/stores/uiSettingsStore', () => ({
    AUTO_COMPACTION_TRIGGER_THRESHOLD_MIN: 5,
    AUTO_COMPACTION_TRIGGER_THRESHOLD_MAX: 95,
    AUTO_COMPACTION_TRIGGER_THRESHOLD_STEP: 5,
    AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MIN: 1,
    AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MAX: 10,
    useUiSettingsStore: () => store
  }))

  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string, params?: Record<string, unknown>) => {
        if (params?.['count'] !== undefined) {
          return `${key}:${params['count']}`
        }
        if (params?.['value'] !== undefined) {
          return `${key}:${params['value']}`
        }
        return key
      }
    })
  }))

  vi.doMock('@shadcn/components/ui/input', () => ({
    Input: createInputStub()
  }))
  vi.doMock('@shadcn/components/ui/slider', () => ({
    Slider: createSliderStub()
  }))
  vi.doMock('@shadcn/components/ui/switch', () => ({
    Switch: defineComponent({
      name: 'Switch',
      template: '<button><slot /></button>'
    })
  }))
  const component = (
    await import('../../../src/renderer/settings/components/common/AutoCompactionSettingsSection.vue')
  ).default

  const wrapper = mount(component, {
    global: {
      stubs: {
        Icon: true,
        SettingToggleRow: createToggleStub()
      }
    }
  })

  return { wrapper, store }
}

describe('AutoCompactionSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards toggle, slider, and input interactions to the ui settings store', async () => {
    const { wrapper, store } = await setup(true)

    await wrapper.get('[data-testid="auto-compaction-threshold-slider"]').trigger('click')
    await wrapper.findComponent({ name: 'Input' }).vm.$emit('update:modelValue', '4')
    await wrapper.get('[data-testid="auto-compaction-toggle"]').trigger('click')

    expect(store.setAutoCompactionTriggerThreshold).toHaveBeenCalledWith(85)
    expect(store.setAutoCompactionRetainRecentPairs).toHaveBeenCalledWith(4)
    expect(store.setAutoCompactionEnabled).toHaveBeenCalledWith(false)
  })

  it('disables threshold and retain controls when auto compaction is off', async () => {
    const { wrapper } = await setup(false)

    expect(
      wrapper.get('[data-testid="auto-compaction-threshold-slider"]').attributes('data-disabled')
    ).toBe('true')
    expect(
      wrapper.get('[data-testid="auto-compaction-retain-pairs-input"]').attributes('disabled')
    ).toBeDefined()
  })
})
