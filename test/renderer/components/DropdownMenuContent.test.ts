import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'

vi.mock('reka-ui', async () => {
  const { defineComponent } = await import('vue')
  return {
    DropdownMenuPortal: defineComponent({
      name: 'DropdownMenuPortal',
      template: '<div data-testid="dropdown-portal"><slot /></div>'
    }),
    DropdownMenuContent: defineComponent({
      name: 'DropdownMenuContentPrimitive',
      inheritAttrs: false,
      template: '<div data-testid="dropdown-content-primitive" v-bind="$attrs"><slot /></div>'
    }),
    useForwardPropsEmits: (props: unknown) => props
  }
})

describe('DropdownMenuContent', () => {
  it('forwards DOM attributes and listeners to the portalled content primitive', async () => {
    const onMousedown = vi.fn()
    const DropdownMenuContent = (
      await import('../../../src/shadcn/components/ui/dropdown-menu/DropdownMenuContent.vue')
    ).default
    const wrapper = mount(DropdownMenuContent, {
      attrs: {
        'data-probe': 'content',
        onMousedown
      },
      slots: {
        default: defineComponent({ template: '<span>item</span>' })
      }
    })

    const content = wrapper.get('[data-testid="dropdown-content-primitive"]')
    expect(content.attributes('data-probe')).toBe('content')

    await content.trigger('mousedown')
    expect(onMousedown).toHaveBeenCalledOnce()
  })
})
