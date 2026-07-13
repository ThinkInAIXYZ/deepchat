import { describe, expect, it, vi } from 'vitest'
import { AcpRuntimeOwner } from '@/agent/acp/client/acpRuntimeOwner'
import type { AcpClientRuntime } from '@/agent/acp/client'

function createRuntime(calls: string[]): AcpClientRuntime {
  return {
    sessionManager: {
      clearSessionsByAgent: vi.fn(async (agentId: string) => {
        calls.push(`sessions.clear.${agentId}`)
      }),
      clearAllSessions: vi.fn(async () => {
        calls.push('sessions.clearAll')
      })
    },
    processManager: {
      release: vi.fn(async (agentId: string) => {
        calls.push(`process.release.${agentId}`)
      }),
      shutdown: vi.fn(async () => {
        calls.push('process.shutdown')
      })
    }
  } as unknown as AcpClientRuntime
}

describe('AcpRuntimeOwner', () => {
  it('lazily creates exactly one shared client runtime', () => {
    const calls: string[] = []
    const create = vi.fn(() => createRuntime(calls))
    const owner = new AcpRuntimeOwner(create)

    expect(owner.peek()).toBeUndefined()
    expect(owner.getOrCreate()).toBe(owner.getOrCreate())
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('fences lazy materialization synchronously even when no client exists yet', async () => {
    const calls: string[] = []
    const create = vi.fn(() => createRuntime(calls))
    const owner = new AcpRuntimeOwner(create)
    owner.registerDirectRuntime({
      closeAll: vi.fn(async () => {
        expect(() => owner.getOrCreate()).toThrow('Runtime owner is shutting-down')
        calls.push('direct.closeAll')
      }),
      closeByAgent: vi.fn()
    })

    await owner.shutdown()

    expect(calls).toEqual(['direct.closeAll'])
    expect(create).not.toHaveBeenCalled()
    expect(() => owner.getOrCreate()).toThrow('Runtime owner is closed')
  })

  it('closes direct instances before shared sessions and processes during global shutdown', async () => {
    const calls: string[] = []
    const owner = new AcpRuntimeOwner(() => createRuntime(calls))
    owner.getOrCreate()
    owner.registerDirectRuntime({
      closeAll: vi.fn(async () => {
        calls.push('direct.closeAll')
      }),
      closeByAgent: vi.fn()
    })

    await owner.shutdown()

    expect(calls).toEqual(['direct.closeAll', 'sessions.clearAll', 'process.shutdown'])
    expect(owner.peek()).toBeUndefined()
  })

  it('closes matching direct instances before refreshing shared agent state', async () => {
    const calls: string[] = []
    const owner = new AcpRuntimeOwner(() => createRuntime(calls))
    owner.getOrCreate()
    owner.registerDirectRuntime({
      closeAll: vi.fn(),
      closeByAgent: vi.fn(async (agentId: string) => {
        calls.push(`direct.close.${agentId}`)
      })
    })

    await owner.refreshAgents(['agent-a', 'agent-a'])

    expect(calls).toEqual([
      'direct.close.agent-a',
      'sessions.clear.agent-a',
      'process.release.agent-a'
    ])
  })

  it('still shuts down shared sessions and processes when direct cleanup fails', async () => {
    const calls: string[] = []
    const owner = new AcpRuntimeOwner(() => createRuntime(calls))
    owner.getOrCreate()
    owner.registerDirectRuntime({
      closeAll: vi.fn(async () => {
        calls.push('direct.closeAll')
        throw new Error('close failed')
      }),
      closeByAgent: vi.fn()
    })

    await expect(owner.shutdown()).rejects.toThrow('close failed')

    expect(calls).toEqual(['direct.closeAll', 'sessions.clearAll', 'process.shutdown'])
    expect(owner.peek()).toBeUndefined()
  })
})
