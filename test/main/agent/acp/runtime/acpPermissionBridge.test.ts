import { describe, expect, it, vi } from 'vitest'
import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import { AcpPermissionBridge } from '@/agent/acp/runtime/acpPermissionBridge'

function createRequest(): schema.RequestPermissionRequest {
  return {
    sessionId: 'remote-session',
    toolCall: {
      toolCallId: 'tool-call',
      title: 'Run command',
      kind: 'execute',
      rawInput: { command: 'pnpm test' }
    },
    options: [
      { optionId: 'allow-always', kind: 'allow_always' },
      { optionId: 'allow-once', kind: 'allow_once' },
      { optionId: 'reject-always', kind: 'reject_always' },
      { optionId: 'reject-once', kind: 'reject_once' }
    ]
  }
}

describe('AcpPermissionBridge', () => {
  it('settles once and prioritizes allow_once and reject_once', async () => {
    const present = vi.fn()
    const settle = vi.fn()
    let sequence = 0
    const bridge = new AcpPermissionBridge({
      presentation: { present, settle },
      createRequestId: () => `request-${++sequence}`
    })
    const context = {
      providerId: 'acp' as const,
      providerName: 'ACP',
      conversationId: 'app-session',
      agent: { id: 'agent', name: 'Agent', command: 'agent-command' }
    }

    const allowed = bridge.request(createRequest(), context)
    expect(bridge.resolve('request-1', true)).toBe(true)
    expect(bridge.resolve('request-1', false)).toBe(false)
    await expect(allowed).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' }
    })

    const denied = bridge.request(createRequest(), context)
    expect(bridge.resolve('request-2', false)).toBe(true)
    await expect(denied).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'reject-once' }
    })
    expect(settle).toHaveBeenNthCalledWith(1, 'request-1', true)
    expect(settle).toHaveBeenNthCalledWith(2, 'request-2', false)
  })

  it('settles timeout, cancel, close, process-exit, and stale decisions without replay', async () => {
    vi.useFakeTimers()
    const settle = vi.fn()
    let sequence = 0
    const bridge = new AcpPermissionBridge({
      presentation: { present: vi.fn(), settle },
      timeoutMs: 10,
      createRequestId: () => `request-${++sequence}`
    })
    const context = {
      providerId: 'acp' as const,
      providerName: 'ACP',
      conversationId: 'app-session',
      agent: { id: 'agent', name: 'Agent', command: 'agent-command' }
    }

    const timedOut = bridge.request(createRequest(), context)
    await vi.advanceTimersByTimeAsync(10)
    await expect(timedOut).resolves.toEqual({ outcome: { outcome: 'cancelled' } })

    const processExit = bridge.request(createRequest(), context)
    expect(bridge.cancelSession('remote-session')).toBe(1)
    await expect(processExit).resolves.toEqual({ outcome: { outcome: 'cancelled' } })

    const closed = bridge.request(createRequest(), context)
    bridge.close()
    await expect(closed).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
    expect(bridge.resolve('request-3', true)).toBe(false)
    expect(settle).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })

  it('cancels when presentation is lost and keeps protocol settlement independent from UI errors', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const missingRenderer = new AcpPermissionBridge({
      presentation: {
        present: () => {
          throw new Error('renderer missing')
        },
        settle: vi.fn()
      },
      createRequestId: () => 'missing-renderer'
    })
    const context = {
      providerId: 'acp' as const,
      providerName: 'ACP',
      conversationId: 'app-session',
      agent: { id: 'agent', name: 'Agent', command: 'agent-command' }
    }

    await expect(missingRenderer.request(createRequest(), context)).resolves.toEqual({
      outcome: { outcome: 'cancelled' }
    })

    const brokenSettle = new AcpPermissionBridge({
      presentation: {
        present: vi.fn(),
        settle: () => {
          throw new Error('renderer closed')
        }
      },
      createRequestId: () => 'broken-settle'
    })
    const response = brokenSettle.request(createRequest(), context)
    expect(brokenSettle.resolve('broken-settle', true)).toBe(true)
    await expect(response).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' }
    })
    expect(warning).toHaveBeenCalledTimes(2)
    warning.mockRestore()
  })
})
