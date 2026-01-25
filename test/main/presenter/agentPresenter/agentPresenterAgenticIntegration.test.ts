/**
 * Integration tests for AgentPresenter with Agentic Unified Layer
 * Tests that DeepChat agent streaming emits events in AgenticEventType format
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eventBus } from '@/eventbus'
import { AgenticPresenter } from '@/presenter/agentic'
import { normalizeAndEmit } from '@/presenter/agentPresenter/normalizer'
import { STREAM_EVENTS } from '@/events'
import type { AgenticEventType } from '@shared/types/presenters/agentic.presenter.d'
import type { AgenticEventEmitter } from '@shared/types/presenters/agentic.presenter.d'
import type { LLMAgentEventData } from '@shared/presenter'
import type { PermissionRequestPayload } from '@/presenter/agentic/types'

describe('AgentPresenter Agentic Integration - Streaming', () => {
  let agenticPresenter: AgenticPresenter
  let testEmitter: AgenticEventEmitter
  let sendToRendererSpy: ReturnType<typeof vi.spyOn>
  const testSessionId = 'test-conversation-123'
  const testMessageId = 'test-message-456'

  beforeEach(() => {
    // Spy on the global EventBus's sendToRenderer method
    sendToRendererSpy = vi.spyOn(eventBus, 'sendToRenderer').mockImplementation(() => {})

    // Create AgenticPresenter instance
    agenticPresenter = new AgenticPresenter()

    // Create test emitter
    testEmitter = agenticPresenter.createEventEmitter(testSessionId)
  })

  describe('Content delta events', () => {
    it('should normalize RESPONSE content event to MESSAGE_DELTA', () => {
      const payload: LLMAgentEventData = {
        eventId: testMessageId,
        content: 'Hello, this is a response',
        stream_kind: 'streaming'
      }

      normalizeAndEmit(STREAM_EVENTS.RESPONSE, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.delta' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          messageId: testMessageId,
          content: 'Hello, this is a response',
          isComplete: false
        })
      )
    })

    it('should normalize final content event to MESSAGE_DELTA with isComplete=true', () => {
      const payload: LLMAgentEventData = {
        eventId: testMessageId,
        content: 'Final response content',
        stream_kind: 'final'
      }

      normalizeAndEmit(STREAM_EVENTS.RESPONSE, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.delta' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          messageId: testMessageId,
          content: 'Final response content',
          isComplete: true
        })
      )
    })

    it('should normalize reasoning content event to MESSAGE_DELTA', () => {
      const payload: LLMAgentEventData = {
        eventId: testMessageId,
        reasoning_content: 'Let me think about this...',
        stream_kind: 'streaming'
      }

      normalizeAndEmit(STREAM_EVENTS.RESPONSE, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.delta' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          messageId: testMessageId,
          content: 'Let me think about this...',
          isComplete: false
        })
      )
    })
  })

  describe('Tool call events', () => {
    it('should normalize tool_call start event to TOOL_START', () => {
      const toolParams = { path: '/test/file.txt', encoding: 'utf-8' }
      const payload: LLMAgentEventData = {
        eventId: testMessageId,
        tool_call: 'start',
        tool_call_id: 'tool-123',
        tool_call_name: 'read_file',
        tool_call_params: JSON.stringify(toolParams)
      }

      normalizeAndEmit(STREAM_EVENTS.RESPONSE, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.tool.start' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          toolId: 'tool-123',
          toolName: 'read_file',
          arguments: toolParams
        })
      )
    })

    it('should normalize tool_call running event to TOOL_RUNNING', () => {
      const payload: LLMAgentEventData = {
        eventId: testMessageId,
        tool_call: 'running',
        tool_call_id: 'tool-123',
        tool_call_name: 'read_file'
      }

      normalizeAndEmit(STREAM_EVENTS.RESPONSE, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.tool.running' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          toolId: 'tool-123',
          status: 'running'
        })
      )
    })

    it('should normalize tool_call end event to TOOL_END with result', () => {
      const toolResponse = { content: 'File content here', lines: 42 }
      const payload: LLMAgentEventData = {
        eventId: testMessageId,
        tool_call: 'end',
        tool_call_id: 'tool-123',
        tool_call_response: JSON.stringify(toolResponse),
        tool_call_response_raw: toolResponse
      }

      normalizeAndEmit(STREAM_EVENTS.RESPONSE, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.tool.end' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          toolId: 'tool-123',
          result: toolResponse
        })
      )
    })

    it('should normalize tool_call end event with response_raw to TOOL_END', () => {
      const toolResponseRaw = { error: 'File not found', code: 'ENOENT' }
      const payload: LLMAgentEventData = {
        eventId: testMessageId,
        tool_call_response_raw: toolResponseRaw,
        tool_call_id: 'tool-123'
      }

      normalizeAndEmit(STREAM_EVENTS.RESPONSE, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.tool.end' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          toolId: 'tool-123',
          result: toolResponseRaw
        })
      )
    })
  })

  describe('Message block events', () => {
    it('should normalize reasoning_time event to MESSAGE_BLOCK with reasoning type', () => {
      const payload: LLMAgentEventData = {
        eventId: testMessageId,
        reasoning_content: 'Analyzing the problem...',
        reasoning_time: { start: 1000, end: 2000 }
      }

      normalizeAndEmit(STREAM_EVENTS.RESPONSE, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.block' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          messageId: testMessageId,
          blockType: 'reasoning',
          content: expect.objectContaining({
            reasoningContent: 'Analyzing the problem...',
            reasoningTime: { start: 1000, end: 2000 }
          })
        })
      )
    })

    it('should normalize image_data event to MESSAGE_BLOCK with image type', () => {
      const imageData = {
        data: 'base64encodedimagedata',
        mimeType: 'image/png'
      }
      const payload: LLMAgentEventData = {
        eventId: testMessageId,
        image_data: imageData
      }

      normalizeAndEmit(STREAM_EVENTS.RESPONSE, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.block' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          messageId: testMessageId,
          blockType: 'image',
          content: expect.objectContaining({
            imageData
          })
        })
      )
    })
  })

  describe('Message lifecycle events', () => {
    it('should normalize END event to MESSAGE_END', () => {
      const payload: LLMAgentEventData = {
        eventId: testMessageId,
        userStop: false
      }

      normalizeAndEmit(STREAM_EVENTS.END, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.end' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          messageId: testMessageId
        })
      )
    })

    it('should normalize END event with userStop to MESSAGE_END', () => {
      const payload: LLMAgentEventData = {
        eventId: testMessageId,
        userStop: true
      }

      normalizeAndEmit(STREAM_EVENTS.END, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.end' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          messageId: testMessageId
        })
      )
    })
  })

  describe('Error events', () => {
    it('should normalize ERROR event to STATUS_CHANGED with error status', () => {
      const errorMessage = 'Connection failed'
      const payload: LLMAgentEventData = {
        eventId: testMessageId,
        error: errorMessage
      }

      normalizeAndEmit(STREAM_EVENTS.ERROR, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.status.changed' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          status: 'error',
          error: expect.any(Error)
        })
      )

      // Verify error message
      const calls = sendToRendererSpy.mock.calls
      const lastCall = calls[calls.length - 1]
      const error = lastCall[2].error
      expect(error.message).toBe(errorMessage)
    })
  })

  describe('Event format validation', () => {
    it('should include sessionId in all emitted events', () => {
      const payload: LLMAgentEventData = {
        eventId: testMessageId,
        content: 'Test content'
      }

      normalizeAndEmit(STREAM_EVENTS.RESPONSE, payload, testSessionId, testEmitter)

      const calls = sendToRendererSpy.mock.calls
      const lastCall = calls[calls.length - 1]
      const emittedPayload = lastCall[2]

      expect(emittedPayload).toHaveProperty('sessionId', testSessionId)
    })

    it('should use AgenticEventType for all events (not STREAM_EVENTS)', () => {
      const payload: LLMAgentEventData = {
        eventId: testMessageId,
        content: 'Test content'
      }

      normalizeAndEmit(STREAM_EVENTS.RESPONSE, payload, testSessionId, testEmitter)

      const calls = sendToRendererSpy.mock.calls
      const lastCall = calls[calls.length - 1]
      const eventType = lastCall[0]

      // Event type should start with 'agentic.' prefix
      expect(eventType).toMatch(/^agentic\./)

      // Event type should NOT be a STREAM_EVENT
      expect(Object.values(STREAM_EVENTS)).not.toContain(eventType)
    })
  })

  describe('Complete streaming flow simulation', () => {
    it('should handle a complete message streaming sequence', () => {
      const events: Array<{ event: keyof typeof STREAM_EVENTS; payload: LLMAgentEventData }> = [
        // Start with reasoning
        {
          event: STREAM_EVENTS.RESPONSE,
          payload: {
            eventId: testMessageId,
            reasoning_content: 'Thinking about the problem...',
            stream_kind: 'streaming'
          }
        },
        // Start tool call
        {
          event: STREAM_EVENTS.RESPONSE,
          payload: {
            eventId: testMessageId,
            tool_call: 'start',
            tool_call_id: 'tool-123',
            tool_call_name: 'read_file',
            tool_call_params: JSON.stringify({ path: '/test.txt' })
          }
        },
        // Tool running
        {
          event: STREAM_EVENTS.RESPONSE,
          payload: {
            eventId: testMessageId,
            tool_call: 'running',
            tool_call_id: 'tool-123',
            tool_call_name: 'read_file'
          }
        },
        // Tool end
        {
          event: STREAM_EVENTS.RESPONSE,
          payload: {
            eventId: testMessageId,
            tool_call: 'end',
            tool_call_id: 'tool-123',
            tool_call_response_raw: { content: 'File content', lines: 10 }
          }
        },
        // Content streaming
        {
          event: STREAM_EVENTS.RESPONSE,
          payload: {
            eventId: testMessageId,
            content: 'Here is the analysis',
            stream_kind: 'streaming'
          }
        },
        // Final content
        {
          event: STREAM_EVENTS.RESPONSE,
          payload: {
            eventId: testMessageId,
            content: 'Based on the file content',
            stream_kind: 'final'
          }
        },
        // End event
        {
          event: STREAM_EVENTS.END,
          payload: {
            eventId: testMessageId
          }
        }
      ]

      // Process all events
      events.forEach(({ event, payload }) => {
        normalizeAndEmit(event, payload, testSessionId, testEmitter)
      })

      // Verify number of events emitted
      expect(sendToRendererSpy).toHaveBeenCalledTimes(7)

      // Verify event types in order
      const calls = sendToRendererSpy.mock.calls
      const eventTypes = calls.map((call) => call[0])

      // Expected event types in order:
      // 1. MESSAGE_DELTA (reasoning)
      // 2. TOOL_START
      // 3. TOOL_RUNNING
      // 4. TOOL_END
      // 5. MESSAGE_DELTA (content streaming)
      // 6. MESSAGE_DELTA (final content, isComplete=true)
      // 7. MESSAGE_END

      expect(eventTypes[0]).toBe('agentic.message.delta')
      expect(eventTypes[1]).toBe('agentic.tool.start')
      expect(eventTypes[2]).toBe('agentic.tool.running')
      expect(eventTypes[3]).toBe('agentic.tool.end')
      expect(eventTypes[4]).toBe('agentic.message.delta')
      expect(eventTypes[5]).toBe('agentic.message.delta')
      expect(eventTypes[6]).toBe('agentic.message.end')

      // Verify final MESSAGE_DELTA has isComplete=true
      const finalDeltaCall = calls[5]
      expect(finalDeltaCall[2].isComplete).toBe(true)
    })
  })

  describe('Empty and edge case handling', () => {
    it('should handle empty content delta', () => {
      const payload: LLMAgentEventData = {
        eventId: testMessageId,
        content: '',
        stream_kind: 'final'
      }

      normalizeAndEmit(STREAM_EVENTS.RESPONSE, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.delta' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          messageId: testMessageId,
          content: '',
          isComplete: true
        })
      )
    })

    it('should handle null or undefined payload gracefully', () => {
      // Should not throw error
      expect(() => {
        normalizeAndEmit(STREAM_EVENTS.RESPONSE, null, testSessionId, testEmitter)
      }).not.toThrow()

      expect(() => {
        normalizeAndEmit(STREAM_EVENTS.RESPONSE, undefined, testSessionId, testEmitter)
      }).not.toThrow()
    })

    it('should handle non-object payload gracefully', () => {
      expect(() => {
        normalizeAndEmit(STREAM_EVENTS.RESPONSE, 'string payload', testSessionId, testEmitter)
      }).not.toThrow()

      expect(() => {
        normalizeAndEmit(STREAM_EVENTS.RESPONSE, 123, testSessionId, testEmitter)
      }).not.toThrow()
    })
  })
})
