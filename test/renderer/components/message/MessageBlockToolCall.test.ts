import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import MessageBlockToolCall from '@/components/message/MessageBlockToolCall.vue'
import type { DisplayAssistantMessageBlock } from '@/components/chat/messageListItems'

const originalResizeObserver = globalThis.ResizeObserver
let resizeObserverCallback: ResizeObserverCallback | null = null
const { selectSessionMock } = vi.hoisted(() => ({
  selectSessionMock: vi.fn()
}))

class MockResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback
  }

  observe() {}

  unobserve() {}

  disconnect() {}
}

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: { count?: number; mode?: string }) => {
      if (key === 'toolCall.replacementsCount') {
        return `${params?.count ?? 0} replacements`
      }
      if (key === 'toolCall.badge.rtk') {
        return 'RTK'
      }
      if (key === 'chat.toolCall.subagents.summary') {
        return `${params?.mode ?? 'mode'} · ${params?.count ?? 0} localized subagents`
      }
      if (key === 'chat.toolCall.subagents.mode.parallel') {
        return 'localized parallel'
      }
      if (key === 'chat.toolCall.subagents.mode.chain') {
        return 'localized chain'
      }
      if (key === 'chat.toolCall.subagents.status.running') {
        return 'localized running'
      }
      if (key === 'chat.toolCall.subagents.status.waiting_permission') {
        return 'localized waiting permission'
      }
      if (key === 'chat.toolCall.subagents.status.completed') {
        return 'localized completed'
      }
      if (key === 'chat.toolCall.subagents.unnamedTask') {
        return 'Unnamed Task'
      }
      if (key === 'settings.deepchatAgents.unnamed') {
        return 'Unnamed Agent'
      }
      return key
    }
  })
}))

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => ({
    isDark: false
  })
}))

vi.mock('@/stores/ui/session', () => ({
  useSessionStore: () => ({
    selectSession: selectSessionMock
  })
}))

vi.mock('markstream-vue', () => ({
  CodeBlockNode: defineComponent({
    name: 'CodeBlockNode',
    props: {
      node: {
        type: Object,
        required: true
      },
      isDark: {
        type: Boolean,
        default: false
      },
      showHeader: {
        type: Boolean,
        default: true
      }
    },
    template: '<div class="code-block-stub"></div>'
  })
}))

const createBlock = (
  overrides: Partial<DisplayAssistantMessageBlock> = {}
): DisplayAssistantMessageBlock => ({
  type: 'tool_call',
  status: 'success',
  timestamp: Date.now(),
  ...overrides,
  tool_call: {
    name: 'edit_text',
    response: '',
    ...(overrides.tool_call ?? {})
  }
})

beforeEach(() => {
  resizeObserverCallback = null
  selectSessionMock.mockReset()
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
})

afterEach(() => {
  if (originalResizeObserver) {
    globalThis.ResizeObserver = originalResizeObserver
    return
  }

  delete (globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserver })
    .ResizeObserver
})

describe('MessageBlockToolCall', () => {
  it('renders diff response with CodeBlockNode', async () => {
    const response = JSON.stringify({
      success: true,
      originalCode: 'alpha\nbeta',
      updatedCode: 'alpha\ngamma',
      replacements: 1,
      language: 'typescript'
    })
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          tool_call: { name: 'edit_text', response }
        })
      }
    })

    await wrapper.find('div.inline-flex').trigger('click')

    const codeBlock = wrapper.findComponent({ name: 'CodeBlockNode' })
    expect(codeBlock.exists()).toBe(true)
    expect(codeBlock.props('node')).toMatchObject({
      diff: true,
      language: 'typescript',
      originalCode: 'alpha\nbeta',
      updatedCode: 'alpha\ngamma'
    })
  })

  it('falls back to preformatted text for non-diff responses', async () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          tool_call: { name: 'other_tool', response: 'plain output' }
        })
      }
    })

    await wrapper.find('div.inline-flex').trigger('click')

    expect(wrapper.findComponent({ name: 'CodeBlockNode' }).exists()).toBe(false)
    expect(wrapper.find('pre').text()).toContain('plain output')
  })

  it('shows the first string parameter value as summary text', () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          tool_call: {
            name: 'read',
            params: '{"path":"C:/repo/src/main.ts","line":1}'
          }
        })
      }
    })

    expect(wrapper.get('[data-testid="tool-call-summary"]').text()).toBe('C:/repo/src/main.ts')
  })

  it('uses the first query value as summary text', () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          tool_call: {
            name: 'search',
            params: '{"query":"today bilibili hot videos","limit":10}'
          }
        })
      }
    })

    expect(wrapper.get('[data-testid="tool-call-summary"]').text()).toBe(
      'today bilibili hot videos'
    )
    expect(wrapper.get('[data-testid="tool-call-name"]').classes()).toContain('shrink-0')
  })

  it('stringifies nested first parameter values into a single-line summary', () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          tool_call: {
            name: 'custom_tool',
            params: '{"payload":{"foo":"bar","nested":{"ok":true}},"other":1}'
          }
        })
      }
    })

    expect(wrapper.get('[data-testid="tool-call-summary"]').text()).toBe(
      '{"foo":"bar","nested":{"ok":true}}'
    )
  })

  it('falls back to raw params when the summary source is not JSON', () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          tool_call: {
            name: 'exec',
            params: 'raw-shell-command --flag value'
          }
        })
      }
    })

    expect(wrapper.get('[data-testid="tool-call-summary"]').text()).toBe(
      'raw-shell-command --flag value'
    )
  })

  it('only adds the summary fade when the text actually overflows', async () => {
    const summaryValue = 'C:/workspace/' + 'nested/'.repeat(8) + 'MessageBlockToolCall.vue'
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          tool_call: {
            name: 'exec',
            params: JSON.stringify({
              cwd: summaryValue
            })
          }
        })
      }
    })

    const summary = wrapper.get('[data-testid="tool-call-summary"]')

    expect(summary.classes()).not.toContain('tool-call-summary--overflowing')

    Object.defineProperty(summary.element, 'clientWidth', {
      configurable: true,
      value: 80
    })
    Object.defineProperty(summary.element, 'scrollWidth', {
      configurable: true,
      value: 160
    })

    resizeObserverCallback?.([] as ResizeObserverEntry[], {} as ResizeObserver)
    await nextTick()

    expect(summary.classes()).toContain('tool-call-summary--overflowing')
    expect(summary.attributes('title')).toBe(summaryValue)
  })

  it('keeps the collapsed label to tool name only even when a server name exists', () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          tool_call: {
            name: 'exec',
            server_name: 'agent-filesystem',
            params: '{"command":"pnpm run dev"}'
          }
        })
      }
    })

    expect(wrapper.get('[data-testid="tool-call-name"]').text()).toBe('exec')
    expect(wrapper.find('[data-testid="tool-call-expanded-title"]').exists()).toBe(false)
  })

  it('shows the server-qualified title only inside the expanded panel', async () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          tool_call: {
            name: 'exec',
            server_name: 'agent/agent-filesystem',
            params: '{"command":"pnpm run dev"}',
            response: 'ok'
          }
        })
      }
    })

    await wrapper.get('[data-testid="tool-call-trigger"]').trigger('click')

    expect(wrapper.get('[data-testid="tool-call-expanded-title"]').text()).toContain(
      'agent-filesystem.exec'
    )
  })

  it('shows an RTK badge for command-style tool calls when RTK was applied', () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          tool_call: {
            name: 'exec',
            response: 'ok',
            rtkApplied: true,
            rtkMode: 'rewrite'
          }
        })
      }
    })

    expect(wrapper.find('[data-testid="tool-call-rtk-badge"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tool-call-rtk-badge"]').text()).toBe('RTK')
  })

  it('shows summary text alongside the RTK badge', () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          tool_call: {
            name: 'exec',
            params: '{"command":"pnpm run dev","background":true}',
            rtkApplied: true,
            rtkMode: 'rewrite'
          }
        })
      }
    })

    expect(wrapper.get('[data-testid="tool-call-summary"]').text()).toBe('pnpm run dev')
    expect(wrapper.get('[data-testid="tool-call-rtk-badge"]').text()).toBe('RTK')
  })

  it('renders raw params in the expanded panel', async () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          tool_call: {
            name: 'exec',
            params: '{"command":"pnpm run dev","background":true}',
            response: 'ok'
          }
        })
      }
    })

    await wrapper.get('[data-testid="tool-call-trigger"]').trigger('click')

    const paramsPanel = wrapper.get('[data-testid="tool-call-params"]').text()

    expect(paramsPanel).toBe('{"command":"pnpm run dev","background":true}')
    expect(paramsPanel).toContain('pnpm run dev')
    expect(paramsPanel).toContain('"background":true')
    expect(paramsPanel).toContain('"command":"pnpm run dev"')
  })

  it('renders a dedicated running ring instead of the legacy pulse icon', () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          status: 'loading',
          tool_call: {
            name: 'exec',
            params: '{"command":"pnpm run dev"}'
          }
        })
      }
    })

    expect(wrapper.find('[data-testid="tool-call-running-indicator"]').exists()).toBe(true)
    expect(wrapper.html()).not.toContain('animate-pulse')
  })

  it('auto expands process tool calls while loading and collapses them when finished', async () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          status: 'loading',
          tool_call: {
            id: 'process-1',
            name: 'process',
            params: '{"action":"poll","sessionId":"session-1"}',
            response: 'still running'
          }
        })
      }
    })

    await nextTick()
    expect(wrapper.find('[data-testid="tool-call-details"]').exists()).toBe(true)

    await wrapper.setProps({
      block: createBlock({
        status: 'success',
        tool_call: {
          id: 'process-1',
          name: 'process',
          params: '{"action":"poll","sessionId":"session-1"}',
          response: 'done'
        }
      })
    })
    await nextTick()

    expect(wrapper.find('[data-testid="tool-call-details"]').exists()).toBe(false)
  })

  it('auto expands background exec calls while loading and collapses them when finished', async () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          status: 'loading',
          tool_call: {
            id: 'exec-bg-1',
            name: 'exec',
            params: '{"command":"pnpm run dev","background":true}',
            response: 'booting'
          }
        })
      }
    })

    await nextTick()
    expect(wrapper.find('[data-testid="tool-call-details"]').exists()).toBe(true)

    await wrapper.setProps({
      block: createBlock({
        status: 'success',
        tool_call: {
          id: 'exec-bg-1',
          name: 'exec',
          params: '{"command":"pnpm run dev","background":true}',
          response: 'done'
        }
      })
    })
    await nextTick()

    expect(wrapper.find('[data-testid="tool-call-details"]').exists()).toBe(false)
  })

  it('auto expands background skill_run calls while loading and collapses them when finished', async () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          status: 'loading',
          tool_call: {
            id: 'skill-run-bg-1',
            name: 'skill_run',
            params: '{"skill":"checks","script":"scripts/run.ts","background":true}',
            response: 'booting'
          }
        })
      }
    })

    await nextTick()
    expect(wrapper.find('[data-testid="tool-call-details"]').exists()).toBe(true)

    await wrapper.setProps({
      block: createBlock({
        status: 'success',
        tool_call: {
          id: 'skill-run-bg-1',
          name: 'skill_run',
          params: '{"skill":"checks","script":"scripts/run.ts","background":true}',
          response: 'done'
        }
      })
    })
    await nextTick()

    expect(wrapper.find('[data-testid="tool-call-details"]').exists()).toBe(false)
  })

  it('auto expands exec calls with a long timeout', async () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          status: 'loading',
          tool_call: {
            id: 'exec-timeout-1',
            name: 'exec',
            params: '{"command":"pnpm test","timeoutMs":10000}',
            response: 'running'
          }
        })
      }
    })

    await nextTick()

    expect(wrapper.find('[data-testid="tool-call-details"]').exists()).toBe(true)
  })

  it('auto expands skill_run calls with a long timeout', async () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          status: 'loading',
          tool_call: {
            id: 'skill-run-timeout-1',
            name: 'skill_run',
            params: '{"skill":"checks","script":"scripts/run.ts","timeoutMs":10000}',
            response: 'running'
          }
        })
      }
    })

    await nextTick()

    expect(wrapper.find('[data-testid="tool-call-details"]').exists()).toBe(true)
  })

  it('auto expands renamed exec tool calls that keep the exec contract', async () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          status: 'loading',
          tool_call: {
            id: 'exec-renamed-1',
            name: 'agent-filesystem_exec',
            params: '{"command":"pnpm run dev","background":true}',
            response: 'booting'
          }
        })
      }
    })

    await nextTick()

    expect(wrapper.find('[data-testid="tool-call-details"]').exists()).toBe(true)
  })

  it('auto expands renamed process tool calls while loading and collapses them when finished', async () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          status: 'loading',
          tool_call: {
            id: 'process-renamed-1',
            name: 'agent-filesystem_process',
            params: '{"action":"poll","sessionId":"session-1"}',
            response: 'still running'
          }
        })
      }
    })

    await nextTick()
    expect(wrapper.find('[data-testid="tool-call-details"]').exists()).toBe(true)

    await wrapper.setProps({
      block: createBlock({
        status: 'success',
        tool_call: {
          id: 'process-renamed-1',
          name: 'agent-filesystem_process',
          params: '{"action":"poll","sessionId":"session-1"}',
          response: 'done'
        }
      })
    })
    await nextTick()

    expect(wrapper.find('[data-testid="tool-call-details"]').exists()).toBe(false)
  })

  it('re-applies auto expand when the loading tool call identity changes', async () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          status: 'loading',
          tool_call: {
            id: 'exec-bg-identity-1',
            name: 'exec',
            params: '{"background":true}',
            response: 'booting'
          }
        })
      }
    })

    await nextTick()
    expect(wrapper.find('[data-testid="tool-call-details"]').exists()).toBe(true)

    await wrapper.setProps({
      block: createBlock({
        status: 'loading',
        tool_call: {
          id: 'exec-bg-identity-2',
          name: 'exec',
          params: '{"background":true}',
          response: 'still booting'
        }
      })
    })
    await nextTick()

    expect(wrapper.find('[data-testid="tool-call-details"]').exists()).toBe(true)
  })

  it('does not re-auto-expand after the user manually closes an auto-expanded block', async () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          status: 'loading',
          tool_call: {
            id: 'process-2',
            name: 'process',
            params: '{"action":"log","sessionId":"session-2"}',
            response: 'line 1'
          }
        })
      }
    })

    await nextTick()
    expect(wrapper.find('[data-testid="tool-call-details"]').exists()).toBe(true)

    await wrapper.get('[data-testid="tool-call-trigger"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="tool-call-details"]').exists()).toBe(false)

    await wrapper.setProps({
      block: createBlock({
        status: 'loading',
        tool_call: {
          id: 'process-2',
          name: 'process',
          params: '{"action":"log","sessionId":"session-2"}',
          response: 'line 1\nline 2'
        }
      })
    })
    await nextTick()

    expect(wrapper.find('[data-testid="tool-call-details"]').exists()).toBe(false)
  })

  it('localizes subagent orchestrator summary and statuses', async () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          status: 'loading',
          tool_call: {
            id: 'subagent-1',
            name: 'subagent_orchestrator',
            params: '{"mode":"parallel"}',
            response: ''
          },
          extra: {
            subagentProgress: JSON.stringify({
              runId: 'run-1',
              mode: 'parallel',
              tasks: [
                {
                  taskId: 'task-1',
                  title: 'Inspect repo',
                  slotId: 'slot-1',
                  sessionId: 'child-1',
                  targetAgentName: 'ACP Coder',
                  status: 'running',
                  previewMarkdown: 'line 1'
                },
                {
                  taskId: 'task-2',
                  title: 'Request approval',
                  slotId: 'slot-2',
                  sessionId: 'child-2',
                  targetAgentName: 'Self Clone',
                  status: 'waiting_permission',
                  previewMarkdown: 'line 2'
                }
              ]
            })
          }
        })
      }
    })

    await nextTick()

    expect(wrapper.text()).toContain('localized parallel · 2 localized subagents')
    expect(wrapper.text()).toContain('localized running')
    expect(wrapper.text()).toContain('localized waiting permission')
    expect(wrapper.findAll('[data-testid="subagent-task-trigger"]')).toHaveLength(2)
    expect(wrapper.text()).not.toContain('line 1')
    expect(wrapper.text()).not.toContain('line 2')
    expect(wrapper.text()).not.toContain('common.open')

    await wrapper.get('[data-testid="subagent-task-trigger"]').trigger('click')

    expect(selectSessionMock).toHaveBeenCalledWith('child-1')
  })

  it('normalizes subagent task identifiers and fallback labels', async () => {
    const wrapper = mount(MessageBlockToolCall, {
      props: {
        block: createBlock({
          status: 'loading',
          tool_call: {
            id: 'subagent-2',
            name: 'subagent_orchestrator',
            params: '{"mode":"parallel"}',
            response: ''
          },
          extra: {
            subagentProgress: JSON.stringify({
              runId: 'run-2',
              mode: 'parallel',
              tasks: [
                {
                  slotId: 'slot-alpha',
                  displayName: 'Planner',
                  sessionId: 'child-alpha',
                  status: 'running'
                },
                {
                  slotId: 'slot-beta',
                  sessionId: null,
                  status: 'completed'
                },
                {
                  sessionId: null,
                  status: 'completed'
                }
              ]
            })
          }
        })
      }
    })

    await nextTick()

    const tasks = wrapper.findAll('[data-testid="subagent-task-trigger"]')
    expect(tasks).toHaveLength(3)
    expect(tasks[0].text()).toContain('Planner')
    expect(tasks[1].text()).toContain('Unnamed Agent')
    expect(tasks[1].text()).toContain('slot-beta')
    expect(tasks[2].text()).toContain('Unnamed Agent')
    expect(tasks[2].text()).toContain('Unnamed Task')

    await tasks[0].trigger('click')

    expect(selectSessionMock).toHaveBeenCalledWith('child-alpha')
  })
})
