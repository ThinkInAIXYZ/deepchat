import { afterEach, expect, it, vi } from 'vitest'
import { DimMcp, type DimMcpServer } from '@/agent/dim/mcp'
import { DimConnectionError, DimMethodError, type DimPluginClient } from '@/agent/dim/pluginClient'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'

const binding = (sessionId: string): DimSessionBinding => ({
  sessionId,
  dimSessionId: `native-${sessionId}`,
  branchId: 'main',
  generation: 1,
  cursor: '0',
  nextOrderSeq: 1,
  activeTurnId: null,
  assistantMessageId: null,
  status: 'idle'
})
afterEach(() => vi.useRealTimers())

it('isolates native MCP leases, rotates authorization and revokes removed selections', async () => {
  vi.useFakeTimers()
  const call = vi.fn().mockResolvedValue({})
  const client = { call } as unknown as DimPluginClient
  let token = 'old'
  let enabled = true
  const failed = vi.fn()
  const owner = new DimMcp({
    host: { start: async () => client },
    isCurrent: () => true,
    resolve: async () =>
      enabled ? { service: { type: 'http', url: 'http://localhost/mcp', headers: { token } } } : {},
    failed
  })
  await owner.refresh(binding('first'))
  await owner.refresh(binding('second'))
  const first = call.mock.calls[0][1]
  const second = call.mock.calls[1][1]
  expect(first.sessionId).toBe('native-first')
  expect(second.sessionId).toBe('native-second')
  expect(first.bindingId).not.toBe(second.bindingId)
  await owner.refresh(binding('first'))
  expect(call.mock.lastCall).toEqual([
    'session.mcp_temporary.renew',
    { sessionId: first.sessionId, bindingId: first.bindingId }
  ])
  token = 'rotated'
  await owner.refresh(binding('first'))
  expect(call.mock.calls.at(-2)).toEqual([
    'session.mcp_temporary.detach',
    { sessionId: first.sessionId, bindingId: first.bindingId }
  ])
  expect(call.mock.lastCall?.[1].servers.service.headers).toEqual({ token: 'rotated' })
  enabled = false
  await vi.advanceTimersByTimeAsync(10_000)
  expect(call.mock.calls.slice(-2).map((args) => args[0])).toEqual([
    'session.mcp_temporary.detach',
    'session.mcp_temporary.detach'
  ])
  expect(failed).not.toHaveBeenCalled()
  await owner.stop()
  expect(vi.getTimerCount()).toBe(0)
})

it('fences a superseded resolution and does not attach after desktop close', async () => {
  let finish!: (value: Record<string, DimMcpServer>) => void
  const call = vi.fn().mockResolvedValue({})
  const resolved = new Promise<Record<string, DimMcpServer>>((resolve) => (finish = resolve))
  const resolve = vi.fn(() => resolved)
  const owner = new DimMcp({
    host: { start: async () => ({ call }) as unknown as DimPluginClient },
    isCurrent: () => true,
    resolve,
    failed: vi.fn()
  })
  const opening = owner.refresh(binding('first'))
  await expect.poll(() => resolve.mock.calls.length).toBe(1)
  const closing = owner.close('first')
  finish({ service: { type: 'http', url: 'http://localhost/mcp', headers: {} } })
  await expect(opening).rejects.toThrow('replaced session scope')
  await closing
  expect(call).not.toHaveBeenCalled()
  await owner.stop()
})

it('rebuilds only an explicitly absent lease and surfaces unknown outcomes', async () => {
  const call = vi.fn().mockResolvedValue({})
  const client = { call } as unknown as DimPluginClient
  const owner = new DimMcp({
    host: { start: async () => client },
    isCurrent: () => true,
    resolve: async () => ({ service: { type: 'http', url: 'http://localhost/mcp', headers: {} } }),
    failed: vi.fn()
  })
  await owner.refresh(binding('first'))
  call.mockRejectedValueOnce(
    new DimMethodError(-32000, 'missing', { appError: 'mcp_binding_missing' })
  )
  await owner.refresh(binding('first'))
  expect(call.mock.lastCall?.[0]).toBe('session.mcp_temporary.attach')
  const beforeUnknown = call.mock.calls.length
  call.mockRejectedValueOnce(new DimConnectionError('lost acknowledgment', 'unknown'))
  await expect(owner.refresh(binding('first'))).rejects.toThrow('lost acknowledgment')
  expect(call.mock.calls.slice(beforeUnknown).map((args) => args[0])).toEqual([
    'session.mcp_temporary.renew',
    'session.mcp_temporary.detach'
  ])
  await owner.stop()
})
