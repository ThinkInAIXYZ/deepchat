import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AssistantMessageBlock } from '@shared/chat'
import type { LLMAgentEvent } from '@shared/types/core/agent-events'

/**
 * 消息块数据结构快照测试
 * 确保事件到UI块的映射结构保持一致
 */
describe('Message Block Data Structure Snapshot Tests', () => {
  describe('Block Structure Validation', () => {
    it('should create consistent content block structure', () => {
      const block: AssistantMessageBlock = {
        type: 'content',
        content: 'Hello, this is a test message with **markdown** formatting.',
        status: 'success',
        timestamp: 1704067200000 // Fixed timestamp for consistent snapshots
      }

      expect(block).toMatchSnapshot()
    })

    it('should create consistent reasoning block structure', () => {
      const block: AssistantMessageBlock = {
        type: 'reasoning_content',
        content: 'Let me think about this problem step by step...',
        status: 'success',
        timestamp: 1704067200000,
        reasoning_time: {
          start: 1704067200000,
          end: 1704067205000
        }
      }

      expect(block).toMatchSnapshot()
    })

    it('should create consistent tool call block structure', () => {
      const block: AssistantMessageBlock = {
        type: 'tool_call',
        status: 'loading',
        timestamp: 1704067200000,
        tool_call: {
          id: 'tool-456',
          name: 'searchWeb',
          params: '{"query": "Vue.js testing", "limit": 5}'
        }
      }

      expect(block).toMatchSnapshot()
    })

    it('should create consistent permission request block structure', () => {
      const block: AssistantMessageBlock = {
        type: 'action',
        action_type: 'tool_call_permission',
        status: 'pending',
        timestamp: 1704067200000,
        content: 'Permission required to write file',
        tool_call: {
          id: 'tool-123',
          name: 'writeFile',
          server_name: 'filesystem',
          server_description: 'Local file system access'
        }
      }

      expect(block).toMatchSnapshot()
    })

    it('should create consistent rate limit block structure', () => {
      const block: AssistantMessageBlock = {
        type: 'action',
        action_type: 'rate_limit',
        status: 'pending',
        timestamp: 1704067200000,
        extra: {
          providerId: 'openai',
          qpsLimit: 10,
          currentQps: 15,
          queueLength: 3,
          estimatedWaitTime: 2000
        }
      }

      expect(block).toMatchSnapshot()
    })

    it('should create consistent error block structure', () => {
      const block: AssistantMessageBlock = {
        type: 'error',
        content: 'Network connection failed. Please check your internet connection and try again.',
        status: 'error',
        timestamp: 1704067200000
      }

      expect(block).toMatchSnapshot()
    })

    it('should create consistent image block structure', () => {
      const block: AssistantMessageBlock = {
        type: 'image',
        status: 'success',
        timestamp: 1704067200000,
        image_data: {
          data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          mimeType: 'image/png'
        }
      }

      expect(block).toMatchSnapshot()
    })
  })

  describe('Event-to-Block Mapping Snapshots', () => {
    const fixedNow = 1704067200000

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(fixedNow)
    })

    afterEach(() => {
      vi.useRealTimers()
    })
    it('should map text event to content block consistently', () => {
      const event: LLMAgentEvent = {
        type: 'response',
        data: {
          eventId: 'test-123',
          content: 'Hello world!'
        }
      }

      const block = mapEventToBlock(event)
      expect(block).toMatchSnapshot()
    })

    it('should map reasoning event to reasoning block consistently', () => {
      const event: LLMAgentEvent = {
        type: 'response',
        data: {
          eventId: 'test-123',
          reasoning_content: 'Let me analyze this...'
        }
      }

      const block = mapEventToBlock(event)
      expect(block).toMatchSnapshot()
    })

    it('should map tool call start event consistently', () => {
      const event: LLMAgentEvent = {
        type: 'response',
        data: {
          eventId: 'test-123',
          tool_call: 'start',
          tool_call_id: 'tool-456',
          tool_call_name: 'searchWeb',
          tool_call_params: '{"query": "test"}'
        }
      }

      const block = mapEventToBlock(event)
      expect(block).toMatchSnapshot()
    })

    it('should map permission required event consistently', () => {
      const event: LLMAgentEvent = {
        type: 'response',
        data: {
          eventId: 'test-123',
          tool_call: 'permission-required',
          tool_call_id: 'tool-789',
          tool_call_name: 'writeFile',
          permission_request: {
            toolName: 'writeFile',
            serverName: 'filesystem',
            permissionType: 'write',
            description: 'Write to local file system'
          }
        }
      }

      const block = mapEventToBlock(event)
      expect(block).toMatchSnapshot()
    })

    it('should map rate limit event consistently', () => {
      const event: LLMAgentEvent = {
        type: 'response',
        data: {
          eventId: 'test-123',
          rate_limit: {
            providerId: 'openai',
            qpsLimit: 10,
            currentQps: 15,
            queueLength: 3,
            estimatedWaitTime: 2000
          }
        }
      }

      const block = mapEventToBlock(event)
      expect(block).toMatchSnapshot()
    })

    it('should map error event consistently', () => {
      const event: LLMAgentEvent = {
        type: 'error',
        data: {
          eventId: 'test-123',
          error: 'Network connection failed'
        }
      }

      const block = mapEventToBlock(event)
      expect(block).toMatchSnapshot()
    })
  })

  describe('Status Transition Snapshots', () => {
    it('should create consistent status transition structures', () => {
      const transitions = [
        { from: 'loading', to: 'success' },
        { from: 'loading', to: 'error' },
        { from: 'pending', to: 'granted' },
        { from: 'pending', to: 'denied' }
      ]

      transitions.forEach(({ from, to }) => {
        const transition = { from, to, isValid: isValidStatusTransition(from as any, to as any) }
        expect(transition).toMatchSnapshot(`transition-${from}-to-${to}`)
      })
    })
  })
})

// Helper functions from the contract test
function mapEventToBlock(event: LLMAgentEvent): AssistantMessageBlock {
  const timestamp = Date.now()

  if (event.type === 'error') {
    return {
      type: 'error',
      content: event.data.error,
      status: 'error',
      timestamp
    }
  }

  if (event.type === 'response') {
    const { data } = event

    if (data.content) {
      return {
        type: 'content',
        content: data.content,
        status: 'success',
        timestamp
      }
    }

    if (data.reasoning_content) {
      return {
        type: 'reasoning_content',
        content: data.reasoning_content,
        status: 'success',
        timestamp
      }
    }

    if (data.tool_call) {
      if (data.tool_call === 'start') {
        return {
          type: 'tool_call',
          status: 'loading',
          timestamp,
          tool_call: {
            id: data.tool_call_id,
            name: data.tool_call_name,
            params: data.tool_call_params
          }
        }
      }

      if (data.tool_call === 'permission-required') {
        return {
          type: 'action',
          action_type: 'tool_call_permission',
          status: 'pending',
          timestamp,
          tool_call: {
            id: data.tool_call_id,
            name: data.tool_call_name
          }
        }
      }
    }

    if (data.rate_limit) {
      return {
        type: 'action',
        action_type: 'rate_limit',
        status: 'pending',
        timestamp,
        extra: data.rate_limit as any
      }
    }

    if (data.image_data) {
      return {
        type: 'image',
        status: 'success',
        timestamp,
        image_data: data.image_data
      }
    }
  }

  throw new Error(`Unsupported event: ${JSON.stringify(event)}`)
}

function isValidStatusTransition(
  from: AssistantMessageBlock['status'],
  to: AssistantMessageBlock['status']
): boolean {
  const validTransitions: Record<string, string[]> = {
    loading: ['success', 'error'],
    pending: ['granted', 'denied', 'error'],
    success: [],
    error: [],
    granted: [],
    denied: []
  }

  return validTransitions[from]?.includes(to) ?? false
}
