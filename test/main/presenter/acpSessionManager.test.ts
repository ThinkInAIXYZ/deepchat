import { describe, it, expect, vi } from 'vitest'
import { AcpSessionManager } from '../../../src/main/presenter/llmProviderPresenter/acp'

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

  it('preserves the original session initialization error when unbind fails', async () => {
    const manager = Object.create(AcpSessionManager.prototype) as any
    const initError = new Error('init failed')
    manager.processManager = {
      getConnection: vi.fn().mockResolvedValue({}),
      bindProcess: vi.fn(),
      unbindProcess: vi.fn().mockRejectedValue(new Error('cleanup failed'))
    }
    manager.initializeSession = vi.fn().mockRejectedValue(initError)

    await expect(manager.createSession('conv1', agent as any, {} as any, '/tmp')).rejects.toThrow(
      'init failed'
    )
    expect(manager.processManager.unbindProcess).toHaveBeenCalledWith('agent1', 'conv1')
  })

  it('continues newSession fallback when persisted-session detach throws', async () => {
    const manager = Object.create(AcpSessionManager.prototype) as any
    const throwingDetach = vi.fn(() => {
      throw new Error('detach failed')
    })
    const normalDetach = vi.fn()
    manager.processManager = {
      registerSessionWorkdir: vi.fn(),
      registerSessionListener: vi.fn().mockReturnValue(throwingDetach),
      registerPermissionResolver: vi.fn().mockReturnValue(normalDetach),
      clearSession: vi.fn()
    }
    manager.sessionPersistence = {
      getSessionData: vi.fn().mockResolvedValue({ sessionId: 'persisted-session' })
    }
    manager.resolveMcpServersForAgent = vi.fn().mockResolvedValue([])

    const handle = {
      supportsLoadSession: true,
      connection: {
        loadSession: vi.fn().mockRejectedValue(new Error('load failed')),
        newSession: vi.fn().mockResolvedValue({ sessionId: 'new-session' })
      }
    }

    const session = await manager.initializeSession(handle, 'conv1', agent as any, '/tmp', {
      onSessionUpdate: vi.fn(),
      onPermission: vi.fn()
    })

    expect(throwingDetach).toHaveBeenCalledTimes(1)
    expect(normalDetach).toHaveBeenCalledTimes(1)
    expect(manager.processManager.clearSession).toHaveBeenCalledWith('persisted-session')
    expect(handle.connection.newSession).toHaveBeenCalledWith({
      cwd: '/tmp',
      mcpServers: []
    })
    expect(session.sessionId).toBe('new-session')
  })
})
