import { describe, expect, it, vi } from 'vitest'
import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import {
  SessionStatusPublisher,
  type SessionStatusPublisherPorts
} from '@/agent/deepchat/runtime/sessionStatusPublisher'

function createPublisher() {
  const ports: SessionStatusPublisherPorts = {
    publishEvent: vi.fn(),
    publishSessionUpdate: vi.fn(),
    sessionUiPort: { refreshSessionUi: vi.fn() }
  }
  return { ports, publisher: new SessionStatusPublisher(ports) }
}

describe('SessionStatusPublisher', () => {
  it('updates current state and publishes the four projections in order', () => {
    const runtime = new DeepChatAgentRuntime()
    const scope = runtime.getOrHydrateScope(toAppSessionId('session'))
    scope.instance.setRuntimeState({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-5',
      permissionMode: 'full_access'
    })
    const { ports, publisher } = createPublisher()

    expect(publisher.transition(scope, 'generating')).toBe(true)

    expect(scope.state()?.status).toBe('generating')
    expect(ports.publishEvent).toHaveBeenNthCalledWith(1, 'sessions.status.changed', {
      sessionId: 'session',
      status: 'generating',
      version: expect.any(Number)
    })
    expect(ports.publishEvent).toHaveBeenNthCalledWith(2, 'sessions.updated', {
      sessionIds: ['session'],
      reason: 'updated'
    })
    expect(ports.publishSessionUpdate).toHaveBeenCalledWith({
      sessionId: 'session',
      kind: 'status',
      updatedAt: expect.any(Number),
      status: 'generating'
    })
    expect(ports.sessionUiPort.refreshSessionUi).toHaveBeenCalledOnce()

    const order = [
      ...vi.mocked(ports.publishEvent).mock.invocationCallOrder,
      ...vi.mocked(ports.publishSessionUpdate).mock.invocationCallOrder,
      ...vi.mocked(ports.sessionUiPort.refreshSessionUi).mock.invocationCallOrder
    ]
    expect(order).toEqual([...order].sort((left, right) => left - right))
  })

  it('does not publish when state is missing and treats an unchanged status as success', () => {
    const runtime = new DeepChatAgentRuntime()
    const scope = runtime.getOrHydrateScope(toAppSessionId('session'))
    const { ports, publisher } = createPublisher()

    expect(publisher.transition(scope, 'idle')).toBe(false)
    scope.instance.setRuntimeState({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-5',
      permissionMode: 'full_access'
    })
    expect(publisher.transition(scope, 'idle')).toBe(true)

    expect(ports.publishEvent).not.toHaveBeenCalled()
    expect(ports.publishSessionUpdate).not.toHaveBeenCalled()
    expect(ports.sessionUiPort.refreshSessionUi).not.toHaveBeenCalled()
  })

  it('publishes terminal usage even when the projected status is already unchanged', () => {
    const runtime = new DeepChatAgentRuntime()
    const scope = runtime.getOrHydrateScope(toAppSessionId('session'))
    scope.instance.setRuntimeState({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-5',
      permissionMode: 'full_access'
    })
    const { ports, publisher } = createPublisher()

    expect(publisher.transition(scope, 'idle', { totalTokens: 12 })).toBe(true)

    expect(ports.publishSessionUpdate).toHaveBeenCalledWith({
      sessionId: 'session',
      kind: 'status',
      updatedAt: expect.any(Number),
      status: 'idle',
      usage: { totalTokens: 12 }
    })
    expect(ports.publishEvent).not.toHaveBeenCalled()
    expect(ports.sessionUiPort.refreshSessionUi).not.toHaveBeenCalled()
  })

  it('fences stale and mismatched scopes before mutating any instance', () => {
    const runtime = new DeepChatAgentRuntime()
    const sessionId = toAppSessionId('session')
    const staleScope = runtime.getOrHydrateScope(sessionId)
    staleScope.instance.setRuntimeState({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-5',
      permissionMode: 'full_access'
    })
    runtime.evict(sessionId)
    const currentScope = runtime.getOrHydrateScope(sessionId)
    currentScope.instance.setRuntimeState({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-5',
      permissionMode: 'full_access'
    })
    const otherScope = runtime.getOrHydrateScope(toAppSessionId('other'))
    otherScope.instance.setRuntimeState({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-5',
      permissionMode: 'full_access'
    })
    const mismatchedScope = runtime.scopeFor(sessionId, otherScope.instance)
    const { ports, publisher } = createPublisher()

    expect(publisher.transition(staleScope, 'error')).toBe(false)
    expect(publisher.transition(mismatchedScope, 'error')).toBe(false)

    expect(staleScope.state()?.status).toBe('idle')
    expect(currentScope.state()?.status).toBe('idle')
    expect(otherScope.state()?.status).toBe('idle')
    expect(ports.publishEvent).not.toHaveBeenCalled()
    expect(ports.publishSessionUpdate).not.toHaveBeenCalled()
    expect(ports.sessionUiPort.refreshSessionUi).not.toHaveBeenCalled()
  })
})
