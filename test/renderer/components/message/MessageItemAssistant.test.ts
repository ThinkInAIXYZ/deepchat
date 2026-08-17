import { mount } from '@vue/test-utils'
import { defineComponent, onMounted, onUnmounted } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MessageItemAssistant from '@/components/message/MessageItemAssistant.vue'
import type {
  DisplayAssistantMessage,
  DisplayAssistantMessageBlock
} from '@/features/chat-page/model/displayMessage'

const memoryActivity = vi.hoisted(() => ({
  enabled: false,
  openTurnMemories: vi.fn(),
  rememberSelection: vi.fn()
}))
const notifyRenderer = vi.hoisted(() => vi.fn())

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@/stores/ui/memoryActivity', () => ({
  useMemoryActivityStore: () => memoryActivity
}))

vi.mock('@renderer-notifications/rendererNotificationPort', () => ({
  notifyRenderer
}))

vi.mock('@api/DeviceClient', () => ({
  createDeviceClient: () => ({
    copyText: vi.fn()
  })
}))

vi.mock('@/stores/uiSettingsStore', () => ({
  useUiSettingsStore: () => ({})
}))

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => ({
    isDark: false
  })
}))

vi.mock('@shadcn/components/ui/spinner', () => ({
  Spinner: defineComponent({
    name: 'Spinner',
    template: '<div data-testid="spinner" />'
  })
}))

vi.mock('@dc-ui/components/button', () => ({
  DcButton: defineComponent({
    name: 'Button',
    template: '<button type="button"><slot /></button>'
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
  DialogDescription: defineComponent({
    name: 'DialogDescription',
    template: '<div><slot /></div>'
  }),
  DialogFooter: defineComponent({
    name: 'DialogFooter',
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

vi.mock('@shadcn/components/ui/context-menu', () => ({
  ContextMenu: defineComponent({
    name: 'ContextMenu',
    template: '<div><slot /></div>'
  }),
  ContextMenuContent: defineComponent({
    name: 'ContextMenuContent',
    template: '<div><slot /></div>'
  }),
  ContextMenuItem: defineComponent({
    name: 'ContextMenuItem',
    template: '<div><slot /></div>'
  }),
  ContextMenuSeparator: defineComponent({
    name: 'ContextMenuSeparator',
    template: '<div />'
  }),
  ContextMenuTrigger: defineComponent({
    name: 'ContextMenuTrigger',
    template: '<div><slot /></div>'
  })
}))

const componentStub = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const createMessage = (
  status: 'sent' | 'pending' | 'error',
  content: DisplayAssistantMessage['content'],
  overrides: Partial<DisplayAssistantMessage> = {}
): DisplayAssistantMessage => ({
  id: 'm1',
  role: 'assistant',
  timestamp: 1,
  updatedAt: 1,
  avatar: '',
  name: 'Assistant',
  model_name: 'GPT-4',
  model_id: 'gpt-4',
  model_provider: 'openai',
  status,
  error: '',
  usage: {
    context_usage: 0,
    tokens_per_second: 0,
    total_tokens: 0,
    generation_time: 0,
    first_token_time: 0,
    reasoning_start_time: 0,
    reasoning_end_time: 0,
    input_tokens: 0,
    output_tokens: 0
  },
  conversationId: 's1',
  is_variant: 0,
  orderSeq: 1,
  content,
  ...overrides
})

const createVideoLikeImageBlock = (
  overrides: Partial<DisplayAssistantMessageBlock> = {}
): DisplayAssistantMessageBlock => ({
  type: 'image',
  status: 'success',
  timestamp: 1,
  image_data: {
    data: 'https://example.com/sample.png',
    mimeType: 'image/png'
  },
  ...overrides
})

const createThinkingBlock = (
  overrides: Partial<DisplayAssistantMessageBlock> = {}
): DisplayAssistantMessageBlock => ({
  type: 'reasoning_content',
  content: 'thinking',
  status: 'success',
  timestamp: 1,
  ...overrides
})

const createToolCallBlock = (
  overrides: Partial<DisplayAssistantMessageBlock> = {}
): DisplayAssistantMessageBlock => ({
  type: 'tool_call',
  status: 'success',
  timestamp: 2,
  tool_call: {
    id: 'tc1',
    name: 'read_file'
  },
  ...overrides
})

describe('MessageItemAssistant', () => {
  beforeEach(() => {
    memoryActivity.enabled = false
    memoryActivity.openTurnMemories.mockClear()
    memoryActivity.rememberSelection.mockClear()
    notifyRenderer.mockClear()
  })

  const global = {
    stubs: {
      ModelIcon: componentStub('ModelIcon'),
      MessageInfo: componentStub('MessageInfo'),
      MessageBlockContent: defineComponent({
        name: 'MessageBlockContent',
        props: {
          disableMarkdownVirtualization: {
            type: Boolean,
            default: false
          },
          hiddenMarkdownImageSources: {
            type: Array,
            default: undefined
          }
        },
        template:
          '<div data-testid="message-block-content" :data-disable-markdown-virtualization="String(disableMarkdownVirtualization)" :data-hidden-image-sources="hiddenMarkdownImageSources?.join(\',\')"><slot /></div>'
      }),
      MessageBlockThink: componentStub('MessageBlockThink'),
      MessageBlockSearch: defineComponent({
        name: 'MessageBlockSearch',
        template: '<div data-testid="search-block" />'
      }),
      MessageBlockToolCall: componentStub('MessageBlockToolCall'),
      MessageBlockError: componentStub('MessageBlockError'),
      MessageBlockQuestionRequest: componentStub('MessageBlockQuestionRequest'),
      MessageToolbar: componentStub('MessageToolbar'),
      MessageBlockAction: componentStub('MessageBlockAction'),
      MessageBlockImage: componentStub('MessageBlockImage'),
      MessageBlockVideo: defineComponent({
        name: 'MessageBlockVideo',
        props: {
          block: {
            type: Object,
            required: false
          }
        },
        template: '<div data-testid="video-block" />'
      }),
      MessageBlockAudio: componentStub('MessageBlockAudio'),
      MessageBlockActivityGroup: defineComponent({
        name: 'MessageBlockActivityGroup',
        props: {
          blocks: {
            type: Array,
            required: true
          }
        },
        template:
          '<div data-testid="activity-group" :data-block-count="String(blocks.length)">activity</div>'
      })
    }
  }

  it('renders only normalized provider search blocks with the provider activity UI', () => {
    const legacyBlock: DisplayAssistantMessageBlock = {
      id: 'legacy-search',
      type: 'search',
      status: 'success',
      timestamp: 1,
      extra: { label: 'mcp_web_search', total: 3 }
    }
    const providerBlock: DisplayAssistantMessageBlock = {
      id: 'provider-search',
      type: 'search',
      content: 'DeepChat',
      status: 'success',
      timestamp: 2,
      extra: { actionType: 'search', provider: 'deepseek' }
    }

    const legacy = mount(MessageItemAssistant, {
      props: { message: createMessage('sent', [legacyBlock]), isCapturingImage: false },
      global
    })
    const provider = mount(MessageItemAssistant, {
      props: {
        message: createMessage('sent', [providerBlock]),
        isCapturingImage: false,
        isStreamingMessage: true
      },
      global
    })

    expect(legacy.find('[data-testid="search-block"]').exists()).toBe(false)
    expect(provider.find('[data-testid="search-block"]').exists()).toBe(true)
  })

  it('allows code block hosts to shrink inside the assistant row', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('pending', []),
        isCapturingImage: false
      },
      global
    })

    const contentElement = wrapper.get('[data-message-content="true"]').element
    expect(contentElement.parentElement?.classList.contains('min-w-0')).toBe(true)
  })

  it('does not render a spinner for empty non-pending assistant messages', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('error', []),
        isCapturingImage: false
      },
      global
    })

    expect(wrapper.find('[data-testid="spinner"]').exists()).toBe(false)
  })

  it('renders a spinner for empty pending assistant messages', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('pending', []),
        isCapturingImage: false
      },
      global
    })

    expect(wrapper.find('[data-testid="spinner"]').exists()).toBe(true)
    expect(wrapper.find('[data-message-content="true"]').exists()).toBe(true)
  })

  it('keeps the message content wrapper stable when the first pending content arrives', async () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('pending', []),
        isCapturingImage: false
      },
      global
    })
    const contentWrapper = wrapper.find('[data-message-content="true"]').element

    await wrapper.setProps({
      message: createMessage('pending', [
        {
          type: 'content',
          content: 'first chunk',
          status: 'loading',
          timestamp: 2
        }
      ])
    })

    expect(wrapper.find('[data-testid="spinner"]').exists()).toBe(false)
    expect(wrapper.find('[data-message-content="true"]').element).toBe(contentWrapper)
  })

  it('passes markdown virtualization disable state to message content blocks', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('pending', [
          {
            type: 'content',
            content: 'visible content',
            status: 'loading',
            timestamp: 2
          }
        ]),
        isCapturingImage: false,
        disableMarkdownVirtualization: true
      },
      global
    })

    expect(
      wrapper
        .get('[data-testid="message-block-content"]')
        .attributes('data-disable-markdown-virtualization')
    ).toBe('true')
  })

  it('passes promoted local image sources to content blocks for Markdown deduplication', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('sent', [
          createVideoLikeImageBlock({
            image_data: {
              data: 'imgcache://generated.png',
              mimeType: 'image/png'
            }
          }),
          createVideoLikeImageBlock({
            image_data: {
              data: 'https://example.com/remote.png',
              mimeType: 'image/png'
            }
          }),
          {
            type: 'content',
            content: '![generated](imgcache://generated.png)',
            status: 'success',
            timestamp: 2
          }
        ]),
        isCapturingImage: false
      },
      global
    })

    expect(
      wrapper.get('[data-testid="message-block-content"]').attributes('data-hidden-image-sources')
    ).toBe('imgcache://generated.png')
  })

  it('renders video blocks from legacy content urls', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('sent', [
          createVideoLikeImageBlock({
            content: 'https://example.com/media/generated-video.mp4?download=1',
            image_data: undefined
          })
        ]),
        isCapturingImage: false
      },
      global
    })

    expect(wrapper.find('[data-testid="video-block"]').exists()).toBe(true)
  })

  it('does not classify non-video urls as video blocks when extensions only appear in query text', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('sent', [
          createVideoLikeImageBlock({
            image_data: {
              data: 'https://example.com/assets/preview.png?redirect=.mp4',
              mimeType: 'image/png'
            }
          })
        ]),
        isCapturingImage: false
      },
      global
    })

    expect(wrapper.find('[data-testid="video-block"]').exists()).toBe(false)
  })

  it('does not render persisted plan blocks in assistant message content', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('sent', [
          {
            type: 'plan',
            content: '',
            status: 'success',
            timestamp: 2,
            extra: {
              plan_entries: [{ step: 'Old plan', status: 'in_progress' }],
              plan_revision: 1,
              plan_updated_at: '2026-05-18T00:00:00.000Z'
            }
          }
        ]),
        isCapturingImage: false
      },
      global
    })

    expect(wrapper.text()).not.toContain('Old plan')
  })

  it('renders non-internal tool calls even when they are named update_plan', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('pending', [
          createToolCallBlock({
            tool_call: {
              id: 'external-plan-tool',
              name: 'update_plan'
            }
          })
        ]),
        isCapturingImage: false
      },
      global
    })

    expect(wrapper.findComponent({ name: 'MessageBlockToolCall' }).exists()).toBe(true)
  })

  it('groups completed assistant activity blocks after the turn is settled', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('sent', [createThinkingBlock(), createToolCallBlock()]),
        isCapturingImage: false,
        isInGeneratingThread: false
      },
      global
    })

    expect(wrapper.find('[data-testid="activity-group"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="activity-group"]').attributes('data-block-count')).toBe('2')
    expect(wrapper.findComponent({ name: 'MessageBlockThink' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'MessageBlockToolCall' }).exists()).toBe(false)
  })

  it('does not group activity while the assistant message is pending', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('pending', [createThinkingBlock(), createToolCallBlock()]),
        isCapturingImage: false,
        isInGeneratingThread: true
      },
      global
    })

    expect(wrapper.find('[data-testid="activity-group"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'MessageBlockThink' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'MessageBlockToolCall' }).exists()).toBe(true)
  })

  it('groups sent activity even while the thread is still generating', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('sent', [createThinkingBlock(), createToolCallBlock()]),
        isCapturingImage: false,
        isInGeneratingThread: true
      },
      global
    })

    expect(wrapper.find('[data-testid="activity-group"]').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'MessageBlockThink' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'MessageBlockToolCall' }).exists()).toBe(false)
  })

  it('does not group activity for the actively streaming row', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('sent', [createThinkingBlock(), createToolCallBlock()]),
        isCapturingImage: false,
        isInGeneratingThread: true,
        isStreamingMessage: true
      },
      global
    })

    expect(wrapper.find('[data-testid="activity-group"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'MessageBlockThink' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'MessageBlockToolCall' }).exists()).toBe(true)
  })

  it('renders provider search activity while the row is still streaming', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('pending', [
          {
            id: 'ws_1',
            type: 'search',
            content: 'DeepChat',
            status: 'success',
            timestamp: 2,
            extra: { actionType: 'search', provider: 'deepseek' }
          }
        ]),
        isCapturingImage: false,
        isStreamingMessage: true
      },
      global
    })

    expect(wrapper.find('[data-testid="activity-group"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="search-block"]').exists()).toBe(true)
  })

  it('does not remount an MCP App when live activity becomes grouped', async () => {
    let appMountCount = 0
    let appUnmountCount = 0
    const ToolCallStub = defineComponent({
      name: 'MessageBlockToolCall',
      props: {
        renderMode: {
          type: String,
          default: 'full'
        }
      },
      setup(componentProps) {
        onMounted(() => {
          if (componentProps.renderMode === 'app-only') {
            appMountCount += 1
          }
        })
        onUnmounted(() => {
          if (componentProps.renderMode === 'app-only') {
            appUnmountCount += 1
          }
        })
        return {}
      },
      template: '<div :data-render-mode="renderMode" />'
    })
    const appBlock = createToolCallBlock({
      tool_call: {
        id: 'tc-app',
        name: 'render_chart',
        mcpResult: {
          schemaVersion: 1,
          serverId: 'server-id',
          configGeneration: 1,
          bindingHash: 'binding-hash',
          toolName: 'render_chart',
          app: {
            schemaVersion: 1,
            serverId: 'server-id',
            configGeneration: 1,
            bindingHash: 'binding-hash',
            serverName: 'charts',
            toolName: 'render_chart',
            resourceUri: 'ui://chart/index.html',
            resourceMimeType: 'text/html;profile=mcp-app'
          }
        }
      }
    })
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('sent', [createThinkingBlock(), appBlock]),
        isCapturingImage: false,
        isStreamingMessage: true
      },
      global: {
        ...global,
        stubs: {
          ...global.stubs,
          MessageBlockToolCall: ToolCallStub
        }
      }
    })

    expect(appMountCount).toBe(1)
    expect(wrapper.findAll('[data-render-mode="app-only"]')).toHaveLength(1)

    await wrapper.setProps({ isStreamingMessage: false })

    expect(wrapper.find('[data-testid="activity-group"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-render-mode="app-only"]')).toHaveLength(1)
    expect(appMountCount).toBe(1)
    expect(appUnmountCount).toBe(0)
  })

  it('does not group pending activity when the thread is idle', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('pending', [createThinkingBlock(), createToolCallBlock()]),
        isCapturingImage: false,
        isInGeneratingThread: false
      },
      global
    })

    expect(wrapper.find('[data-testid="activity-group"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'MessageBlockThink' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'MessageBlockToolCall' }).exists()).toBe(true)
  })

  it('excludes internal tool calls from activity groups', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('sent', [
          createThinkingBlock(),
          createToolCallBlock({
            extra: {
              internalTool: true
            },
            tool_call: {
              id: 'tc-plan',
              name: 'update_plan'
            }
          })
        ]),
        isCapturingImage: false,
        isInGeneratingThread: false
      },
      global
    })

    expect(wrapper.find('[data-testid="activity-group"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="activity-group"]').attributes('data-block-count')).toBe('1')
    expect(wrapper.findComponent({ name: 'MessageBlockToolCall' }).exists()).toBe(false)
  })

  it('opens turn memories with the primary assistant message id when a variant is selected', async () => {
    memoryActivity.enabled = true
    const variant = createMessage('sent', [createThinkingBlock({ content: 'variant thinking' })], {
      id: 'assistant-variant',
      is_variant: 1
    })
    const message = createMessage('sent', [createThinkingBlock({ content: 'primary thinking' })], {
      id: 'assistant-primary',
      variants: [variant]
    })
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message,
        isCapturingImage: false
      },
      global: {
        ...global,
        stubs: {
          ...global.stubs,
          MessageToolbar: defineComponent({
            name: 'MessageToolbar',
            emits: ['next', 'memory'],
            template:
              '<div><button data-testid="next" @click="$emit(\'next\')" /><button data-testid="memory" @click="$emit(\'memory\')" /></div>'
          })
        }
      }
    })

    await wrapper.find('[data-testid="next"]').trigger('click')
    await wrapper.find('[data-testid="memory"]').trigger('click')

    expect(memoryActivity.openTurnMemories).toHaveBeenCalledWith('assistant-primary')
    expect(memoryActivity.openTurnMemories).not.toHaveBeenCalledWith('assistant-variant')
  })

  it('does not open turn memories when read-only mode emits a memory action defensively', async () => {
    memoryActivity.enabled = true
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage('sent', [createThinkingBlock()], { id: 'assistant-primary' }),
        isCapturingImage: false,
        isReadOnly: true
      },
      global: {
        ...global,
        stubs: {
          ...global.stubs,
          MessageToolbar: defineComponent({
            name: 'MessageToolbar',
            emits: ['memory'],
            template: '<button data-testid="memory" @click="$emit(\'memory\')" />'
          })
        }
      }
    })

    await wrapper.find('[data-testid="memory"]').trigger('click')

    expect(memoryActivity.openTurnMemories).not.toHaveBeenCalled()
  })

  it('projects a guard stop from metadata and continues without showing the raw error', async () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage(
          'error',
          [
            {
              type: 'error',
              status: 'error',
              timestamp: 1,
              content: 'Agent stopped after four identical tool batches produced no progress.'
            }
          ],
          { runStopReason: 'no_progress' }
        ),
        isCapturingImage: false,
        allowGuardStopContinue: true
      },
      global
    })

    expect(wrapper.find('[data-testid="guard-stop-banner"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('chat.guardStop.noProgress')
    expect(wrapper.findComponent({ name: 'MessageBlockError' }).exists()).toBe(false)

    await wrapper.find('[data-testid="guard-stop-continue"]').trigger('click')
    expect(wrapper.emitted('continue')).toEqual([['s1', 'm1']])
  })

  it('keeps historical guard-stop copy without a continue button', () => {
    const wrapper = mount(MessageItemAssistant, {
      props: {
        message: createMessage(
          'error',
          [
            {
              type: 'error',
              status: 'error',
              timestamp: 1,
              content: 'Agent stopped after four identical tool batches produced no progress.'
            }
          ],
          { runStopReason: 'no_progress' }
        ),
        isCapturingImage: false,
        allowGuardStopContinue: false
      },
      global
    })

    expect(wrapper.find('[data-testid="guard-stop-banner"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="guard-stop-continue"]').exists()).toBe(false)
  })

  describe('resolved permission projection', () => {
    const createPermissionActionBlock = (
      status: DisplayAssistantMessageBlock['status'],
      toolCallId = 'tc1'
    ): DisplayAssistantMessageBlock => ({
      type: 'action',
      action_type: 'tool_call_permission',
      status,
      timestamp: 1,
      tool_call: { id: toolCallId, name: 'run_command' }
    })

    const ToolCallStub = defineComponent({
      name: 'MessageBlockToolCall',
      props: {
        permissionStatus: {
          type: String,
          default: undefined
        }
      },
      template:
        '<div data-testid="tool-call-stub" :data-permission-status="permissionStatus ?? \'\'" />'
    })

    const mountWith = (content: DisplayAssistantMessageBlock[]) =>
      mount(MessageItemAssistant, {
        props: {
          message: createMessage('pending', content),
          isCapturingImage: false,
          isInGeneratingThread: true
        },
        global: {
          ...global,
          stubs: {
            ...global.stubs,
            MessageBlockToolCall: ToolCallStub
          }
        }
      })

    it('merges the granted outcome into the tool card and hides the action card', () => {
      const wrapper = mountWith([
        createPermissionActionBlock('granted'),
        createToolCallBlock({ tool_call: { id: 'tc1', name: 'run_command' } })
      ])

      expect(wrapper.findComponent({ name: 'MessageBlockAction' }).exists()).toBe(false)
      expect(
        wrapper.find('[data-testid="tool-call-stub"]').attributes('data-permission-status')
      ).toBe('granted')
    })

    it('merges the denied outcome into the tool card', () => {
      const wrapper = mountWith([
        createPermissionActionBlock('denied'),
        createToolCallBlock({ tool_call: { id: 'tc1', name: 'run_command' } })
      ])

      expect(wrapper.findComponent({ name: 'MessageBlockAction' }).exists()).toBe(false)
      expect(
        wrapper.find('[data-testid="tool-call-stub"]').attributes('data-permission-status')
      ).toBe('denied')
    })

    it('merges the outcome only into the tool call with the matching id', () => {
      const wrapper = mountWith([
        createPermissionActionBlock('granted', 'tc2'),
        createToolCallBlock({ tool_call: { id: 'tc1', name: 'run_command' } }),
        createToolCallBlock({ tool_call: { id: 'tc2', name: 'write_file' } })
      ])

      expect(wrapper.findComponent({ name: 'MessageBlockAction' }).exists()).toBe(false)
      const stubs = wrapper.findAll('[data-testid="tool-call-stub"]')
      expect(stubs).toHaveLength(2)
      expect(stubs[0].attributes('data-permission-status')).toBe('')
      expect(stubs[1].attributes('data-permission-status')).toBe('granted')
    })

    it('keeps the standalone action card when the tool card is missing', () => {
      const wrapper = mountWith([createPermissionActionBlock('denied', 'tc-missing')])

      expect(wrapper.findComponent({ name: 'MessageBlockAction' }).exists()).toBe(true)
    })

    it('keeps pending permission action blocks visible and unmerged', () => {
      const wrapper = mountWith([
        createPermissionActionBlock('pending'),
        createToolCallBlock({ tool_call: { id: 'tc1', name: 'run_command' } })
      ])

      expect(wrapper.findComponent({ name: 'MessageBlockAction' }).exists()).toBe(true)
      expect(
        wrapper.find('[data-testid="tool-call-stub"]').attributes('data-permission-status')
      ).toBe('')
    })
  })
})
