import { describe, it, expect, vi } from 'vitest'
import type { LLMAgentEvent } from '@shared/types/core/agent-events'
import type { AssistantMessageBlock } from '@shared/chat'

/**
 * 性能评估测试 - 验证大文本和图像场景下的事件处理性能
 */

// Mock helper functions
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

    if (data.image_data) {
      return {
        type: 'image',
        status: 'success',
        timestamp,
        image_data: data.image_data
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

      if (data.tool_call === 'running') {
        return {
          type: 'tool_call',
          status: 'loading',
          timestamp,
          tool_call: {
            id: data.tool_call_id
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
    }
  }

  throw new Error(`Unsupported event: ${JSON.stringify(event)}`)
}

function processEventBatch(events: LLMAgentEvent[]): AssistantMessageBlock[] {
  return events.map(mapEventToBlock)
}

describe('Performance Evaluation Tests', () => {
  describe('Large Text Content Processing', () => {
    it('should handle very large text content efficiently', () => {
      // Generate 50KB text content
      const largeText = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(1000)

      const startTime = performance.now()

      const event: LLMAgentEvent = {
        type: 'response',
        data: {
          eventId: 'perf-test-1',
          content: largeText
        }
      }

      const block = mapEventToBlock(event)

      const endTime = performance.now()
      const processingTime = endTime - startTime

      expect(block.type).toBe('content')
      expect(block.content).toBe(largeText)
      expect(block.status).toBe('success')

      // Processing should be fast (< 10ms for 50KB text)
      expect(processingTime).toBeLessThan(10)
    })

    it('should handle large reasoning content efficiently', () => {
      // Generate 100KB reasoning content
      const largeReasoning = 'Step 1: Analyze the problem...\n'.repeat(2000)

      const startTime = performance.now()

      const event: LLMAgentEvent = {
        type: 'response',
        data: {
          eventId: 'perf-test-2',
          reasoning_content: largeReasoning
        }
      }

      const block = mapEventToBlock(event)

      const endTime = performance.now()
      const processingTime = endTime - startTime

      expect(block.type).toBe('reasoning_content')
      expect(block.content).toBe(largeReasoning)
      expect(block.status).toBe('success')

      // Processing should be fast (< 15ms for 100KB text)
      expect(processingTime).toBeLessThan(15)
    })
  })

  describe('Image Data Processing', () => {
    it('should handle large base64 image data efficiently', () => {
      // Generate mock base64 image data (~1MB)
      const largeImageData =
        'data:image/png;base64,' +
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='.repeat(
          10000
        )

      const startTime = performance.now()

      const event: LLMAgentEvent = {
        type: 'response',
        data: {
          eventId: 'perf-test-3',
          image_data: {
            data: largeImageData,
            mimeType: 'image/png'
          }
        }
      }

      const block = mapEventToBlock(event)

      const endTime = performance.now()
      const processingTime = endTime - startTime

      expect(block.type).toBe('image')
      expect(block.status).toBe('success')
      expect(block.image_data?.data).toBe(largeImageData)
      expect(block.image_data?.mimeType).toBe('image/png')

      // Processing should be fast (< 20ms for 1MB image)
      expect(processingTime).toBeLessThan(20)
    })

    it('should handle multiple image events efficiently', () => {
      const imageCount = 100
      const events: LLMAgentEvent[] = []

      // Generate 100 image events
      for (let i = 0; i < imageCount; i++) {
        events.push({
          type: 'response',
          data: {
            eventId: `perf-test-4-${i}`,
            image_data: {
              data: `base64data${i}`,
              mimeType: 'image/jpeg'
            }
          }
        })
      }

      const startTime = performance.now()
      const blocks = processEventBatch(events)
      const endTime = performance.now()
      const processingTime = endTime - startTime

      expect(blocks).toHaveLength(imageCount)
      blocks.forEach((block, index) => {
        expect(block.type).toBe('image')
        expect(block.status).toBe('success')
        expect(block.image_data?.data).toBe(`base64data${index}`)
      })

      // Processing 100 images should be fast (< 50ms)
      expect(processingTime).toBeLessThan(50)
    })
  })

  describe('High-Frequency Event Processing', () => {
    it('should handle rapid tool call updates efficiently', () => {
      const updateCount = 1000
      const toolCallId = 'rapid-tool-123'
      const events: LLMAgentEvent[] = []

      // Generate 1000 tool call updates
      for (let i = 0; i < updateCount; i++) {
        events.push({
          type: 'response',
          data: {
            eventId: `rapid-${i}`,
            tool_call: i === 0 ? 'start' : i === updateCount - 1 ? 'end' : 'running',
            tool_call_id: toolCallId,
            tool_call_name: 'rapidTool',
            tool_call_params: i === 0 ? '{"step": 0}' : undefined,
            tool_call_response: i === updateCount - 1 ? 'Completed' : undefined
          }
        })
      }

      const startTime = performance.now()
      const blocks = processEventBatch(events)
      const endTime = performance.now()
      const processingTime = endTime - startTime

      expect(blocks).toHaveLength(updateCount)
      expect(blocks[0].status).toBe('loading')
      expect(blocks[updateCount - 1].status).toBe('success')

      // Processing 1000 events should be fast (< 100ms)
      expect(processingTime).toBeLessThan(100)
    })

    it('should handle mixed event types efficiently', () => {
      const eventCount = 500
      const events: LLMAgentEvent[] = []

      // Generate mixed event types
      for (let i = 0; i < eventCount; i++) {
        const eventType = i % 4
        switch (eventType) {
          case 0:
            events.push({
              type: 'response',
              data: { eventId: `mixed-${i}`, content: `Content ${i}` }
            })
            break
          case 1:
            events.push({
              type: 'response',
              data: { eventId: `mixed-${i}`, reasoning_content: `Reasoning ${i}` }
            })
            break
          case 2:
            events.push({
              type: 'response',
              data: {
                eventId: `mixed-${i}`,
                image_data: { data: `imagedata${i}`, mimeType: 'image/png' }
              }
            })
            break
          case 3:
            events.push({
              type: 'error',
              data: { eventId: `mixed-${i}`, error: `Error ${i}` }
            })
            break
        }
      }

      const startTime = performance.now()
      const blocks = processEventBatch(events)
      const endTime = performance.now()
      const processingTime = endTime - startTime

      expect(blocks).toHaveLength(eventCount)

      // Verify mixed types
      const contentBlocks = blocks.filter((b) => b.type === 'content')
      const reasoningBlocks = blocks.filter((b) => b.type === 'reasoning_content')
      const imageBlocks = blocks.filter((b) => b.type === 'image')
      const errorBlocks = blocks.filter((b) => b.type === 'error')

      expect(contentBlocks.length).toBe(125)
      expect(reasoningBlocks.length).toBe(125)
      expect(imageBlocks.length).toBe(125)
      expect(errorBlocks.length).toBe(125)

      // Processing 500 mixed events should be fast (< 80ms)
      expect(processingTime).toBeLessThan(80)
    })
  })

  describe('Memory Usage Evaluation', () => {
    it('should not cause memory leaks with repeated processing', () => {
      const iterations = 100
      const eventsPerIteration = 50

      const startTime = performance.now()

      for (let i = 0; i < iterations; i++) {
        const events: LLMAgentEvent[] = []

        for (let j = 0; j < eventsPerIteration; j++) {
          events.push({
            type: 'response',
            data: {
              eventId: `memory-test-${i}-${j}`,
              content: `Test content for iteration ${i}, event ${j}`
            }
          })
        }

        // Process and immediately discard
        const blocks = processEventBatch(events)
        expect(blocks).toHaveLength(eventsPerIteration)
      }

      const endTime = performance.now()
      const totalTime = endTime - startTime

      // Processing 5000 events across 100 iterations should complete in reasonable time
      expect(totalTime).toBeLessThan(500)
    })
  })

  describe('Edge Cases and Stress Testing', () => {
    it('should handle extremely long tool call parameters', () => {
      // Generate 10KB parameter string
      const longParams = JSON.stringify({
        data: 'x'.repeat(10000),
        metadata: { large: true }
      })

      const startTime = performance.now()

      const event: LLMAgentEvent = {
        type: 'response',
        data: {
          eventId: 'stress-test-1',
          tool_call: 'start',
          tool_call_id: 'stress-tool-1',
          tool_call_name: 'processLargeData',
          tool_call_params: longParams
        }
      }

      const block = mapEventToBlock(event)

      const endTime = performance.now()
      const processingTime = endTime - startTime

      expect(block.type).toBe('tool_call')
      expect(block.tool_call?.params).toBe(longParams)
      expect(block.status).toBe('loading')

      // Even with large parameters, processing should be fast
      expect(processingTime).toBeLessThan(5)
    })

    it('should handle concurrent event processing simulation', async () => {
      const concurrency = 10
      const eventsPerWorker = 100

      const workers = Array.from({ length: concurrency }, (_, workerIndex) => {
        return new Promise<number>((resolve) => {
          const startTime = performance.now()

          const events: LLMAgentEvent[] = Array.from(
            { length: eventsPerWorker },
            (_, eventIndex) => ({
              type: 'response',
              data: {
                eventId: `concurrent-${workerIndex}-${eventIndex}`,
                content: `Worker ${workerIndex} Event ${eventIndex}`
              }
            })
          )

          const blocks = processEventBatch(events)
          expect(blocks).toHaveLength(eventsPerWorker)

          const endTime = performance.now()
          resolve(endTime - startTime)
        })
      })

      const processingTimes = await Promise.all(workers)
      const maxTime = Math.max(...processingTimes)
      const avgTime = processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length

      // All workers should complete quickly
      expect(maxTime).toBeLessThan(100)
      expect(avgTime).toBeLessThan(50)
    })
  })
})
