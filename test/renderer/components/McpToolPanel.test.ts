import { describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, reactive, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { TOOL_EXECUTION } from '@shared/types/mcp'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const buttonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>'
})

const selectStub = defineComponent({
  name: 'Select',
  emits: ['update:modelValue'],
  template:
    '<button data-testid="tool-select" @click="$emit(\'update:modelValue\', \'inspect\')"><slot /></button>'
})

describe('McpToolPanel', () => {
  it('renders enum values declared by array items', async () => {
    vi.resetModules()
    const mcpStore = reactive({
      tools: [
        {
          execution: TOOL_EXECUTION.write,
          type: 'function',
          source: 'mcp' as const,
          function: {
            name: 'inspect',
            description: 'Inspect values',
            parameters: {
              type: 'object',
              properties: {
                formats: {
                  type: 'array',
                  items: {
                    type: 'string',
                    enum: ['json', { format: 'xml' }]
                  }
                }
              }
            }
          },
          server: {
            name: 'test-server',
            icons: '',
            description: 'Test server'
          }
        }
      ],
      toolInputs: {} as Record<string, unknown>,
      toolLoadingStates: {} as Record<string, boolean>,
      callTool: vi.fn()
    })

    vi.doMock('@/stores/mcp', () => ({ useMcpStore: () => mcpStore }))
    vi.doMock('@vueuse/core', () => ({ useMediaQuery: () => ref(false) }))
    vi.doMock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

    const McpToolPanel = (await import('@/components/mcp-config/components/McpToolPanel.vue'))
      .default
    const wrapper = mount(McpToolPanel, {
      props: {
        open: true,
        serverName: 'test-server'
      },
      global: {
        stubs: {
          Button: buttonStub,
          Badge: passthrough('Badge'),
          ScrollArea: passthrough('ScrollArea'),
          Sheet: passthrough('Sheet'),
          SheetContent: passthrough('SheetContent'),
          SheetHeader: passthrough('SheetHeader'),
          SheetTitle: passthrough('SheetTitle'),
          SheetDescription: passthrough('SheetDescription'),
          Select: selectStub,
          SelectContent: passthrough('SelectContent'),
          SelectItem: passthrough('SelectItem'),
          SelectTrigger: passthrough('SelectTrigger'),
          SelectValue: passthrough('SelectValue'),
          Spinner: true,
          Icon: true,
          McpJsonViewer: true
        }
      }
    })

    await wrapper.get('[data-testid="tool-select"]').trigger('click')
    await nextTick()
    const parametersToggle = wrapper
      .findAll('button')
      .find((button) => button.text().includes('mcp.tools.parameters'))

    expect(parametersToggle).toBeDefined()
    await parametersToggle!.trigger('click')

    expect(wrapper.text()).toContain('array[enum(string)]')
    expect(wrapper.text()).toContain('mcp.tools.arrayItemValues')
    expect(wrapper.text()).toContain('json')
    expect(wrapper.text()).toContain('{"format":"xml"}')
  })
})
