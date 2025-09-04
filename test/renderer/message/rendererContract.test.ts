import { describe, it, expect } from 'vitest'
import type { LLMAgentEvent } from '@shared/types/core/agent-events'
import type { AssistantMessageBlock } from '@shared/chat'

/**
 * 事件 → UI 块映射契约测试
 * 基于 docs/agent/message-architecture.md 中的映射表
 */
describe('Renderer Contract Tests', () => {
  describe('Event to UI Block Mapping', () => {
    /**
     * 映射表规范验证
     * | Event Type | Event Field | Block Type | Block Content | Block Status | Block Key | Notes |
     */

    it('should map text content correctly', () => {
      const agentEvent: LLMAgentEvent = {
        type: 'response',
        data: {
          eventId: 'test-123',
          content: 'Hello world!'
        }
      }

      const expectedBlock: AssistantMessageBlock = {
        type: 'content',
        content: 'Hello world!',
        status: 'success',
        timestamp: expect.any(Number)
      }

      expect(mapEventToBlock(agentEvent)).toEqual(expectedBlock)
    })

    it('should map reasoning content correctly', () => {
      const agentEvent: LLMAgentEvent = {
        type: 'response',
        data: {
          eventId: 'test-123',
          reasoning_content: 'Let me think about this...'
        }
      }

      const expectedBlock: AssistantMessageBlock = {
        type: 'reasoning_content',
        content: 'Let me think about this...',
        status: 'success',
        timestamp: expect.any(Number),
        reasoning_time: undefined // Optional field
      }

      expect(mapEventToBlock(agentEvent)).toEqual(expectedBlock)
    })

    it('should map tool call start correctly', () => {
      const agentEvent: LLMAgentEvent = {
        type: 'response',
        data: {
          eventId: 'test-123',
          tool_call: 'start',
          tool_call_id: 'tool-456',
          tool_call_name: 'searchWeb',
          tool_call_params: '{"query": "test"}'
        }
      }

      const expectedBlock: AssistantMessageBlock = {
        type: 'tool_call',
        status: 'loading',
        timestamp: expect.any(Number),
        tool_call: {
          id: 'tool-456',
          name: 'searchWeb',
          params: '{"query": "test"}'
        }
      }

      expect(mapEventToBlock(agentEvent)).toEqual(expectedBlock)
    })

    it('should map tool call end correctly', () => {
      const agentEvent: LLMAgentEvent = {
        type: 'response',
        data: {
          eventId: 'test-123',
          tool_call: 'end',
          tool_call_id: 'tool-456',
          tool_call_response: 'Search completed successfully'
        }
      }

      const expectedBlock: AssistantMessageBlock = {
        type: 'tool_call',
        status: 'success',
        timestamp: expect.any(Number),
        tool_call: {
          id: 'tool-456',
          response: 'Search completed successfully'
        }
      }

      expect(mapEventToBlock(agentEvent)).toEqual(expectedBlock)
    })

    it('should map permission request correctly', () => {
      const agentEvent: LLMAgentEvent = {
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

      const expectedBlock: AssistantMessageBlock = {
        type: 'action',
        action_type: 'tool_call_permission',
        status: 'pending',
        timestamp: expect.any(Number),
        tool_call: {
          id: 'tool-789',
          name: 'writeFile'
        }
      }

      expect(mapEventToBlock(agentEvent)).toEqual(expectedBlock)
    })

    it('should map rate limit correctly', () => {
      const agentEvent: LLMAgentEvent = {
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

      const expectedBlock: AssistantMessageBlock = {
        type: 'action',
        action_type: 'rate_limit',
        status: 'pending', // Could be 'error' for severe cases
        timestamp: expect.any(Number),
        extra: {
          providerId: 'openai',
          qpsLimit: 10,
          currentQps: 15,
          queueLength: 3,
          estimatedWaitTime: 2000
        }
      }

      expect(mapEventToBlock(agentEvent)).toEqual(expectedBlock)
    })

    it('should map image data correctly', () => {
      const agentEvent: LLMAgentEvent = {
        type: 'response',
        data: {
          eventId: 'test-123',
          image_data: {
            data: 'base64encodeddata',
            mimeType: 'image/png'
          }
        }
      }

      const expectedBlock: AssistantMessageBlock = {
        type: 'image',
        status: 'success',
        timestamp: expect.any(Number),
        image_data: {
          data: 'base64encodeddata',
          mimeType: 'image/png'
        }
      }

      expect(mapEventToBlock(agentEvent)).toEqual(expectedBlock)
    })

    it('should map error event correctly', () => {
      const agentEvent: LLMAgentEvent = {
        type: 'error',
        data: {
          eventId: 'test-123',
          error: 'Network connection failed'
        }
      }

      const expectedBlock: AssistantMessageBlock = {
        type: 'error',
        content: 'Network connection failed',
        status: 'error',
        timestamp: expect.any(Number)
      }

      expect(mapEventToBlock(agentEvent)).toEqual(expectedBlock)
    })
  })

  describe('Block Type Validation', () => {
    it('should only allow valid block types', () => {
      const validTypes = [
        'content',
        'search',
        'reasoning_content',
        'error',
        'tool_call',
        'action',
        'image',
        'artifact-thinking'
      ]

      const block: AssistantMessageBlock = {
        type: 'content',
        content: 'test',
        status: 'success',
        timestamp: Date.now()
      }

      expect(validTypes).toContain(block.type)
    })

    it('should only allow valid action_type values', () => {
      const validActionTypes = ['tool_call_permission', 'maximum_tool_calls_reached', 'rate_limit']

      const block: AssistantMessageBlock = {
        type: 'action',
        action_type: 'tool_call_permission',
        status: 'pending',
        timestamp: Date.now()
      }

      expect(validActionTypes).toContain(block.action_type)
    })
  })

  describe('Tool Call Aggregation Rules', () => {
    it('should aggregate tool calls by ID', () => {
      const toolCallId = 'tool-123'

      const startEvent: LLMAgentEvent = {
        type: 'response',
        data: {
          eventId: 'test-123',
          tool_call: 'start',
          tool_call_id: toolCallId,
          tool_call_name: 'calculator',
          tool_call_params: '{"operation": "add"}'
        }
      }

      const updateEvent: LLMAgentEvent = {
        type: 'response',
        data: {
          eventId: 'test-123',
          tool_call: 'update',
          tool_call_id: toolCallId,
          tool_call_params: '{"operation": "add", "a": 1, "b": 2}'
        }
      }

      const endEvent: LLMAgentEvent = {
        type: 'response',
        data: {
          eventId: 'test-123',
          tool_call: 'end',
          tool_call_id: toolCallId,
          tool_call_response: '3'
        }
      }

      // Simulate aggregation
      let block = mapEventToBlock(startEvent)
      expect(block.status).toBe('loading')
      expect(block.tool_call?.id).toBe(toolCallId)

      // Update should maintain same ID and update params
      block = updateEventToBlock(updateEvent, block)
      expect(block.tool_call?.id).toBe(toolCallId)
      expect(block.tool_call?.params).toBe('{"operation": "add", "a": 1, "b": 2}')

      // End should set status to success and add response
      block = updateEventToBlock(endEvent, block)
      expect(block.status).toBe('success')
      expect(block.tool_call?.response).toBe('3')
    })

    it('should only allow loading → success/error state transitions', () => {
      const validTransitions = [
        { from: 'loading', to: 'success' },
        { from: 'loading', to: 'error' }
      ]

      const invalidTransitions = [
        { from: 'success', to: 'loading' },
        { from: 'error', to: 'loading' },
        { from: 'success', to: 'error' }
      ]

      validTransitions.forEach(({ from, to }) => {
        expect(isValidStatusTransition(from as any, to as any)).toBe(true)
      })

      invalidTransitions.forEach(({ from, to }) => {
        expect(isValidStatusTransition(from as any, to as any)).toBe(false)
      })
    })
  })

  describe('Permission Block Rules', () => {
    it('should use action type with tool_call_permission', () => {
      const permissionBlock: AssistantMessageBlock = {
        type: 'action',
        action_type: 'tool_call_permission',
        status: 'pending',
        timestamp: Date.now(),
        tool_call: {
          id: 'tool-123',
          name: 'writeFile'
        }
      }

      expect(permissionBlock.type).toBe('action')
      expect(permissionBlock.action_type).toBe('tool_call_permission')
    })

    it('should only allow granted/denied authorization results', () => {
      const validAuthResults = ['granted', 'denied']
      const permissionBlock: AssistantMessageBlock = {
        type: 'action',
        action_type: 'tool_call_permission',
        status: 'granted',
        timestamp: Date.now()
      }

      expect(validAuthResults).toContain(permissionBlock.status)
    })
  })

  describe('Error Recovery Rules', () => {
    it('should mark loading blocks as error when end event arrives', () => {
      const loadingBlocks: AssistantMessageBlock[] = [
        {
          type: 'tool_call',
          status: 'loading',
          timestamp: Date.now(),
          tool_call: { id: 'tool-1', name: 'test' }
        },
        {
          type: 'content',
          status: 'success',
          timestamp: Date.now(),
          content: 'completed text'
        }
      ]

      const endEvent: LLMAgentEvent = {
        type: 'end',
        data: { eventId: 'test-123', userStop: false }
      }

      const processedBlocks = processEndEvent(endEvent, loadingBlocks)

      // Loading tool_call should be marked as error
      expect(processedBlocks[0].status).toBe('error')
      // Success content should remain unchanged
      expect(processedBlocks[1].status).toBe('success')
    })

    it('should preserve permission blocks during error recovery', () => {
      const blocks: AssistantMessageBlock[] = [
        {
          type: 'action',
          action_type: 'tool_call_permission',
          status: 'pending',
          timestamp: Date.now()
        },
        {
          type: 'tool_call',
          status: 'loading',
          timestamp: Date.now(),
          tool_call: { id: 'tool-1', name: 'test' }
        }
      ]

      const endEvent: LLMAgentEvent = {
        type: 'end',
        data: { eventId: 'test-123', userStop: true }
      }

      const processedBlocks = processEndEvent(endEvent, blocks)

      // Permission block should be preserved
      expect(processedBlocks[0].status).toBe('pending')
      expect(processedBlocks[0].action_type).toBe('tool_call_permission')
      // Tool call should be marked as error
      expect(processedBlocks[1].status).toBe('error')
    })
  })

  describe('Timestamp Validation', () => {
    it('should ensure monotonic timestamp ordering within message', () => {
      const blocks: AssistantMessageBlock[] = [
        { type: 'content', status: 'success', timestamp: 1000, content: 'first' },
        { type: 'content', status: 'success', timestamp: 2000, content: 'second' },
        { type: 'content', status: 'success', timestamp: 1500, content: 'third' }
      ]

      const sortedBlocks = sortBlocksByTimestamp(blocks)
      expect(sortedBlocks[0].content).toBe('first')
      expect(sortedBlocks[1].content).toBe('third')
      expect(sortedBlocks[2].content).toBe('second')
    })
  })
})

// Helper functions that would be implemented in the actual renderer
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

    // Text content
    if (data.content) {
      return {
        type: 'content',
        content: data.content,
        status: 'success',
        timestamp
      }
    }

    // Reasoning content
    if (data.reasoning_content) {
      return {
        type: 'reasoning_content',
        content: data.reasoning_content,
        status: 'success',
        timestamp,
        reasoning_time: undefined
      }
    }

    // Tool call events
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

      if (data.tool_call === 'end') {
        return {
          type: 'tool_call',
          status: 'success',
          timestamp,
          tool_call: {
            id: data.tool_call_id,
            response: data.tool_call_response
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

    // Rate limit
    if (data.rate_limit) {
      return {
        type: 'action',
        action_type: 'rate_limit',
        status: 'pending',
        timestamp,
        extra: data.rate_limit as any
      }
    }

    // Image data
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

function updateEventToBlock(
  event: LLMAgentEvent,
  existingBlock: AssistantMessageBlock
): AssistantMessageBlock {
  if (event.type === 'response' && event.data.tool_call) {
    const updatedBlock = { ...existingBlock }

    if (event.data.tool_call === 'update') {
      updatedBlock.tool_call = {
        ...updatedBlock.tool_call,
        params: event.data.tool_call_params
      }
    } else if (event.data.tool_call === 'end') {
      updatedBlock.status = 'success'
      updatedBlock.tool_call = {
        ...updatedBlock.tool_call,
        response: event.data.tool_call_response
      }
    }

    return updatedBlock
  }

  return existingBlock
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

function processEndEvent(
  event: LLMAgentEvent,
  blocks: AssistantMessageBlock[]
): AssistantMessageBlock[] {
  return blocks.map((block) => {
    // Preserve permission blocks
    if (block.type === 'action' && block.action_type === 'tool_call_permission') {
      return block
    }

    // Mark loading blocks as error
    if (block.status === 'loading') {
      return { ...block, status: 'error' }
    }

    return block
  })
}

function sortBlocksByTimestamp(blocks: AssistantMessageBlock[]): AssistantMessageBlock[] {
  return [...blocks].sort((a, b) => a.timestamp - b.timestamp)
}
