import { describe, it, expect, vi } from 'vitest'
import { AcpSessionManager } from '../../../src/main/presenter/acpPresenter/managers/sessionManager'

vi.mock('electron', () => ({
  app: {
    on: vi.fn()
  }
}))

describe('AcpSessionManager createSession error handling', () => {
  const agent = { id: 'agent1', name: 'Agent 1' }

  it('throws explicit shutdown error when process manager is shutting down', async () => {
    const manager = Object.create(AcpSessionManager.prototype) as any
    manager.processManager = {
      getConnection: vi
        .fn()
        .mockRejectedValue(
          new Error('[ACP] Process manager is shutting down, refusing to spawn new process')
        )
    }

    await expect(manager.createSession('conv1', agent as any, {} as any, '/tmp')).rejects.toThrow(
      '[ACP] Cannot create session: process manager is shutting down'
    )
  })

  it('rethrows non-shutdown getConnection errors', async () => {
    const manager = Object.create(AcpSessionManager.prototype) as any
    manager.processManager = {
      getConnection: vi.fn().mockRejectedValue(new Error('boom'))
    }

    await expect(manager.createSession('conv1', agent as any, {} as any, '/tmp')).rejects.toThrow(
      'boom'
    )
  })
})
