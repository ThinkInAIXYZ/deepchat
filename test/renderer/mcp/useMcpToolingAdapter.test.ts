import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MCP_EVENTS } from '@/events'
import {
  resolveToolResultKey,
  useMcpToolingAdapter,
  type ToolCallResultPayload
} from '@/composables/mcp/useMcpToolingAdapter'

describe('useMcpToolingAdapter', () => {
  beforeEach(() => {
    const listeners = new Map<string, (payload: ToolCallResultPayload) => void>()
    const ipcRenderer = {
      on: vi.fn(
        (event: string, handler: (event: unknown, payload: ToolCallResultPayload) => void) => {
          listeners.set(event, handler)
        }
      ),
      removeListener: vi.fn(
        (event: string, handler: (event: unknown, payload: ToolCallResultPayload) => void) => {
          const current = listeners.get(event)
          if (current === handler) {
            listeners.delete(event)
          }
        }
      ),
      __listeners: listeners
    }

    ;(window as any).electron = { ipcRenderer }
  })

  it('resolves tool result keys in priority order', () => {
    expect(
      resolveToolResultKey({ toolCallId: 'abc', content: 'ok' } as ToolCallResultPayload)
    ).toBe('abc')
    expect(
      resolveToolResultKey({ function_name: 'tool', content: 'ok' } as ToolCallResultPayload)
    ).toBe('tool')
    expect(resolveToolResultKey({ content: 'ok' } as ToolCallResultPayload)).toBeNull()
  })

  it('subscribes and unsubscribes tool result listeners', () => {
    const adapter = useMcpToolingAdapter()
    const handler = vi.fn()

    const unsubscribe = adapter.subscribeToolResults(handler)

    const ipcRenderer = (window as any).electron.ipcRenderer
    const listener = ipcRenderer.__listeners.get(MCP_EVENTS.TOOL_CALL_RESULT)

    const payload = { toolCallId: 'tool-call-1', content: 'ok' } as ToolCallResultPayload
    listener?.(null, payload)

    expect(handler).toHaveBeenCalledWith(payload)

    unsubscribe()

    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      MCP_EVENTS.TOOL_CALL_RESULT,
      expect.any(Function)
    )
  })
})
