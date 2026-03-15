import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MessageBlockAudio from '@/components/message/MessageBlockAudio.vue'
import MessageBlockImage from '@/components/message/MessageBlockImage.vue'
import MessageBlockMcpUi from '@/components/message/MessageBlockMcpUi.vue'
import type { DisplayAssistantMessageBlock } from '@/components/chat/messageListItems'

const { callToolMock } = vi.hoisted(() => ({
  callToolMock: vi.fn()
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    template: '<i class="icon-stub" />'
  })
}))

vi.mock('@shadcn/components/ui/dialog', () => ({
  Dialog: defineComponent({
    name: 'Dialog',
    template: '<div><slot /></div>'
  }),
  DialogContent: defineComponent({
    name: 'DialogContent',
    template: '<div><slot /></div>'
  }),
  DialogHeader: defineComponent({
    name: 'DialogHeader',
    template: '<div><slot /></div>'
  }),
  DialogTitle: defineComponent({
    name: 'DialogTitle',
    template: '<div><slot /></div>'
  })
}))

vi.mock('@shadcn/components/ui/badge', () => ({
  Badge: defineComponent({
    name: 'Badge',
    template: '<span><slot /></span>'
  })
}))

vi.mock('@/composables/usePresenter', () => ({
  usePresenter: () => ({
    callTool: callToolMock
  })
}))

const createBlock = (
  overrides: Partial<DisplayAssistantMessageBlock> = {}
): DisplayAssistantMessageBlock => ({
  type: 'image',
  status: 'success',
  timestamp: Date.now(),
  ...overrides
})

describe('MessageBlock media', () => {
  beforeEach(() => {
    callToolMock.mockReset()
  })

  it('renders image from image_data url payload', () => {
    const wrapper = mount(MessageBlockImage, {
      props: {
        block: createBlock({
          type: 'image',
          image_data: {
            data: 'https://example.com/image.png',
            mimeType: 'deepchat/image-url'
          }
        })
      }
    })

    expect(wrapper.find('img').attributes('src')).toBe('https://example.com/image.png')
  })

  it('renders image from legacy persisted payload', () => {
    const wrapper = mount(MessageBlockImage, {
      props: {
        block: createBlock({
          type: 'image',
          content: {
            data: 'data:image/png;base64,AAAA',
            mimeType: 'image/png'
          } as never
        })
      }
    })

    expect(wrapper.find('img').attributes('src')).toBe('data:image/png;base64,AAAA')
  })

  it('renders audio from image_data payload', () => {
    const wrapper = mount(MessageBlockAudio, {
      props: {
        block: createBlock({
          type: 'audio',
          image_data: {
            data: 'data:audio/wav;base64,BBBB',
            mimeType: 'audio/wav'
          }
        })
      }
    })

    expect(wrapper.find('audio').attributes('src')).toBe('data:audio/wav;base64,BBBB')
  })

  it('renders audio from legacy persisted payload', () => {
    const wrapper = mount(MessageBlockAudio, {
      props: {
        block: createBlock({
          type: 'audio',
          content: {
            data: 'CCCC',
            mimeType: 'audio/mpeg'
          } as never
        })
      }
    })

    expect(wrapper.find('audio').attributes('src')).toBe('data:audio/mpeg;base64,CCCC')
  })

  it('serializes MCP UI payload and calls tool actions', async () => {
    callToolMock.mockResolvedValue({
      rawData: { ok: true }
    })

    const resource = {
      uri: 'mcp://resource',
      mimeType: 'text/html' as const,
      text: '<div>Hello</div>'
    }
    const wrapper = mount(MessageBlockMcpUi, {
      props: {
        block: createBlock({
          type: 'mcp_ui_resource',
          mcp_ui_resource: resource
        })
      }
    })

    await nextTick()
    await flushPromises()

    const renderer = wrapper.find('ui-resource-renderer')
    const element = renderer.element as HTMLElement & {
      onUIAction?: (action: unknown) => Promise<unknown>
      resource?: string
    }

    expect(wrapper.text()).toContain('mcp://resource')
    expect(element.getAttribute('resource') ?? element.resource).toBe(JSON.stringify(resource))

    await element.onUIAction?.({
      type: 'tool',
      messageId: 'mcp-message',
      payload: {
        toolName: 'demo_tool',
        params: {
          enabled: true
        }
      }
    })

    expect(callToolMock).toHaveBeenCalledWith({
      id: 'mcp-message',
      type: 'function',
      function: {
        name: 'demo_tool',
        arguments: JSON.stringify({
          enabled: true
        })
      }
    })
  })

  it('shows error when MCP UI action misses tool name', async () => {
    const wrapper = mount(MessageBlockMcpUi, {
      props: {
        block: createBlock({
          type: 'mcp_ui_resource',
          mcp_ui_resource: {
            uri: 'mcp://resource',
            mimeType: 'text/html',
            text: '<div>Hello</div>'
          }
        })
      }
    })

    await nextTick()
    await flushPromises()

    const element = wrapper.find('ui-resource-renderer').element as HTMLElement & {
      onUIAction?: (action: unknown) => Promise<unknown>
    }

    await expect(
      element.onUIAction?.({
        type: 'tool',
        payload: {}
      })
    ).rejects.toThrow('Tool name missing in MCP UI action')

    expect(wrapper.text()).toContain('common.error.requestFailed')
  })
})
