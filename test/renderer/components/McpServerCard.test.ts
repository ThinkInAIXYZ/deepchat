import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import McpServerCard from '@/components/mcp-config/components/McpServerCard.vue'

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

const buttonStub = defineComponent({
  name: 'Button',
  props: {
    disabled: Boolean
  },
  emits: ['click'],
  template:
    '<button type="button" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const switchStub = defineComponent({
  name: 'Switch',
  props: {
    modelValue: Boolean,
    disabled: Boolean
  },
  emits: ['update:modelValue'],
  template:
    '<button data-testid="server-switch" type="button" :disabled="disabled" @click="$emit(\'update:modelValue\', !modelValue)">switch</button>'
})

const server = {
  name: 'demo',
  icons: 'D',
  descriptions: 'Demo MCP server',
  command: 'demo',
  args: [],
  enabled: false,
  isRunning: false
}

const mountCard = (onClick = vi.fn()) => {
  const wrapper = mount(McpServerCard, {
    props: {
      server,
      toolsCount: 1,
      promptsCount: 1,
      resourcesCount: 1
    },
    attrs: {
      onClick
    },
    global: {
      stubs: {
        Button: buttonStub,
        Switch: switchStub,
        DropdownMenu: passthrough('DropdownMenu'),
        DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
        DropdownMenuContent: passthrough('DropdownMenuContent'),
        DropdownMenuItem: buttonStub,
        DropdownMenuSeparator: passthrough('DropdownMenuSeparator'),
        Tooltip: passthrough('Tooltip'),
        TooltipContent: passthrough('TooltipContent'),
        TooltipProvider: passthrough('TooltipProvider'),
        TooltipTrigger: passthrough('TooltipTrigger'),
        Separator: passthrough('Separator'),
        Icon: true
      }
    }
  })

  return { wrapper, onClick }
}

describe('McpServerCard', () => {
  it('still lets the card surface open details', async () => {
    const { wrapper, onClick } = mountCard()

    await wrapper.trigger('click')

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not open details when toggling a server', async () => {
    const { wrapper, onClick } = mountCard()

    await wrapper.get('[data-testid="server-switch"]').trigger('click')

    expect(wrapper.emitted('toggle')).toHaveLength(1)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('does not open details when using footer actions', async () => {
    const { wrapper, onClick } = mountCard()
    const footerButtons = wrapper.findAll('button').filter((button) => button.text() === '1')

    await footerButtons[0].trigger('click')
    await footerButtons[1].trigger('click')
    await footerButtons[2].trigger('click')

    expect(wrapper.emitted('viewTools')).toHaveLength(1)
    expect(wrapper.emitted('viewPrompts')).toHaveLength(1)
    expect(wrapper.emitted('viewResources')).toHaveLength(1)
    expect(onClick).not.toHaveBeenCalled()
  })
})
