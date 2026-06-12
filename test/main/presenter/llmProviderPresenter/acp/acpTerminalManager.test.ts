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
      'pwd',
      [],
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
      'pwd',
      [],
      expect.objectContaining({
        cwd: expect.stringContaining(path.normalize('/tmp/deepchat-acp/terminals'))
      })
    )
  })

  it('passes command arguments directly without shell concatenation', async () => {
    const manager = new AcpTerminalManager()

    await manager.createTerminal({
      sessionId: 'session-1',
      command: 'node',
      args: ['-e', 'console.log("hello world")'],
      cwd: '/tmp/workspace'
    })

    expect(spawn).toHaveBeenCalledWith(
      'node',
      ['-e', 'console.log("hello world")'],
      expect.objectContaining({
        cwd: expect.stringContaining(path.normalize('/tmp/workspace'))
      })
    )
  })

  it('retains the latest terminal output when outputByteLimit is exceeded', async () => {
    const pty = createPty()
    vi.mocked(spawn).mockReturnValue(pty as never)
    const manager = new AcpTerminalManager()

    const response = await manager.createTerminal({
      sessionId: 'session-1',
      command: 'node',
      outputByteLimit: 6,
      cwd: '/tmp/workspace'
    })
    const onData = pty.onData.mock.calls[0][0] as (data: string) => void

    onData('abcdef')
    onData('ghij')

    await expect(
      manager.terminalOutput({ sessionId: 'session-1', terminalId: response.terminalId })
    ).resolves.toMatchObject({
      output: 'efghij',
      truncated: true
    })
  })
})
