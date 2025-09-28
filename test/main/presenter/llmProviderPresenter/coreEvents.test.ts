import { describe, it, expect } from 'vitest'
import {
  createStreamEvent,
  isTextEvent,
  isToolCallStartEvent,
  isErrorEvent
} from '@shared/types/core/llm-events'

describe('LLMCoreStreamEvent Factory Functions', () => {
  describe('createStreamEvent', () => {
    it('should create text events correctly', () => {
      const content = 'Hello, world!'
      const event = createStreamEvent.text(content)

      expect(event.type).toBe('text')
      expect(event.content).toBe(content)
      expect(isTextEvent(event)).toBe(true)
    })

    it('should create reasoning events correctly', () => {
      const reasoning = 'Let me think about this...'
      const event = createStreamEvent.reasoning(reasoning)

      expect(event.type).toBe('reasoning')
      expect(event.reasoning_content).toBe(reasoning)
    })

    it('should create tool call sequence events correctly', () => {
      const toolId = 'test-tool-123'
      const toolName = 'testFunction'
      const args = '{"param": "value"}'

      // Start event
      const startEvent = createStreamEvent.toolCallStart(toolId, toolName)
      expect(startEvent.type).toBe('tool_call_start')
      expect(startEvent.tool_call_id).toBe(toolId)
      expect(startEvent.tool_call_name).toBe(toolName)
      expect(isToolCallStartEvent(startEvent)).toBe(true)

      // Chunk event
      const chunkEvent = createStreamEvent.toolCallChunk(toolId, args)
      expect(chunkEvent.type).toBe('tool_call_chunk')
      expect(chunkEvent.tool_call_id).toBe(toolId)
      expect(chunkEvent.tool_call_arguments_chunk).toBe(args)

      // End event
      const endEvent = createStreamEvent.toolCallEnd(toolId, args)
      expect(endEvent.type).toBe('tool_call_end')
      expect(endEvent.tool_call_id).toBe(toolId)
      expect(endEvent.tool_call_arguments_complete).toBe(args)
    })

    it('should create error events correctly', () => {
      const errorMessage = 'Something went wrong'
      const event = createStreamEvent.error(errorMessage)

      expect(event.type).toBe('error')
      expect(event.error_message).toBe(errorMessage)
      expect(isErrorEvent(event)).toBe(true)
    })

    it('should create usage events correctly', () => {
      const usage = {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30
      }
      const event = createStreamEvent.usage(usage)

      expect(event.type).toBe('usage')
      expect(event.usage).toEqual(usage)
    })

    it('should create stop events correctly', () => {
      const stopReason = 'complete'
      const event = createStreamEvent.stop(stopReason)

      expect(event.type).toBe('stop')
      expect(event.stop_reason).toBe(stopReason)
    })

    it('should create imageData events correctly', () => {
      const imageData = { data: 'base64data', mimeType: 'image/png' }
      const event = createStreamEvent.imageData(imageData)

      expect(event.type).toBe('image_data')
      expect(event.image_data).toEqual(imageData)
    })

    it('should create rateLimit events correctly', () => {
      const rateLimitInfo = {
        providerId: 'openai',
        qpsLimit: 10,
        currentQps: 5,
        queueLength: 2,
        estimatedWaitTime: 1000
      }
      const event = createStreamEvent.rateLimit(rateLimitInfo)

      expect(event.type).toBe('rate_limit')
      expect(event.rate_limit).toEqual(rateLimitInfo)
    })
  })

  describe('Event Sequence Validation', () => {
    it('should validate tool call sequence integrity', () => {
      const toolId = 'test-tool-456'
      const toolName = 'calculateSum'
      const args = '{"a": 1, "b": 2}'

      // Simulate a complete tool call sequence
      const events = [
        createStreamEvent.toolCallStart(toolId, toolName),
        createStreamEvent.toolCallChunk(toolId, args),
        createStreamEvent.toolCallEnd(toolId, args)
      ]

      // Verify sequence
      expect(events[0].type).toBe('tool_call_start')
      expect(events[1].type).toBe('tool_call_chunk')
      expect(events[2].type).toBe('tool_call_end')

      // Verify ID consistency
      events.forEach((event) => {
        if ('tool_call_id' in event) {
          expect(event.tool_call_id).toBe(toolId)
        }
      })
    })

    it('should validate error + stop sequence', () => {
      const errorMsg = 'Network timeout'
      const events = [createStreamEvent.error(errorMsg), createStreamEvent.stop('error')]

      expect(events[0].type).toBe('error')
      expect(events[0].error_message).toBe(errorMsg)
      expect(events[1].type).toBe('stop')
      expect(events[1].stop_reason).toBe('error')
    })

    it('should validate usage before stop sequence', () => {
      const usage = { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 }
      const events = [createStreamEvent.usage(usage), createStreamEvent.stop('complete')]

      expect(events[0].type).toBe('usage')
      expect(events[1].type).toBe('stop')
    })
  })

  describe('Type Guards', () => {
    it('should correctly identify event types', () => {
      const textEvent = createStreamEvent.text('test')
      const errorEvent = createStreamEvent.error('error')
      const toolStartEvent = createStreamEvent.toolCallStart('id', 'name')

      expect(isTextEvent(textEvent)).toBe(true)
      expect(isTextEvent(errorEvent)).toBe(false)

      expect(isErrorEvent(errorEvent)).toBe(true)
      expect(isErrorEvent(textEvent)).toBe(false)

      expect(isToolCallStartEvent(toolStartEvent)).toBe(true)
      expect(isToolCallStartEvent(textEvent)).toBe(false)
    })
  })
})
