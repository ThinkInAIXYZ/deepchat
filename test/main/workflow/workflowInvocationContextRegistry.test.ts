import { describe, expect, it } from 'vitest'
import { WorkflowInvocationContextRegistry } from '@/workflow/invocationContextRegistry'

describe('WorkflowInvocationContextRegistry', () => {
  it('binds idempotently and releases only the owning binding', () => {
    const registry = new WorkflowInvocationContextRegistry()
    const release = registry.bind(' child-1 ', {
      runId: 'run-1',
      invocationId: 'invocation-1'
    })
    const releaseDuplicate = registry.bind('child-1', {
      runId: 'run-1',
      invocationId: 'invocation-1'
    })

    expect(registry.get('child-1')).toEqual({
      runId: 'run-1',
      invocationId: 'invocation-1'
    })
    expect(registry.size).toBe(1)
    releaseDuplicate()
    expect(registry.size).toBe(1)
    release()
    release()
    expect(registry.get('child-1')).toBeNull()
  })

  it('rejects a conflicting invocation for one active child session', () => {
    const registry = new WorkflowInvocationContextRegistry()
    registry.bind('child-1', {
      runId: 'run-1',
      invocationId: 'invocation-1'
    })

    expect(() =>
      registry.bind('child-1', {
        runId: 'run-1',
        invocationId: 'invocation-2'
      })
    ).toThrow('already bound')
  })

  it('lets a completed workflow release the child for ordinary continued turns', () => {
    const registry = new WorkflowInvocationContextRegistry()
    const release = registry.bind('child-1', {
      runId: 'run-1',
      invocationId: 'invocation-1'
    })

    release()
    const releaseNext = registry.bind('child-1', {
      runId: 'run-2',
      invocationId: 'invocation-2'
    })
    expect(registry.get('child-1')?.invocationId).toBe('invocation-2')

    releaseNext()
    expect(registry.size).toBe(0)
  })
})
