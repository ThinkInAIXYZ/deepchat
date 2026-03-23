import fs from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AcpTerminalManager } from '@/presenter/llmProviderPresenter/acp/acpTerminalManager'
import { spawn } from 'node-pty'

vi.mock('node-pty', () => ({
  spawn: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => (name === 'temp' ? '/tmp' : '/tmp'))
  }
}))

describe('AcpTerminalManager', () => {
  const createPty = () => ({
    onData: vi.fn(),
    onExit: vi.fn(),
    kill: vi.fn()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
    vi.mocked(spawn).mockReturnValue(createPty() as never)
  })

  it('uses the provided cwd when one is supplied', async () => {
    const manager = new AcpTerminalManager()

    await manager.createTerminal({
      sessionId: 'session-1',
      command: 'pwd',
      cwd: '/tmp/workspace'
    })

    expect(spawn).toHaveBeenCalledWith(
      '/bin/bash',
      ['-c', 'pwd'],
      expect.objectContaining({
        cwd: '/tmp/workspace'
      })
    )
  })

  it('falls back to a controlled temp directory when cwd is missing', async () => {
    const manager = new AcpTerminalManager()

    await manager.createTerminal({
      sessionId: 'session-1',
      command: 'pwd'
    })

    expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/deepchat-acp/terminals', {
      recursive: true
    })
    expect(spawn).toHaveBeenCalledWith(
      '/bin/bash',
      ['-c', 'pwd'],
      expect.objectContaining({
        cwd: '/tmp/deepchat-acp/terminals'
      })
    )
  })
})
