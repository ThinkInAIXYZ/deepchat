import { describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { mount } from '@vue/test-utils'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

describe('McpElicitationDialog', () => {
  it('reflects stored multi-select defaults in native option state', async () => {
    vi.resetModules()
    const store = reactive({
      isOpen: true,
      isSubmitting: false,
      request: {
        requestId: 'request-1',
        serverName: 'fixture',
        mode: 'form',
        message: 'Choose regions'
      },
      fields: [
        {
          name: 'regions',
          title: 'Regions',
          type: 'multi-select',
          required: false,
          options: [
            { value: 'north', title: 'North' },
            { value: 'south', title: 'South' }
          ]
        }
      ],
      values: {
        regions: ['south']
      },
      errors: {},
      setValue: vi.fn(),
      accept: vi.fn(),
      decline: vi.fn(),
      cancel: vi.fn(),
      openRequestedUrl: vi.fn()
    })
    vi.doMock('@/stores/mcpElicitation', () => ({
      useMcpElicitationStore: () => store
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    const McpElicitationDialog = (await import('@/components/mcp/McpElicitationDialog.vue')).default

    const wrapper = mount(McpElicitationDialog, {
      global: {
        stubs: {
          Dialog: passthrough('Dialog'),
          DialogContent: passthrough('DialogContent'),
          DialogDescription: passthrough('DialogDescription'),
          DialogFooter: passthrough('DialogFooter'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
          DcButton: passthrough('Button'),
          Input: passthrough('Input'),
          Label: passthrough('Label'),
          Spinner: passthrough('Spinner')
        }
      }
    })

    const options = wrapper.findAll('option')
    expect((options[0].element as HTMLOptionElement).selected).toBe(false)
    expect((options[1].element as HTMLOptionElement).selected).toBe(true)
  })
})
