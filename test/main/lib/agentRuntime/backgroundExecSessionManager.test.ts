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
} from '@/lib/agentRuntime/backgroundExecSessionManager'

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
      ;(manager as never).appendOutput(session, 'later', {
        backgroundMs: 10000,
        timeoutSec: 1800,
        cleanupMs: 1800000,
        maxOutputChars: 500,
        offloadThresholdChars: 10000
      })

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

  it('merges the prepared env on top of process env when starting a session', async () => {
    const child = new MockChildProcess()
    vi.mocked(spawn).mockReturnValue(child as never)
    process.env.BASELINE_FLAG = 'baseline'

    try {
      const result = await manager.start('conv-1', 'echo test', '/workspace', {
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

  it('wraps Windows PowerShell commands before starting a session', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })
    process.env.PSModulePath = 'C:\\PowerShell\\Modules'
    const child = new MockChildProcess()
    vi.mocked(spawn).mockReturnValue(child as never)

    await manager.start('conv-1', 'dir', '/workspace', { timeout: 0 })

    expect(spawn).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-Command', expect.stringContaining('[Console]::OutputEncoding')],
      expect.objectContaining({
        detached: false
      })
    )
  })

  it('falls back to an available shell when the configured POSIX shell is missing', async () => {
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

    await manager.start('conv-1', 'echo test', '/workspace', { timeout: 0 })

    expect(spawn).toHaveBeenCalledWith(
      '/bin/sh',
      ['-c', 'echo test'],
      expect.objectContaining({
        cwd: expect.stringMatching(/[\\/]workspace$/)
      })
    )
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
      manager.start('conv-1', 'echo test', '/missing/workspace', { timeout: 0 })
    ).rejects.toThrow('Working directory does not exist or is not accessible')

    expect(spawn).not.toHaveBeenCalled()
  })

  it('decodes split UTF-8 output from running sessions', async () => {
    const child = new MockChildProcess()
    vi.mocked(spawn).mockReturnValue(child as never)

    const result = await manager.start('conv-1', 'echo test', '/workspace', { timeout: 0 })
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
    proxy.host = null
    proxy.hostReady = null
    proxy.shuttingDown = false
    proxy.activeSessions.clear()
    proxy.crashedSessions.clear()
    proxy.pendingRequests.clear()
  }

  beforeEach(() => {
    mockUtilityProcessFork.mockReset()
    resetProxyState()
  })

  afterEach(() => {
    resetProxyState()
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
})
