import { describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import CronExpressionEditor from '../../../src/renderer/settings/components/CronExpressionEditor.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const SelectStub = defineComponent({
  name: 'Select',
  props: {
    modelValue: {
      type: [String, Number],
      default: ''
    }
  },
  emits: ['update:modelValue', 'update:model-value'],
  setup(_props, { emit }) {
    return {
      onChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value
        emit('update:modelValue', value)
        emit('update:model-value', value)
      }
    }
  },
  template: `
    <select v-bind="$attrs" :value="modelValue" @change="onChange">
      <slot />
    </select>
  `
})

const SelectItemStub = defineComponent({
  name: 'SelectItem',
  props: {
    value: {
      type: String,
      required: true
    },
    disabled: {
      type: Boolean,
      default: false
    }
  },
  template: '<option :value="value" :disabled="disabled"><slot /></option>'
})

describe('CronExpressionEditor', () => {
  it('emits crontab expressions from field selections', async () => {
    const wrapper = mount(CronExpressionEditor, {
      props: {
        modelValue: '0 9 * * *',
        locale: 'en'
      },
      global: {
        stubs: {
          Label: passthrough('Label'),
          Select: SelectStub,
          SelectContent: passthrough('SelectContent'),
          SelectItem: SelectItemStub,
          SelectTrigger: passthrough('SelectTrigger'),
          SelectValue: passthrough('SelectValue')
        }
      }
    })

    await nextTick()
    const minuteSelect = wrapper
      .findAllComponents(SelectStub)
      .find((entry) => entry.attributes('data-testid') === 'cron-editor-field-minute')
    minuteSelect?.vm.$emit('update:modelValue', '30')
    await nextTick()

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['30 9 * * *'])
  })
})
