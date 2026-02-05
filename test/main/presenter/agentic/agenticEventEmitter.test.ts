/**
 * Tests for AgenticEventEmitter
 * Tests all emitter methods to verify events reach renderer in correct format
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eventBus } from '@/eventbus'
import { AgenticPresenter } from '@/presenter/agentic'
import type { AgenticEventType } from '@shared/types/presenters/agentic.presenter.d'
import type { SessionInfo, PermissionRequestPayload } from '@/presenter/agentic/types'

describe('AgenticEventEmitter', () => {
  let agenticPresenter: AgenticPresenter
  let testEmitter: ReturnType<AgenticPresenter['createEventEmitter']>
  let sendToRendererSpy: ReturnType<typeof vi.spyOn>
  const testSessionId = 'test-session-123'

  beforeEach(() => {
    // Spy on the global EventBus's sendToRenderer method
    sendToRendererSpy = vi.spyOn(eventBus, 'sendToRenderer').mockImplementation(() => {})

    // Create AgenticPresenter instance for testing
    agenticPresenter = new AgenticPresenter()

    // Create test emitter
    testEmitter = agenticPresenter.createEventEmitter(testSessionId)
  })

  describe('Message flow events', () => {
    it('should emit messageDelta event with correct payload', () => {
      const messageId = 'msg-456'
      const content = 'Hello, world!'
      const isComplete = false

      testEmitter.messageDelta(messageId, content, isComplete)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.delta' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          messageId,
          content,
          isComplete
        })
      )
    })

    it('should emit messageDelta event with isComplete=true', () => {
      const messageId = 'msg-789'
      const content = 'Final content'
      const isComplete = true

      testEmitter.messageDelta(messageId, content, isComplete)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.delta' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          messageId,
          content,
          isComplete: true
        })
      )
    })

    it('should emit messageEnd event with correct payload', () => {
      const messageId = 'msg-end-123'

      testEmitter.messageEnd(messageId)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.end' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          messageId
        })
      )
    })

    it('should emit messageBlock event with correct payload', () => {
      const messageId = 'msg-block-123'
      const blockType = 'tool'
      const content = { toolName: 'read_file', params: { path: '/test.txt' } }

      testEmitter.messageBlock(messageId, blockType, content)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.block' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          messageId,
          blockType,
          content
        })
      )
    })

    it('should emit messageBlock event for reasoning block', () => {
      const messageId = 'msg-reasoning-123'
      const blockType = 'reasoning'
      const content = 'Thinking about the problem...'

      testEmitter.messageBlock(messageId, blockType, content)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.message.block' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          messageId,
          blockType: 'reasoning',
          content
        })
      )
    })
  })

  describe('Tool call events', () => {
    it('should emit toolStart event with correct payload', () => {
      const toolId = 'tool-start-123'
      const toolName = 'read_file'
      const toolArguments = { path: '/test/file.txt', encoding: 'utf-8' }

      testEmitter.toolStart(toolId, toolName, toolArguments)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.tool.start' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          toolId,
          toolName,
          arguments: toolArguments
        })
      )
    })

    it('should emit toolRunning event with status', () => {
      const toolId = 'tool-running-123'
      const status = 'executing'

      testEmitter.toolRunning(toolId, status)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.tool.running' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          toolId,
          status
        })
      )
    })

    it('should emit toolRunning event without status', () => {
      const toolId = 'tool-running-no-status'

      testEmitter.toolRunning(toolId)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.tool.running' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          toolId
        })
      )
    })

    it('should emit toolEnd event with result', () => {
      const toolId = 'tool-end-result-123'
      const result = { content: 'File content here', lines: 42 }

      testEmitter.toolEnd(toolId, result)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.tool.end' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          toolId,
          result
        })
      )
    })

    it('should emit toolEnd event with error', () => {
      const toolId = 'tool-end-error-123'
      const error = new Error('Tool execution failed')

      testEmitter.toolEnd(toolId, 'all_windows', error)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.tool.end' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          toolId,
          error
        })
      )
    })
  })

  describe('Tool permission events', () => {
    const mockPermissionRequest: PermissionRequestPayload = {
      permissionType: 'write',
      toolName: 'write_file',
      serverName: 'filesystem',
      description: 'Write to file',
      command: 'echo "test" > /tmp/test.txt',
      commandInfo: {
        command: 'echo "test" > /tmp/test.txt',
        riskLevel: 'medium',
        suggestion: 'This will write to the filesystem'
      },
      sessionId: testSessionId,
      agentId: 'test-agent'
    }

    it('should emit toolPermissionRequired event with correct payload', () => {
      const toolId = 'tool-perm-req-123'
      const toolName = 'write_file'

      testEmitter.toolPermissionRequired(toolId, toolName, mockPermissionRequest)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.tool.permission-required' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          toolId,
          toolName,
          request: mockPermissionRequest
        })
      )
    })

    it('should emit toolPermissionGranted event with correct payload', () => {
      const toolId = 'tool-perm-granted-123'

      testEmitter.toolPermissionGranted(toolId)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.tool.permission-granted' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          toolId
        })
      )
    })

    it('should emit toolPermissionDenied event with correct payload', () => {
      const toolId = 'tool-perm-denied-123'

      testEmitter.toolPermissionDenied(toolId)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.tool.permission-denied' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          toolId
        })
      )
    })
  })

  describe('Session lifecycle events', () => {
    it('should emit sessionReady event with messageCount', () => {
      const sessionId = 'session-ready-123'
      const messageCount = 42

      testEmitter.sessionReady(sessionId, messageCount)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.session.ready' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId,
          messageCount
        })
      )
    })

    it('should emit sessionReady event without messageCount', () => {
      const sessionId = 'session-ready-no-count'

      testEmitter.sessionReady(sessionId)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.session.ready' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId
        })
      )
    })

    it('should emit sessionUpdated event with partial SessionInfo', () => {
      const partialInfo: Partial<SessionInfo> = {
        sessionId: testSessionId,
        status: 'generating',
        currentModelId: 'claude-3-opus'
      }

      testEmitter.sessionUpdated(partialInfo)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.session.updated' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          sessionInfo: partialInfo
        })
      )
    })
  })

  describe('Status events', () => {
    it('should emit statusChanged event for idle status', () => {
      testEmitter.statusChanged('idle')

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.status.changed' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          status: 'idle'
        })
      )
    })

    it('should emit statusChanged event for generating status', () => {
      testEmitter.statusChanged('generating')

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.status.changed' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          status: 'generating'
        })
      )
    })

    it('should emit statusChanged event for paused status', () => {
      testEmitter.statusChanged('paused')

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.status.changed' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          status: 'paused'
        })
      )
    })

    it('should emit statusChanged event for error status', () => {
      const error = new Error('Generation failed')

      testEmitter.statusChanged('error', error)

      expect(sendToRendererSpy).toHaveBeenCalledWith(
        'agentic.status.changed' as AgenticEventType,
        'all_windows',
        expect.objectContaining({
          sessionId: testSessionId,
          status: 'error',
          error
        })
      )
    })
  })

  describe('Event format validation', () => {
    it('should include sessionId in all event payloads', () => {
      const messageId = 'msg-format-test-123'

      testEmitter.messageDelta(messageId, 'test', false)

      const calls = sendToRendererSpy.mock.calls
      const lastCall = calls[calls.length - 1]
      const payload = lastCall[2]

      expect(payload).toHaveProperty('sessionId', testSessionId)
    })

    it('should use correct AgenticEventType for all events', () => {
      const expectedEventTypes: AgenticEventType[] = [
        'agentic.message.delta' as AgenticEventType,
        'agentic.message.end' as AgenticEventType,
        'agentic.message.block' as AgenticEventType,
        'agentic.tool.start' as AgenticEventType,
        'agentic.tool.running' as AgenticEventType,
        'agentic.tool.end' as AgenticEventType,
        'agentic.tool.permission-required' as AgenticEventType,
        'agentic.tool.permission-granted' as AgenticEventType,
        'agentic.tool.permission-denied' as AgenticEventType,
        'agentic.session.ready' as AgenticEventType,
        'agentic.session.updated' as AgenticEventType,
        'agentic.status.changed' as AgenticEventType
      ]

      // Test each event type
      testEmitter.messageDelta('msg1', 'content', false)
      testEmitter.messageEnd('msg1')
      testEmitter.messageBlock('msg1', 'tool', {})
      testEmitter.toolStart('tool1', 'test_tool', {})
      testEmitter.toolRunning('tool1', 'running')
      testEmitter.toolEnd('tool1')
      testEmitter.toolPermissionRequired('tool1', 'test_tool', {} as PermissionRequestPayload)
      testEmitter.toolPermissionGranted('tool1')
      testEmitter.toolPermissionDenied('tool1')
      testEmitter.sessionReady('session1', 10)
      testEmitter.sessionUpdated({ sessionId: 'session1', status: 'idle' })
      testEmitter.statusChanged('generating')

      const calls = sendToRendererSpy.mock.calls

      for (let i = 0; i < expectedEventTypes.length; i++) {
        expect(calls[i][0]).toBe(expectedEventTypes[i])
      }
    })
  })

  describe('Multiple emitters for different sessions', () => {
    it('should create separate emitters for different sessions', () => {
      const sessionId1 = 'session-1'
      const sessionId2 = 'session-2'

      const emitter1 = agenticPresenter.createEventEmitter(sessionId1)
      const emitter2 = agenticPresenter.createEventEmitter(sessionId2)

      emitter1.messageDelta('msg1', 'content from session 1', false)
      emitter2.messageDelta('msg2', 'content from session 2', false)

      const calls = sendToRendererSpy.mock.calls

      // First call should be from emitter1 (session-1)
      expect(calls[0][2].sessionId).toBe(sessionId1)
      expect(calls[0][2].content).toBe('content from session 1')

      // Second call should be from emitter2 (session-2)
      expect(calls[1][2].sessionId).toBe(sessionId2)
      expect(calls[1][2].content).toBe('content from session 2')
    })
  })
})
