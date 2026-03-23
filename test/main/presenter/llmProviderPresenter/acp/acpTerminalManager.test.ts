import fs from 'fs'
import path from 'path'
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
  const getShellExpectation = () =>
    process.platform === 'win32'
      ? expect.stringMatching(/powershell/i)
      : expect.stringMatching(/bash/i)

  const getArgsExpectation = (command: string) =>
    process.platform === 'win32' ? ['-NoLogo', '-Command', command] : ['-c', command]

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
      getShellExpectation(),
      getArgsExpectation('pwd'),
      expect.objectContaining({
        cwd: expect.stringContaining(path.normalize('/tmp/workspace'))
      })
    )
  })

  it('falls back to a controlled temp directory when cwd is missing', async () => {
    const manager = new AcpTerminalManager()

    await manager.createTerminal({
      sessionId: 'session-1',
      command: 'pwd'
    })

    expect(fs.mkdirSync).toHaveBeenCalledWith(path.normalize('/tmp/deepchat-acp/terminals'), {
      recursive: true
    })
    expect(spawn).toHaveBeenCalledWith(
      getShellExpectation(),
      getArgsExpectation('pwd'),
      expect.objectContaining({
        cwd: expect.stringContaining(path.normalize('/tmp/deepchat-acp/terminals'))
      })
    )
  })
})
