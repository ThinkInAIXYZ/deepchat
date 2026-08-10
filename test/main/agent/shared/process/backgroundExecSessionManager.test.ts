import { EventEmitter } from 'events'
import type { ChildProcess } from 'child_process'
import { spawn } from 'child_process'
import fs from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUtilityProcessFork } = vi.hoisted(() => ({
  mockUtilityProcessFork: vi.fn()
}))

vi.mock('child_process', () => ({
  spawn: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/mock/app'),
    getPath: vi.fn((name: string) => (name === 'userData' ? '/mock/userData' : '/mock/home'))
  },
  utilityProcess: {
    fork: mockUtilityProcessFork
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: false
  }
}))

vi.mock('@shared/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import {
  BackgroundExecSessionManager,
  backgroundExecSessionManager
} from '@/agent/shared/process/backgroundExecSessionManager'
import {
  CMD_COMMAND_SHELL,
  POSIX_COMMAND_SHELL,
  WINDOWS_POWERSHELL_COMMAND_SHELL
} from '../../../../helpers/commandShell'

class MockStream extends EventEmitter {}

class MockChildProcess extends EventEmitter {
  stdout = new MockStream()
  stderr = new MockStream()
  stdin = {
    write: vi.fn(),
    end: vi.fn(),
    destroyed: false
  }
  pid = 321
}

class MockUtilityProcess extends EventEmitter {
  postMessage = vi.fn()
  kill = vi.fn()
}

function mockStats(kind: 'file' | 'directory'): fs.Stats {
  return {
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'directory'
  } as fs.Stats
}

function normalizedPath(candidate: unknown): string {
  return String(candidate).replace(/\\/g, '/')
}

const PLATFORM_COMMAND_SHELL =
  process.platform === 'win32' ? WINDOWS_POWERSHELL_COMMAND_SHELL : POSIX_COMMAND_SHELL

describe('BackgroundExecSessionManager', () => {
  let manager: BackgroundExecSessionManager
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const originalPsModulePath = process.env.PSModulePath
  const originalShell = process.env.SHELL

  beforeEach(() => {
    manager = new BackgroundExecSessionManager()
    clearInterval((manager as never).cleanupIntervalId)
    mockUtilityProcessFork.mockReset()
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'statSync').mockImplementation((candidate) =>
      String(candidate).includes('workspace') ? mockStats('directory') : mockStats('file')
    )
    vi.spyOn(fs, 'accessSync').mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    ;(manager as never).sessions.clear()
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
    if (originalPsModulePath === undefined) {
      delete process.env.PSModulePath
    } else {
      process.env.PSModulePath = originalPsModulePath
    }
    if (originalShell === undefined) {
      delete process.env.SHELL
    } else {
      process.env.SHELL = originalShell
    }
  })

  const createSession = (overrides: Record<string, unknown> = {}) => ({
    sessionId: 'bg_123',
    conversationId: 'conv-1',
    command: 'echo test',
    child: { pid: 123 } as ChildProcess,
    status: 'done',
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    outputBuffer: '',
    outputFilePath: '/mock/session/bgexec_bg_123.log',
    outputWriteQueue: Promise.resolve(),
    totalOutputLength: 10001,
    previewChars: 500,
    offloadThresholdChars: 10000,
    offloadDisabled: false,
    stdoutEof: true,
    stderrEof: true,
    closePromise: Promise.resolve(),
    resolveClose: () => {},
    closeSettled: true,
    timedOut: false,
    ...overrides
  })

  const setSession = (session: Record<string, unknown>) => {
    ;(manager as never).sessions.set('conv-1', new Map([['bg_123', session]]))
  }

  it('keeps persisted output readable after future offloads are disabled', async () => {
    const session = createSession({
      outputBuffer: 'tail',
      totalOutputLength: 10004,
      offloadDisabled: true
    })
    setSession(session)

    const previewSpy = vi
      .spyOn(manager as never, 'readLastCharsFromFile' as never)
      .mockReturnValue('persisted-')
    const readSpy = vi
      .spyOn(manager as never, 'readFromFile' as never)
      .mockReturnValue('persisted-')

    const list = manager.list('conv-1')
    const poll = await manager.poll('conv-1', 'bg_123')
    const log = await manager.log('conv-1', 'bg_123', 0, 20)

    expect(list[0]?.offloaded).toBe(true)
    expect(poll.offloaded).toBe(true)
    expect(poll.output).toBe('persisted-tail')
    expect(log.offloaded).toBe(true)
    expect(log.output).toBe('persisted-tail')
    expect(previewSpy).toHaveBeenCalledTimes(1)
    expect(readSpy).toHaveBeenCalledTimes(1)
  })

  it('disables future offload attempts after an append failure', async () => {
    const session = createSession()
    const originalAppendFile = fs.promises.appendFile
    const appendFileMock = vi.fn().mockRejectedValue(new Error('disk full'))

    Object.defineProperty(fs.promises, 'appendFile', {
      configurable: true,
      value: appendFileMock
    })

    try {
      ;(manager as never).queueOutputWrite(session, 'failed-', 'append')
      await session.outputWriteQueue

      expect(session.offloadDisabled).toBe(true)
      expect(session.outputBuffer).toBe('failed-')
      ;(manager as never).appendOutput(session, 'later')

      expect(appendFileMock).toHaveBeenCalledTimes(1)
      expect(session.outputBuffer).toBe('failed-later')
    } finally {
      Object.defineProperty(fs.promises, 'appendFile', {
        configurable: true,
        value: originalAppendFile
      })
    }
  })

  it('waits for completion and returns a completion snapshot before cleanup', async () => {
    const session = createSession({
      status: 'done',
      outputBuffer: 'build complete'
    })
    setSession(session)

    const result = await manager.waitForCompletionOrYield('conv-1', 'bg_123', 10)

    expect(result).toEqual({
      kind: 'completed',
      result: {
        status: 'done',
        output: 'build complete',
        exitCode: null,
        offloaded: true,
        outputFilePath: '/mock/session/bgexec_bg_123.log',
        timedOut: false
      }
    })
  })

  it('returns running when the session outlives the yield window', async () => {
    vi.useFakeTimers()

    const session = createSession({
      status: 'running',
      closePromise: new Promise<void>(() => {})
    })
    setSession(session)

    const resultPromise = manager.waitForCompletionOrYield('conv-1', 'bg_123', 10)
    await vi.advanceTimersByTimeAsync(10)

    await expect(resultPromise).resolves.toEqual({
      kind: 'running',
      sessionId: 'bg_123'
    })
  })

  it('clears the yield timer when the session closes before the yield window elapses', async () => {
    vi.useFakeTimers()

    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const session = createSession({
      status: 'running',
      outputBuffer: 'build complete'
    })

    session.closePromise = Promise.resolve().then(() => {
      session.status = 'done'
    })

    setSession(session)

    await expect(manager.waitForCompletionOrYield('conv-1', 'bg_123', 1000)).resolves.toEqual({
      kind: 'completed',
      result: {
        status: 'done',
        output: 'build complete',
        exitCode: null,
        offloaded: true,
        outputFilePath: '/mock/session/bgexec_bg_123.log',
        timedOut: false
      }
    })

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
  })

  it('exposes timedOut metadata through poll and log', async () => {
    const session = createSession({
      status: 'killed',
      outputBuffer: 'timeout tail',
      totalOutputLength: 12,
      timedOut: true,
      outputFilePath: null
    })
    setSession(session)

    const poll = await manager.poll('conv-1', 'bg_123')
    const log = await manager.log('conv-1', 'bg_123', 0, 20)

    expect(poll.timedOut).toBe(true)
    expect(log.timedOut).toBe(true)
    expect(poll.output).toBe('timeout tail')
    expect(log.output).toBe('timeout tail')
  })

  it('uses the session preview limit unless poll supplies a newer Agent limit', async () => {
    setSession(
      createSession({
        outputBuffer: 'abcdefgh',
        outputFilePath: null,
        totalOutputLength: 8,
        previewChars: 3
      })
    )

    await expect(manager.poll('conv-1', 'bg_123')).resolves.toMatchObject({ output: 'fgh' })
    await expect(manager.poll('conv-1', 'bg_123', 5)).resolves.toMatchObject({ output: 'defgh' })
  })

  it('commits a process write after session preflight and before stdin mutation', () => {
    const order: string[] = []
    const child = new MockChildProcess()
    child.stdin.write.mockImplementation(() => {
      order.push('target')
      return true
    })
    setSession(createSession({ status: 'running', child }))

    manager.write('conv-1', 'bg_123', 'continue', false, () => order.push('commit'))

    expect(order).toEqual(['commit', 'target'])
  })

  it('does not commit process mutations rejected by local session preflight', async () => {
    const beforeMutation = vi.fn()
    setSession(createSession({ sessionId: 'bg_other', status: 'done' }))

    expect(() => manager.write('conv-1', 'missing', 'data', false, beforeMutation)).toThrow(
      'Session missing not found'
    )
    await expect(manager.kill('conv-1', 'missing', beforeMutation)).rejects.toThrow(
      'Session missing not found'
    )

    expect(beforeMutation).not.toHaveBeenCalled()
  })

  it('does not commit a kill that is already a local no-op', async () => {
    const beforeMutation = vi.fn()
    setSession(createSession({ status: 'done' }))

    await manager.kill('conv-1', 'bg_123', beforeMutation)

    expect(beforeMutation).not.toHaveBeenCalled()
  })

  it('merges the prepared env on top of process env when starting a session', async () => {
    const child = new MockChildProcess()
    vi.mocked(spawn).mockReturnValue(child as never)
    process.env.BASELINE_FLAG = 'baseline'

    try {
      const result = await manager.start('conv-1', 'echo test', '/workspace', {
        commandShell: PLATFORM_COMMAND_SHELL,
        timeout: 0,
        env: {
          PATH: '/prepared/bin:/usr/local/bin',
          CUSTOM_FLAG: '1'
        }
      })

      expect(result).toEqual({
        sessionId: expect.stringMatching(/^bg_/),
        status: 'running'
      })
      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          cwd: expect.stringMatching(/[\\/]workspace$/),
          env: expect.objectContaining({
            BASELINE_FLAG: 'baseline',
            PATH: '/prepared/bin:/usr/local/bin',
            CUSTOM_FLAG: '1'
          })
        })
      )
    } finally {
      delete process.env.BASELINE_FLAG
    }
  })

  it('spools output at a lower per-session threshold', async () => {
    const child = new MockChildProcess()
    vi.mocked(spawn).mockReturnValue(child as never)
    const appendFile = vi.spyOn(fs.promises, 'appendFile').mockResolvedValue(undefined)

    const result = await manager.start('conv-1', 'echo test', '/workspace', {
      commandShell: PLATFORM_COMMAND_SHELL,
      timeout: 0,
      offloadThresholdChars: 1_000
    })
    child.stdout.emit('data', 'x'.repeat(1_001))

    await vi.waitFor(() => expect(appendFile).toHaveBeenCalledOnce())
    expect(manager.list('conv-1')).toEqual([
      expect.objectContaining({
        sessionId: result.sessionId,
        outputLength: 1_001,
        offloaded: true
      })
    ])
  })

  it('caps a persisted single-line completion preview', async () => {
    const output = 'x'.repeat(500)
    vi.mocked(fs.statSync).mockReturnValue({ size: output.length } as fs.Stats)
    vi.spyOn(fs, 'openSync').mockReturnValue(1)
    vi.spyOn(fs, 'readSync').mockImplementation((_fd, buffer, offset, length, position) => {
      const start = position ?? 0
      return Buffer.from(output).copy(buffer as Buffer, offset, start, start + length)
    })
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined)
    setSession(
      createSession({
        totalOutputLength: output.length,
        offloadThresholdChars: 1
      })
    )

    const result = await manager.getCompletionResult('conv-1', 'bg_123', 100)

    expect(result.output).toBe('x'.repeat(100))
  })

  it('wraps Windows PowerShell commands before starting a session', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })
    process.env.PSModulePath = 'C:\\PowerShell\\Modules'
    const child = new MockChildProcess()
    vi.mocked(spawn).mockReturnValue(child as never)

    await manager.start('conv-1', 'dir', '/workspace', {
      commandShell: WINDOWS_POWERSHELL_COMMAND_SHELL,
      timeout: 0
    })

    expect(spawn).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-Command', expect.stringContaining('[Console]::OutputEncoding')],
      expect.objectContaining({
        detached: false,
        env: expect.objectContaining({
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1'
        })
      })
    )
  })

  it('spawns direct invocations without interpreting model-controlled arguments', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })
    const child = new MockChildProcess()
    vi.mocked(spawn).mockReturnValue(child as never)
    const args = [
      'script path.js',
      'value%PATH%',
      '"quoted"',
      '& whoami',
      '!delayed!',
      'line one\r\nline two',
      'trailing\\'
    ]

    await manager.start('conv-1', 'node.exe (direct invocation)', '/workspace', {
      commandShell: CMD_COMMAND_SHELL,
      directInvocation: {
        executable: 'node.exe',
        args
      },
      timeout: 0,
      env: { CUSTOM_FLAG: '1' }
    })

    expect(spawn).toHaveBeenCalledWith(
      'node.exe',
      args,
      expect.objectContaining({
        detached: false,
        windowsHide: true,
        env: expect.objectContaining({
          CUSTOM_FLAG: '1',
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1'
        })
      })
    )
  })

  it.each([
    { executable: '', args: [] },
    { executable: 'node.exe', args: ['valid', 1] }
  ])('rejects malformed direct invocations before spawning', async (directInvocation) => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })

    await expect(
      manager.start('conv-1', 'invalid direct invocation', '/workspace', {
        commandShell: CMD_COMMAND_SHELL,
        directInvocation: directInvocation as never,
        timeout: 0
      })
    ).rejects.toThrow()

    expect(spawn).not.toHaveBeenCalled()
  })

  it('uses the required POSIX shell spec without resolving utility-host environment state', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin'
    })
    process.env.SHELL = '/missing/zsh'
    vi.spyOn(fs, 'existsSync').mockImplementation((candidate) =>
      normalizedPath(candidate).endsWith('/workspace')
    )
    vi.spyOn(fs, 'statSync').mockImplementation((candidate) => {
      const value = normalizedPath(candidate)
      if (value.endsWith('/workspace')) {
        return mockStats('directory')
      }
      if (value === '/bin/sh') {
        return mockStats('file')
      }
      throw new Error('missing')
    })
    vi.spyOn(fs, 'accessSync').mockImplementation((candidate) => {
      if (String(candidate) === '/bin/sh') {
        return undefined
      }
      throw new Error('not executable')
    })
    const child = new MockChildProcess()
    vi.mocked(spawn).mockReturnValue(child as never)

    await manager.start('conv-1', 'echo test', '/workspace', {
      commandShell: POSIX_COMMAND_SHELL,
      timeout: 0
    })

    expect(spawn).toHaveBeenCalledWith(
      '/bin/sh',
      ['-c', 'echo test'],
      expect.objectContaining({
        cwd: expect.stringMatching(/[\\/]workspace$/)
      })
    )
  })

  it.each([
    undefined,
    { ...POSIX_COMMAND_SHELL, dialect: 'powershell' as const },
    WINDOWS_POWERSHELL_COMMAND_SHELL
  ])('rejects a missing or contradictory command shell before spawning', async (commandShell) => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'linux'
    })

    await expect(
      manager.start('conv-1', 'echo test', '/workspace', {
        commandShell: commandShell as never,
        timeout: 0
      })
    ).rejects.toThrow()

    expect(spawn).not.toHaveBeenCalled()
  })

  it('rejects missing working directories before spawn can report a misleading shell ENOENT', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin'
    })
    process.env.SHELL = '/bin/zsh'
    vi.spyOn(fs, 'existsSync').mockImplementation(
      (candidate) => !normalizedPath(candidate).endsWith('/missing/workspace')
    )
    vi.spyOn(fs, 'statSync').mockImplementation((candidate) =>
      String(candidate) === '/bin/zsh' ? mockStats('file') : mockStats('directory')
    )

    await expect(
      manager.start('conv-1', 'echo test', '/missing/workspace', {
        commandShell: POSIX_COMMAND_SHELL,
        timeout: 0
      })
    ).rejects.toThrow('Working directory does not exist or is not accessible')

    expect(spawn).not.toHaveBeenCalled()
  })

  it('decodes split UTF-8 output from running sessions', async () => {
    const child = new MockChildProcess()
    vi.mocked(spawn).mockReturnValue(child as never)

    const result = await manager.start('conv-1', 'echo test', '/workspace', {
      commandShell: PLATFORM_COMMAND_SHELL,
      timeout: 0
    })
    const bytes = Buffer.from('中文.txt\n', 'utf8')

    child.stdout.emit('data', bytes.subarray(0, 2))
    child.stdout.emit('data', bytes.subarray(2))
    child.stdout.emit('end')
    child.stderr.emit('end')
    child.emit('close', 0, null)

    await expect(
      manager.waitForCompletionOrYield('conv-1', result.sessionId, 100)
    ).resolves.toMatchObject({
      kind: 'completed',
      result: {
        status: 'done',
        output: '中文.txt\n',
        exitCode: 0,
        offloaded: false,
        timedOut: false
      }
    })
  })
})

describe('backgroundExecSessionManager utility proxy', () => {
  const resetProxyState = () => {
    const proxy = backgroundExecSessionManager as any
    proxy.stopCompletedSessionReconciliation()
    proxy.host = null
    proxy.hostReady = null
    proxy.shuttingDown = false
    proxy.activeSessions.clear()
    proxy.completedSessions.clear()
    proxy.crashedSessions.clear()
    proxy.pendingRequests.clear()
  }

  beforeEach(() => {
    mockUtilityProcessFork.mockReset()
    resetProxyState()
  })

  afterEach(() => {
    resetProxyState()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('forks the dedicated entrypoint for the utility host', async () => {
    const host = new MockUtilityProcess()
    mockUtilityProcessFork.mockReturnValue(host)

    const startPromise = (backgroundExecSessionManager as any).startHost()
    await vi.waitFor(() => {
      expect(mockUtilityProcessFork).toHaveBeenCalled()
    })
    host.emit('spawn')

    await expect(startPromise).resolves.toBe(host)
    expect(mockUtilityProcessFork).toHaveBeenCalledWith(
      expect.stringMatching(
        /[\\/]mock[\\/]app[\\/]out[\\/]main[\\/]backgroundExecUtilityHost\.js$/
      ),
      ['--deepchat-exec-utility-host'],
      expect.objectContaining({
        serviceName: 'DeepChat Exec Utility',
        env: expect.objectContaining({
          DEEPCHAT_EXEC_UTILITY_HOST: '1'
        })
      })
    )
  })

  it('returns crashed completion results without starting a fresh utility host', async () => {
    const proxy = backgroundExecSessionManager as any
    proxy.crashedSessions.set('bg_crashed', {
      conversationId: 'conv-1',
      sessionId: 'bg_crashed',
      command: 'pnpm test',
      createdAt: 1,
      lastAccessedAt: 1
    })

    await expect(
      backgroundExecSessionManager.waitForCompletionOrYield('conv-1', 'bg_crashed', 10)
    ).resolves.toEqual({
      kind: 'completed',
      result: {
        status: 'error',
        output: expect.stringContaining('pnpm test'),
        exitCode: null,
        offloaded: false,
        timedOut: false
      }
    })
    expect(mockUtilityProcessFork).not.toHaveBeenCalled()
  })

  it('keeps completed sessions visible when the utility host cannot list them', async () => {
    const proxy = backgroundExecSessionManager as any
    proxy.activeSessions.set('bg_completed', {
      conversationId: 'conv-1',
      sessionId: 'bg_completed',
      command: 'pnpm test',
      createdAt: 1,
      lastAccessedAt: 1
    })
    const request = vi.spyOn(proxy, 'request').mockResolvedValue({
      status: 'done',
      output: 'done',
      exitCode: 0,
      offloaded: false,
      timedOut: false
    })

    await backgroundExecSessionManager.poll('conv-1', 'bg_completed')

    await expect(backgroundExecSessionManager.list('conv-1')).resolves.toEqual([
      {
        sessionId: 'bg_completed',
        command: 'pnpm test',
        status: 'done',
        exitCode: 0,
        outputLength: 4,
        offloaded: false,
        timedOut: false,
        createdAt: 1,
        lastAccessedAt: expect.any(Number)
      }
    ])
    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith('poll', ['conv-1', 'bg_completed'])
    expect(mockUtilityProcessFork).not.toHaveBeenCalled()
  })

  it('refreshes completed-session fallback metadata after clearing output', async () => {
    const proxy = backgroundExecSessionManager as any
    proxy.completedSessions.set('bg_completed', {
      conversationId: 'conv-1',
      sessionId: 'bg_completed',
      command: 'pnpm test',
      createdAt: 1,
      lastAccessedAt: 1,
      status: 'done',
      exitCode: 0,
      outputLength: 4096,
      offloaded: true,
      timedOut: false
    })
    const request = vi.spyOn(proxy, 'request').mockResolvedValue(undefined)

    await backgroundExecSessionManager.clear('conv-1', 'bg_completed')

    await expect(backgroundExecSessionManager.list('conv-1')).resolves.toEqual([
      {
        sessionId: 'bg_completed',
        command: 'pnpm test',
        status: 'done',
        exitCode: 0,
        outputLength: 0,
        offloaded: false,
        timedOut: false,
        createdAt: 1,
        lastAccessedAt: expect.any(Number)
      }
    ])
    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith('clear', ['conv-1', 'bg_completed'])
  })

  it('does not restore completed metadata removed while clear is in flight', async () => {
    const proxy = backgroundExecSessionManager as any
    proxy.completedSessions.set('bg_completed', {
      conversationId: 'conv-1',
      sessionId: 'bg_completed',
      command: 'pnpm test',
      createdAt: 1,
      lastAccessedAt: 1,
      status: 'done',
      outputLength: 4096,
      offloaded: true,
      timedOut: false
    })
    let finishClear: (() => void) | undefined
    vi.spyOn(proxy, 'request').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishClear = resolve
        })
    )

    const clearPromise = backgroundExecSessionManager.clear('conv-1', 'bg_completed')
    await vi.waitFor(() => expect(finishClear).toBeTypeOf('function'))
    proxy.completedSessions.delete('bg_completed')
    finishClear?.()
    await clearPromise

    expect(proxy.completedSessions.has('bg_completed')).toBe(false)
  })

  it('removes crashed sessions locally without RPC', async () => {
    const proxy = backgroundExecSessionManager as any
    proxy.crashedSessions.set('bg_crashed', {
      conversationId: 'conv-1',
      sessionId: 'bg_crashed',
      command: 'pnpm test',
      createdAt: 1,
      lastAccessedAt: 1
    })

    await backgroundExecSessionManager.remove('conv-1', 'bg_crashed')

    expect(proxy.crashedSessions.has('bg_crashed')).toBe(false)
    expect(mockUtilityProcessFork).not.toHaveBeenCalled()
  })

  it('rejects unknown proxy mutations before committing dispatch', async () => {
    const beforeMutation = vi.fn()

    await expect(
      backgroundExecSessionManager.write('conv-1', 'missing', 'data', false, beforeMutation)
    ).rejects.toThrow('Session missing not found')

    expect(beforeMutation).not.toHaveBeenCalled()
    expect(mockUtilityProcessFork).not.toHaveBeenCalled()
  })

  it('commits tracked proxy writes before the utility-host request', async () => {
    const proxy = backgroundExecSessionManager as any
    const order: string[] = []
    proxy.activeSessions.set('bg_active', {
      conversationId: 'conv-1',
      sessionId: 'bg_active',
      command: 'pnpm test',
      createdAt: 1,
      lastAccessedAt: 1
    })
    const request = vi.spyOn(proxy, 'request').mockImplementation(async () => {
      order.push('target')
    })

    await backgroundExecSessionManager.write('conv-1', 'bg_active', 'data', false, () => {
      order.push('commit')
    })

    expect(order).toEqual(['commit', 'target'])
    expect(request).toHaveBeenCalledWith('write', ['conv-1', 'bg_active', 'data', false])
  })

  it.each([
    ['poll', 'remove'],
    ['log', 'clear']
  ] as const)(
    'allows the owning conversation to %s a completed session before %s',
    async (observation, mutation) => {
      const proxy = backgroundExecSessionManager as any
      const sessionId = `bg_${mutation}`
      proxy.activeSessions.set(sessionId, {
        conversationId: 'conv-1',
        sessionId,
        command: 'pnpm test',
        createdAt: 1,
        lastAccessedAt: 1
      })
      const beforeMutation = vi.fn()
      const request = vi.spyOn(proxy, 'request').mockImplementation(async (method: string) => {
        if (method === 'poll') {
          return {
            status: 'done',
            output: 'done',
            exitCode: 0,
            offloaded: false,
            timedOut: false
          }
        }
        if (method === 'log') {
          return {
            status: 'done',
            output: 'done',
            exitCode: 0,
            offloaded: false,
            timedOut: false,
            totalLength: 4
          }
        }
      })

      await backgroundExecSessionManager[observation]('conv-1', sessionId)
      await expect(
        backgroundExecSessionManager[mutation]('conv-other', sessionId, beforeMutation)
      ).rejects.toThrow(`Session ${sessionId} not found`)
      await backgroundExecSessionManager[mutation]('conv-1', sessionId, beforeMutation)

      expect(beforeMutation).toHaveBeenCalledOnce()
      expect(request).toHaveBeenCalledWith(mutation, ['conv-1', sessionId])
    }
  )

  it('treats killing a completed session as an authorized local no-op', async () => {
    const proxy = backgroundExecSessionManager as any
    proxy.completedSessions.set('bg_completed', {
      conversationId: 'conv-1',
      sessionId: 'bg_completed',
      command: 'pnpm test',
      createdAt: 1,
      lastAccessedAt: 1,
      status: 'done'
    })
    const beforeMutation = vi.fn()
    const request = vi.spyOn(proxy, 'request')

    await expect(
      backgroundExecSessionManager.kill('conv-other', 'bg_completed', beforeMutation)
    ).rejects.toThrow('Session bg_completed not found')
    await expect(
      backgroundExecSessionManager.kill('conv-1', 'bg_completed', beforeMutation)
    ).resolves.toBeUndefined()

    expect(beforeMutation).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
    expect(proxy.completedSessions.has('bg_completed')).toBe(true)
  })

  it('preserves a completion replaced while host list reconciliation is in flight', async () => {
    const proxy = backgroundExecSessionManager as any
    proxy.host = new MockUtilityProcess()
    const staleCompletion = {
      conversationId: 'conv-1',
      sessionId: 'bg_completed',
      command: 'pnpm test',
      createdAt: 1,
      lastAccessedAt: 1,
      status: 'done'
    }
    const concurrentCompletion = {
      ...staleCompletion,
      lastAccessedAt: 2,
      outputLength: 4
    }
    proxy.completedSessions.set('bg_completed', staleCompletion)
    let finishList: ((sessions: unknown[]) => void) | undefined
    vi.spyOn(proxy, 'request').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishList = resolve
        })
    )

    const listPromise = backgroundExecSessionManager.list('conv-1')
    await vi.waitFor(() => expect(finishList).toBeTypeOf('function'))
    proxy.completedSessions.set('bg_completed', concurrentCompletion)
    finishList?.([])
    await listPromise

    expect(proxy.completedSessions.get('bg_completed')).toBe(concurrentCompletion)
  })

  it('preserves completed metadata across host exit and resumes reconciliation after restart', async () => {
    vi.useFakeTimers()
    const proxy = backgroundExecSessionManager as any
    proxy.completedSessions.set('bg_completed', {
      conversationId: 'conv-1',
      sessionId: 'bg_completed',
      command: 'pnpm test',
      createdAt: 1,
      lastAccessedAt: 1,
      status: 'done'
    })
    const firstHost = new MockUtilityProcess()
    const secondHost = new MockUtilityProcess()
    mockUtilityProcessFork.mockReturnValueOnce(firstHost).mockReturnValueOnce(secondHost)

    const firstStart = proxy.startHost()
    await vi.waitFor(() => expect(mockUtilityProcessFork).toHaveBeenCalledTimes(1))
    firstHost.emit('spawn')
    await firstStart
    expect(proxy.completedSessionReconciliationTimer).not.toBeNull()

    firstHost.emit('exit', 1)
    expect(proxy.completedSessions.has('bg_completed')).toBe(true)
    expect(proxy.completedSessionReconciliationTimer).toBeNull()

    const secondStart = proxy.startHost()
    await vi.waitFor(() => expect(mockUtilityProcessFork).toHaveBeenCalledTimes(2))
    secondHost.emit('spawn')
    await secondStart

    expect(proxy.completedSessions.has('bg_completed')).toBe(true)
    expect(proxy.completedSessionReconciliationTimer).not.toBeNull()
  })

  it('reconciles completed ownership after the utility-host cleanup interval', async () => {
    vi.useFakeTimers()
    const proxy = backgroundExecSessionManager as any
    proxy.host = new MockUtilityProcess()
    proxy.activeSessions.set('bg_completed', {
      conversationId: 'conv-1',
      sessionId: 'bg_completed',
      command: 'pnpm test',
      createdAt: 1,
      lastAccessedAt: 1
    })
    const request = vi.spyOn(proxy, 'request').mockImplementation(async (method: string) => {
      if (method === 'poll') {
        return {
          status: 'done',
          output: 'done',
          exitCode: 0,
          offloaded: false,
          timedOut: false
        }
      }
      if (method === 'list') return []
      throw new Error(`Unexpected method: ${method}`)
    })

    await backgroundExecSessionManager.poll('conv-1', 'bg_completed')
    expect(proxy.completedSessions.has('bg_completed')).toBe(true)

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

    expect(request).toHaveBeenCalledWith('list', ['conv-1'])
    expect(proxy.completedSessions.has('bg_completed')).toBe(false)
    expect(proxy.completedSessionReconciliationTimer).toBeNull()
  })

  it.each(['clear', 'remove'] as const)(
    'treats %s as idempotent when host TTL cleanup already removed a completed session',
    async (mutation) => {
      const proxy = backgroundExecSessionManager as any
      proxy.completedSessions.set('bg_expired', {
        conversationId: 'conv-1',
        sessionId: 'bg_expired',
        command: 'pnpm test',
        createdAt: 1,
        lastAccessedAt: 1
      })
      const beforeMutation = vi.fn()
      vi.spyOn(proxy, 'request').mockRejectedValue(new Error('Session bg_expired not found'))

      await expect(
        backgroundExecSessionManager[mutation]('conv-1', 'bg_expired', beforeMutation)
      ).resolves.toBeUndefined()

      expect(beforeMutation).toHaveBeenCalledOnce()
      expect(proxy.completedSessions.has('bg_expired')).toBe(false)
    }
  )

  it.each(['clear', 'remove'] as const)(
    'does not hide unrelated utility-host errors during completed-session %s',
    async (mutation) => {
      const proxy = backgroundExecSessionManager as any
      proxy.completedSessions.set('bg_completed', {
        conversationId: 'conv-1',
        sessionId: 'bg_completed',
        command: 'pnpm test',
        createdAt: 1,
        lastAccessedAt: 1
      })
      const transportError = new Error('Utility host transport failed')
      vi.spyOn(proxy, 'request').mockRejectedValue(transportError)

      await expect(backgroundExecSessionManager[mutation]('conv-1', 'bg_completed')).rejects.toBe(
        transportError
      )

      expect(proxy.completedSessions.has('bg_completed')).toBe(true)
    }
  )
})
