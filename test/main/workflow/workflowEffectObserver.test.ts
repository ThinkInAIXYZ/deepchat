import { describe, expect, it, vi } from 'vitest'
import { TOOL_EXECUTION } from '@shared/types/mcp'
import { WorkflowToolEffectObserver } from '@/workflow/effectObserver'
import { WorkflowInvocationContextRegistry } from '@/workflow/invocationContextRegistry'

const activeInvocation = {
  id: 'invocation-1'
}

describe('WorkflowToolEffectObserver', () => {
  it('does not affect ordinary DeepChat sessions', () => {
    const repository = {
      recordEffectIntent: vi.fn()
    }
    const observer = new WorkflowToolEffectObserver(
      repository as any,
      new WorkflowInvocationContextRegistry()
    )

    observer.beforeToolExecution({
      conversationId: 'ordinary-session',
      toolCallId: 'call-1',
      toolName: 'read',
      source: 'agent',
      reviewedExecution: TOOL_EXECUTION.read.parallel
    })

    expect(repository.recordEffectIntent).not.toHaveBeenCalled()
  })

  it('trusts reviewed built-in contracts and treats shell execution as write', () => {
    const repository = {
      recordEffectIntent: vi.fn()
    }
    const contexts = new WorkflowInvocationContextRegistry()
    contexts.bind('workflow-child', {
      runId: 'run-1',
      invocationId: activeInvocation.id
    })
    const observer = new WorkflowToolEffectObserver(repository as any, contexts)

    observer.beforeToolExecution({
      conversationId: 'workflow-child',
      toolCallId: 'call-read',
      toolName: 'read',
      source: 'agent',
      reviewedExecution: TOOL_EXECUTION.read.parallel
    })
    observer.beforeToolExecution({
      conversationId: 'workflow-child',
      toolCallId: 'call-shell',
      toolName: 'exec',
      source: 'agent',
      reviewedExecution: TOOL_EXECUTION.write
    })

    expect(repository.recordEffectIntent).toHaveBeenNthCalledWith(
      1,
      'invocation-1',
      'read',
      expect.objectContaining({
        toolId: 'read',
        toolCallId: 'call-read',
        source: 'builtin',
        basis: 'reviewed_contract',
        classification: 'read'
      })
    )
    expect(repository.recordEffectIntent).toHaveBeenNthCalledWith(
      2,
      'invocation-1',
      'write',
      expect.objectContaining({
        toolId: 'exec',
        source: 'shell',
        classification: 'write'
      })
    )
  })

  it('never trusts arbitrary MCP read metadata and fails closed on persistence errors', () => {
    const persistenceError = new Error('workflow database unavailable')
    const repository = {
      recordEffectIntent: vi.fn().mockImplementation(() => {
        throw persistenceError
      })
    }
    const contexts = new WorkflowInvocationContextRegistry()
    contexts.bind('workflow-child', {
      runId: 'run-1',
      invocationId: activeInvocation.id
    })
    const observer = new WorkflowToolEffectObserver(repository as any, contexts)

    expect(() =>
      observer.beforeToolExecution({
        conversationId: 'workflow-child',
        toolCallId: 'call-mcp',
        toolName: 'remote_search',
        source: 'mcp',
        reviewedExecution: null
      })
    ).toThrow(persistenceError)

    expect(repository.recordEffectIntent).toHaveBeenCalledWith(
      'invocation-1',
      'write',
      expect.objectContaining({
        source: 'mcp',
        basis: 'conservative_fallback',
        classification: 'write'
      })
    )
  })

  it('uses unknown when a built-in definition lacks a recognized contract', () => {
    const repository = {
      recordEffectIntent: vi.fn()
    }
    const contexts = new WorkflowInvocationContextRegistry()
    contexts.bind('workflow-child', {
      runId: 'run-1',
      invocationId: activeInvocation.id
    })
    const observer = new WorkflowToolEffectObserver(repository as any, contexts)

    observer.beforeToolExecution({
      conversationId: 'workflow-child',
      toolCallId: 'call-unknown',
      toolName: 'future_builtin',
      source: 'agent',
      reviewedExecution: null
    })

    expect(repository.recordEffectIntent).toHaveBeenCalledWith(
      'invocation-1',
      'unknown',
      expect.objectContaining({
        source: 'unknown',
        basis: 'conservative_fallback',
        classification: 'unknown'
      })
    )
  })
})
