import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import ModelSelector from '@/components/chat-input/ModelSelector.vue'

const PopoverStub = defineComponent({
  name: 'Popover',
  props: {
    open: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:open'],
  template: '<div data-popover><slot /></div>'
})

const PopoverTriggerStub = defineComponent({
  name: 'PopoverTrigger',
  template: '<div data-popover-trigger><slot /></div>'
})

const PopoverContentStub = defineComponent({
  name: 'PopoverContent',
  template: '<div data-popover-content><slot /></div>'
})

const ModelChooserStub = defineComponent({
  name: 'ModelChooser',
  emits: ['update:model'],
  setup(_, { emit }) {
    const onClick = () => emit('update:model', { id: 'gpt-4o', name: 'GPT-4o' }, 'openai')
    return { onClick }
  },
  template: '<button data-model-chooser @click="onClick">pick</button>'
})

describe('ModelSelector', () => {
  it('forwards providerId when selecting model', async () => {
    const wrapper = mount(ModelSelector, {
      props: {
        activeModel: { id: 'gpt-4o-mini', providerId: 'openai', tags: [] },
        modelDisplayName: 'openai:gpt-4o-mini',
        isDark: false,
        temperature: 0.7,
        contextLength: 0,
        maxTokens: 0,
        artifacts: 0
      },
      global: {
        stubs: {
          Popover: PopoverStub,
          PopoverTrigger: PopoverTriggerStub,
          PopoverContent: PopoverContentStub,
          ModelChooser: ModelChooserStub,
          Button: defineComponent({ name: 'Button', template: '<button><slot /></button>' }),
          Badge: defineComponent({ name: 'Badge', template: '<span><slot /></span>' }),
          ScrollArea: defineComponent({ name: 'ScrollArea', template: '<div><slot /></div>' }),
          ModelIcon: defineComponent({ name: 'ModelIcon', template: '<span />' }),
          ChatConfig: defineComponent({ name: 'ChatConfig', template: '<div />' })
        }
      }
    })

    wrapper.findComponent(PopoverStub).vm.$emit('update:open', true)
    await nextTick()

    await wrapper.get('[data-model-chooser]').trigger('click')
    await nextTick()

    expect(wrapper.emitted('model-update')?.[0]).toEqual([
      { id: 'gpt-4o', name: 'GPT-4o' },
      'openai'
    ])
    expect(wrapper.findComponent(PopoverStub).props('open')).toBe(false)
  })
})
