/**
 * Integration tests for AcpPresenter with Agentic Unified Layer
 * Tests that ACP agent streaming emits events in AgenticEventType format
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eventBus } from '@/eventbus'
import { AgenticPresenter } from '@/presenter/agentic'
import { normalizeAndEmit } from '@/presenter/acpPresenter/normalizer'
import { ACP_EVENTS } from '@/presenter/acpPresenter/events'
import type { AgenticEventType } from '@shared/types/presenters/agentic.presenter.d'
import type { AgenticEventEmitter } from '@shared/types/presenters/agentic.presenter.d'
import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'

describe('AcpPresenter Agentic Integration - Streaming', () => {
  let agenticPresenter: AgenticPresenter
  let testEmitter: AgenticEventEmitter
  let sendToRendererSpy: ReturnType<typeof vi.spyOn>
  const testSessionId = 'acp-session-123'

  beforeEach(() => {
    // Spy on the global EventBus's sendToRenderer method
    sendToRendererSpy = vi.spyOn(eventBus, 'sendToRenderer').mockImplementation(() => {})

    // Create AgenticPresenter instance
    agenticPresenter = new AgenticPresenter()

    // Create test emitter
    testEmitter = agenticPresenter.createEventEmitter(testSessionId)
  })

  describe('Content delta events', () => {
    it('should normalize SESSION_UPDATE with string content to MESSAGE_DELTA', () => {
      const notification: schema.SessionNotification = {
        sessionId: testSessionId,
        update: {
          content: 'Hello from ACP agent'
        } as any
      }

      const payload = {
        sessionId: testSessionId,
        notification
      }

      normalizeAndEmit(ACP_EVENTS.SESSION_UPDATE, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.delta' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          content: 'Hello from ACP agent',
          isComplete: false
        })
      )
    })

    it('should normalize SESSION_UPDATE with nested content.text to MESSAGE_DELTA', () => {
      const notification: schema.SessionNotification = {
        sessionId: testSessionId,
        update: {
          content: {
            text: 'Nested text content'
          }
        } as any
      }

      const payload = {
        sessionId: testSessionId,
        notification
      }

      normalizeAndEmit(ACP_EVENTS.SESSION_UPDATE, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.delta' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          content: 'Nested text content',
          isComplete: false
        })
      )
    })

    it('should normalize SESSION_UPDATE with nested content.data to MESSAGE_DELTA', () => {
      const notification: schema.SessionNotification = {
        sessionId: testSessionId,
        update: {
          content: {
            data: 'Data field content'
          }
        } as any
      }

      const payload = {
        sessionId: testSessionId,
        notification
      }

      normalizeAndEmit(ACP_EVENTS.SESSION_UPDATE, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.delta' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          content: 'Data field content',
          isComplete: false
        })
      )
    })

    it('should normalize SESSION_UPDATE with sessionUpdate complete to MESSAGE_DELTA with isComplete=true', () => {
      const notification: schema.SessionNotification = {
        sessionId: testSessionId,
        update: {
          content: 'Complete response',
          sessionUpdate: 'complete'
        } as any
      }

      const payload = {
        sessionId: testSessionId,
        notification
      }

      normalizeAndEmit(ACP_EVENTS.SESSION_UPDATE, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.delta' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          content: 'Complete response',
          isComplete: true
        })
      )
    })

    it('should handle empty content gracefully', () => {
      const notification: schema.SessionNotification = {
        sessionId: testSessionId,
        update: {} as any
      }

      const payload = {
        sessionId: testSessionId,
        notification
      }

      normalizeAndEmit(ACP_EVENTS.SESSION_UPDATE, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.delta' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          content: '',
          isComplete: false
        })
      )
    })
  })

  describe('Message lifecycle events', () => {
    it('should normalize PROMPT_COMPLETED to MESSAGE_END', () => {
      const payload = {
        sessionId: testSessionId
      }

      normalizeAndEmit(ACP_EVENTS.PROMPT_COMPLETED, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.end' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          messageId: testSessionId // For ACP, sessionId is used as messageId
        })
      )
    })
  })

  describe('Error events', () => {
    it('should normalize ERROR event to STATUS_CHANGED with error status', () => {
      const errorMessage = 'Agent process crashed'
      const payload = {
        sessionId: testSessionId,
        error: errorMessage
      }

      normalizeAndEmit(ACP_EVENTS.ERROR, payload, testSessionId, testEmitter)

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
      const notification: schema.SessionNotification = {
        sessionId: testSessionId,
        update: {
          content: 'Test content'
        }
      } as any

      const payload = {
        sessionId: testSessionId,
        notification
      }

      normalizeAndEmit(ACP_EVENTS.SESSION_UPDATE, payload, testSessionId, testEmitter)

      const calls = sendToRendererSpy.mock.calls
      const lastCall = calls[calls.length - 1]
      const emittedPayload = lastCall[2]

      expect(emittedPayload).toHaveProperty('sessionId', testSessionId)
    })

    it('should use AgenticEventType for all events (not ACP_EVENTS)', () => {
      const notification: schema.SessionNotification = {
        sessionId: testSessionId,
        update: {
          content: 'Test content'
        }
      } as any

      const payload = {
        sessionId: testSessionId,
        notification
      }

      normalizeAndEmit(ACP_EVENTS.SESSION_UPDATE, payload, testSessionId, testEmitter)

      const calls = sendToRendererSpy.mock.calls
      const lastCall = calls[calls.length - 1]
      const eventType = lastCall[0]

      // Event type should start with 'agentic.' prefix
      expect(eventType).toMatch(/^agentic\./)

      // Event type should NOT be an ACP_EVENT
      expect(Object.values(ACP_EVENTS)).not.toContain(eventType)
    })
  })

  describe('Complete streaming flow simulation', () => {
    it('should handle a complete ACP message streaming sequence', () => {
      const events: Array<{ event: keyof typeof ACP_EVENTS; payload: Record<string, unknown> }> = [
        // Start streaming content
        {
          event: ACP_EVENTS.SESSION_UPDATE,
          payload: {
            sessionId: testSessionId,
            notification: {
              sessionId: testSessionId,
              update: {
                content: 'Thinking about this...'
              }
            } as any
          }
        },
        // More content
        {
          event: ACP_EVENTS.SESSION_UPDATE,
          payload: {
            sessionId: testSessionId,
            notification: {
              sessionId: testSessionId,
              update: {
                content: {
                  text: 'Here is my response'
                }
              }
            } as any
          }
        },
        // Complete content
        {
          event: ACP_EVENTS.SESSION_UPDATE,
          payload: {
            sessionId: testSessionId,
            notification: {
              sessionId: testSessionId,
              update: {
                content: 'Final answer to your question',
                sessionUpdate: 'complete'
              }
            } as any
          }
        },
        // Prompt completed
        {
          event: ACP_EVENTS.PROMPT_COMPLETED,
          payload: {
            sessionId: testSessionId
          }
        }
      ]

      // Process all events
      events.forEach(({ event, payload }) => {
        normalizeAndEmit(event, payload, testSessionId, testEmitter)
      })

      // Verify number of events emitted
      expect(sendToRendererSpy).toHaveBeenCalledTimes(4)

      // Verify event types in order
      const calls = sendToRendererSpy.mock.calls
      const eventTypes = calls.map((call) => call[0])

      // Expected event types in order:
      // 1. MESSAGE_DELTA (initial content)
      // 2. MESSAGE_DELTA (more content)
      // 3. MESSAGE_DELTA (final content, isComplete=true)
      // 4. MESSAGE_END

      expect(eventTypes[0]).toBe('agentic.message.delta')
      expect(eventTypes[1]).toBe('agentic.message.delta')
      expect(eventTypes[2]).toBe('agentic.message.delta')
      expect(eventTypes[3]).toBe('agentic.message.end')

      // Verify final MESSAGE_DELTA has isComplete=true
      const finalDeltaCall = calls[2]
      expect(finalDeltaCall[2].isComplete).toBe(true)
    })
  })

  describe('Edge cases and error handling', () => {
    it('should handle null or undefined payload gracefully', () => {
      // Should not throw error
      expect(() => {
        normalizeAndEmit(ACP_EVENTS.SESSION_UPDATE, null, testSessionId, testEmitter)
      }).not.toThrow()

      expect(() => {
        normalizeAndEmit(ACP_EVENTS.SESSION_UPDATE, undefined, testSessionId, testEmitter)
      }).not.toThrow()
    })

    it('should handle non-object payload gracefully', () => {
      expect(() => {
        normalizeAndEmit(ACP_EVENTS.SESSION_UPDATE, 'string payload', testSessionId, testEmitter)
      }).not.toThrow()

      expect(() => {
        normalizeAndEmit(ACP_EVENTS.SESSION_UPDATE, 123, testSessionId, testEmitter)
      }).not.toThrow()
    })

    it('should handle notification without update field', () => {
      const payload = {
        sessionId: testSessionId,
        notification: {
          sessionId: testSessionId
          // update field is missing
        } as any
      }

      // Should not throw, but should not emit any event
      expect(() => {
        normalizeAndEmit(ACP_EVENTS.SESSION_UPDATE, payload, testSessionId, testEmitter)
      }).not.toThrow()

      // No event should have been emitted (the function returns early)
      expect(sendToRendererSpy).not.toHaveBeenCalled()
    })

    it('should handle notification with empty update', () => {
      const payload = {
        sessionId: testSessionId,
        notification: {
          sessionId: testSessionId,
          update: {}
        } as any
      }

      normalizeAndEmit(ACP_EVENTS.SESSION_UPDATE, payload, testSessionId, testEmitter)

      // Should emit MESSAGE_DELTA with empty content
      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.delta' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          content: '',
          isComplete: false
        })
      )
    })
  })

  describe('Different content formats', () => {
    it('should handle content with markdown formatting', () => {
      const markdownContent = '# Heading\n\nThis is **bold** and this is *italic*.'
      const notification: schema.SessionNotification = {
        sessionId: testSessionId,
        update: {
          content: markdownContent
        } as any
      }

      const payload = {
        sessionId: testSessionId,
        notification
      }

      normalizeAndEmit(ACP_EVENTS.SESSION_UPDATE, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.delta' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          content: markdownContent,
          isComplete: false
        })
      )
    })

    it('should handle content with special characters', () => {
      const specialContent = 'Content with "quotes" and \'apostrophes\' and\nnewlines\ttabs'
      const notification: schema.SessionNotification = {
        sessionId: testSessionId,
        update: {
          content: specialContent
        } as any
      }

      const payload = {
        sessionId: testSessionId,
        notification
      }

      normalizeAndEmit(ACP_EVENTS.SESSION_UPDATE, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.delta' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          content: specialContent,
          isComplete: false
        })
      )
    })

    it('should handle very long content', () => {
      const longContent = 'A'.repeat(10000)
      const notification: schema.SessionNotification = {
        sessionId: testSessionId,
        update: {
          content: longContent
        } as any
      }

      const payload = {
        sessionId: testSessionId,
        notification
      }

      normalizeAndEmit(ACP_EVENTS.SESSION_UPDATE, payload, testSessionId, testEmitter)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.delta' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          content: longContent,
          isComplete: false
        })
      )
    })
  })

  describe('ACP-specific event scenarios', () => {
    it('should handle multiple SESSION_UPDATE events for streaming chunks', () => {
      const chunks = ['Hello ', 'world ', 'from ', 'ACP ', 'agent!']

      chunks.forEach((chunk) => {
        const notification: schema.SessionNotification = {
          sessionId: testSessionId,
          update: {
            content: chunk
          } as any
        }

        const payload = {
          sessionId: testSessionId,
          notification
        }

        normalizeAndEmit(ACP_EVENTS.SESSION_UPDATE, payload, testSessionId, testEmitter)
      })

      // Verify all chunks were emitted
      expect(sendToRendererSpy).toHaveBeenCalledTimes(5)

      // Verify each chunk
      const calls = sendToRendererSpy.mock.calls
      chunks.forEach((chunk, index) => {
        expect(calls[index][2].content).toBe(chunk)
        expect(calls[index][2].isComplete).toBe(false)
      })
    })

    it('should handle MODE_CHANGED event (should not emit to renderer)', () => {
      const payload = {
        sessionId: testSessionId,
        modeId: 'advanced'
      }

      // MODE_CHANGED is not handled by the normalizer, so no event should be emitted
      normalizeAndEmit(ACP_EVENTS.MODE_CHANGED, payload, testSessionId, testEmitter)

      // No event should be emitted for MODE_CHANGED
      expect(sendToRendererSpy).not.toHaveBeenCalled()
    })

    it('should handle MODEL_CHANGED event (should not emit to renderer)', () => {
      const payload = {
        sessionId: testSessionId,
        modelId: 'claude-3-opus'
      }

      // MODEL_CHANGED is not handled by the normalizer, so no event should be emitted
      normalizeAndEmit(ACP_EVENTS.MODEL_CHANGED, payload, testSessionId, testEmitter)

      // No event should be emitted for MODEL_CHANGED
      expect(sendToRendererSpy).not.toHaveBeenCalled()
    })
  })
})
