import { EventEmitter, once } from 'events'
import type { ChildProcess } from 'child_process'
import { spawn } from 'child_process'
import fs from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSpawnHost,
  mockAssertPackageTree,
  mockCleanupPackageTree,
  mockTerminateProcessTree,
  registryMock
} = vi.hoisted(() => ({
  mockSpawnHost: vi.fn(),
  mockAssertPackageTree: vi.fn(),
  mockCleanupPackageTree: vi.fn(),
  mockTerminateProcessTree: vi.fn(),
  registryMock: {
    record: vi.fn(),
    clear: vi.fn(),
    reapStaleOnce: vi.fn().mockResolvedValue(null)
  }
}))

vi.mock('child_process', () => ({
  spawn: vi.fn()
}))

vi.mock('@shared/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('@/skill/skillExecutionPackageTree', () => ({
  assertSkillExecutionPackageTreeIntact: mockAssertPackageTree,
  cleanupOwnedSkillExecutionPackageTree: mockCleanupPackageTree
}))

vi.mock('@/agent/shared/process/processTree', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/agent/shared/process/processTree')>()),
  terminateProcessTree: mockTerminateProcessTree
}))

vi.mock('@/agent/shared/process/childProcessRegistry', () => ({
  childProcessRegistry: registryMock
}))

import {
  BackgroundExecSessionManager,
  BackgroundExecService
} from '@/agent/shared/process/backgroundExecSessionManager'
import type { ObservedProcessIdentity } from '@/agent/shared/process/childProcessRegistry'
import {
  CMD_COMMAND_SHELL,
  POSIX_COMMAND_SHELL,
  WINDOWS_POWERSHELL_COMMAND_SHELL
} from '../../../../helpers/commandShell'

class MockStream extends EventEmitter {
  destroy = vi.fn()
}

class MockChildProcess extends EventEmitter {
  stdout = new MockStream()
  stderr = new MockStream()
  stdin = {
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
    destroyed: false
  }
  pid = 321
  spawnargs: string[] = []
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  unref = vi.fn()
}

class MockUtilityProcess extends EventEmitter {
  onMessage(listener: (message: unknown) => void): void {
    this.on('message', listener)
  }
  onExit(listener: (code: number) => void): void {
    this.on('exit', listener)
  }
  onError(listener: (type: string, location: string) => void): void {
    this.on('error', listener)
  }
  postMessage = vi.fn()
  kill = vi.fn(async () => {})
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

const ownedPackageTree = () => ({
  schemaVersion: 1 as const,
  rootPath: '/tmp/deepchat-skill-exec-fixture',
  ownershipToken: '12345678-1234-4234-9234-123456789abc',
  packageHash: 'a'.repeat(64),
  files: [
    {
      relativePath: 'scripts/run.js',
      byteCount: 1,
      sha256: 'b'.repeat(64)
    }
  ]
})

describe('BackgroundExecSessionManager', () => {
  let manager: BackgroundExecSessionManager
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const originalPsModulePath = process.env.PSModulePath
  const originalShell = process.env.SHELL

  beforeEach(() => {
    manager = new BackgroundExecSessionManager()
    clearInterval((manager as never).cleanupIntervalId)
    vi.mocked(spawn).mockReset()
    mockSpawnHost.mockReset()
    mockAssertPackageTree.mockReset().mockResolvedValue(undefined)
    mockCleanupPackageTree.mockReset().mockResolvedValue(undefined)
    mockTerminateProcessTree.mockReset().mockResolvedValue(true)
    registryMock.record.mockReset().mockResolvedValue({ alive: true })
    registryMock.clear.mockReset()
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'statSync').mockImplementation((candidate) =>
      String(candidate).includes('workspace') ||
      normalizedPath(candidate) === normalizedPath(process.cwd())
        ? mockStats('directory')
        : mockStats('file')
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
    totalOutputBytes: 10001,
    maxOutputBytes: null,
    outputLimitExceeded: false,
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

  it('terminates a background process when its output byte limit is exceeded', async () => {
    const child = new MockChildProcess()
    vi.mocked(spawn).mockReturnValue(child as never)
    const nativeIdentity = 'darwin:00000000-0000-0000-0000-000000000000:42'
    registryMock.record.mockResolvedValueOnce({ alive: true, nativeIdentity })
    mockTerminateProcessTree.mockImplementationOnce(async () => {
      child.emit('close', 0, null)
      return true
    })

    const started = await manager.start('conv-1', 'node script.js', '/workspace', {
      commandShell: PLATFORM_COMMAND_SHELL,
      timeout: 0,
      maxOutputBytes: 8
    })

    child.stdout.emit('data', Buffer.from('12345678'))
    child.stdout.emit('data', Buffer.from('discarded'))
    await vi.waitFor(() =>
      expect(mockTerminateProcessTree).toHaveBeenCalledExactlyOnceWith(child, {
        graceMs: 2000,
        nativeIdentity
      })
    )

    const result = await manager.getCompletionResult('conv-1', started.sessionId, 500)
    expect(result.status).toBe('killed')
    expect(result.output).toContain('12345678')
    expect(result.output).toContain('output exceeded 8 bytes')
    expect(result.output).not.toContain('discarded')
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

  it('does not report completion before a running process closes', async () => {
    const child = new MockChildProcess()
    vi.mocked(spawn).mockReturnValue(child as never)

    const started = await manager.start('conv-1', 'echo test', '/workspace', {
      commandShell: PLATFORM_COMMAND_SHELL,
      timeout: 0
    })
    const onCompleted = vi.fn()
    const resultPromise = manager.getCompletionResult('conv-1', started.sessionId)
    void resultPromise.then(onCompleted)

    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(onCompleted).not.toHaveBeenCalled()

    child.stdout.emit('data', 'complete')
    child.stdout.emit('end')
    child.stderr.emit('end')
    child.emit('close', 0, null)

    await expect(resultPromise).resolves.toMatchObject({
      status: 'done',
      output: 'complete',
      exitCode: 0,
      timedOut: false
    })
  })

  it('records the launch in the child process registry when a session starts', async () => {
    const child = new MockChildProcess()
    vi.mocked(spawn).mockReturnValue(child as never)

    const started = await manager.start('conv-1', 'echo test', '/workspace', {
      commandShell: PLATFORM_COMMAND_SHELL,
      timeout: 0
    })

    expect(registryMock.record).toHaveBeenCalledWith(
      {
        subsystem: 'background-exec',
        recordId: started.sessionId,
        pid: child.pid,
        commandLine: expect.arrayContaining([PLATFORM_COMMAND_SHELL.executable]),
        cwd: expect.stringMatching(/[\\/]workspace$/)
      },
      child
    )
  })

  it('waits for registration and refuses an unregistered live command until retirement', async () => {
    const child = new MockChildProcess()
    vi.mocked(spawn).mockReturnValue(child as never)
    const registration = Promise.withResolvers<ObservedProcessIdentity | 'exited' | 'failed'>()
    registryMock.record.mockReturnValueOnce(registration.promise)
    const retirement = Promise.withResolvers<boolean>()
    mockTerminateProcessTree.mockReturnValueOnce(retirement.promise)
    const descriptor = ownedPackageTree()
    const starting = manager.start('conv-1', 'echo test', '/workspace', {
      commandShell: PLATFORM_COMMAND_SHELL,
      timeout: 0,
      ownedSkillExecutionPackageTree: descriptor
    })
    const settled = vi.fn()
    void starting.then(settled, settled)
    await vi.waitFor(() => expect(registryMock.record).toHaveBeenCalledOnce())
    expect(settled).not.toHaveBeenCalled()
    registration.resolve('failed')
    await vi.waitFor(() => expect(mockTerminateProcessTree).toHaveBeenCalledOnce())
    expect(settled).not.toHaveBeenCalled()
    expect(mockCleanupPackageTree).not.toHaveBeenCalled()
    child.signalCode = 'SIGTERM'
    child.emit('close', null, 'SIGTERM')
    expect(registryMock.clear).not.toHaveBeenCalled()
    expect(mockCleanupPackageTree).not.toHaveBeenCalled()
    expect(settled).not.toHaveBeenCalled()
    retirement.resolve(false)
    await expect(starting).rejects.toThrow('did not retire')
    await expect(manager.shutdown()).rejects.toThrow('did not retire')
    expect(mockCleanupPackageTree).not.toHaveBeenCalled()
    child.signalCode = 'SIGKILL'
    child.emit('close', null, 'SIGKILL')
    await expect(manager.shutdown()).rejects.toThrow('did not retire')
    await expect(
      manager.start('conv-1', 'echo test', '/workspace', {
        commandShell: PLATFORM_COMMAND_SHELL,
        timeout: 0
      })
    ).rejects.toThrow('stopping')
  })

  it('cleans a rejected launch but preserves commands that close before registration', async () => {
    const actual = await vi.importActual<typeof import('child_process')>('child_process')
    const processTree = await vi.importActual<typeof import('@/agent/shared/process/processTree')>(
      '@/agent/shared/process/processTree'
    )
    vi.mocked(spawn).mockImplementation(actual.spawn)
    mockTerminateProcessTree.mockImplementationOnce(processTree.terminateProcessTree)
    let child: ChildProcess | undefined
    registryMock.record.mockImplementationOnce(async () => {
      child = vi.mocked(spawn).mock.results[0].value as ChildProcess
      expect(child.pid).toBeGreaterThan(0)
      return 'failed'
    })
    try {
      await expect(
        manager.start('conv-1', 'owned command', process.cwd(), {
          commandShell: PLATFORM_COMMAND_SHELL,
          timeout: 0,
          directInvocation: {
            executable: process.execPath,
            args: ['-e', 'setInterval(() => {}, 1000)']
          }
        })
      ).rejects.toThrow('could not be registered')
      expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true)
      expect(() => process.kill(child!.pid!, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
    } finally {
      if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    expect(manager.list('conv-1')).toEqual([])

    const quick = new MockChildProcess()
    vi.mocked(spawn).mockReturnValueOnce(quick as never)
    registryMock.record.mockImplementationOnce(async () => {
      setImmediate(() => {
        quick.exitCode = 0
        quick.stdout.emit('data', 'quick command')
        quick.emit('close', 0, null)
      })
      return 'exited'
    })
    const started = await manager.start('conv-1', 'echo test', '/workspace', {
      commandShell: PLATFORM_COMMAND_SHELL,
      timeout: 0
    })
    await expect(manager.getCompletionResult('conv-1', started.sessionId)).resolves.toMatchObject({
      status: 'done',
      output: 'quick command',
      exitCode: 0
    })
  })

  it.skipIf(process.platform !== 'darwin')(
    'gates real exec and environment until registration and retires on EOF or oversized grants',
    async () => {
      const actual = await vi.importActual<typeof import('child_process')>('child_process')
      const originalExecutable = process.env.DEEPCHAT_HARNESS_EXECUTABLE
      const originalNativeValue = process.env.DEEPCHAT_NATIVE_ENV_ONLY
      process.env.DEEPCHAT_HARNESS_EXECUTABLE = `${process.cwd()}/out/harness/deepchat-harness-${process.platform}-${process.arch}`
      process.env.DEEPCHAT_NATIVE_ENV_ONLY = 'bootstrap-only'
      vi.mocked(spawn).mockImplementation(actual.spawn)
      try {
        for (const action of ['release', 'eof', 'oversize']) {
          const registration = Promise.withResolvers<
            ObservedProcessIdentity | 'exited' | 'failed'
          >()
          registryMock.record.mockClear().mockReturnValueOnce(registration.promise)
          vi.mocked(spawn).mockClear()
          const starting = manager.start('conv-1', 'owned gated command', process.cwd(), {
            commandShell: PLATFORM_COMMAND_SHELL,
            timeout: 0,
            env: { DEEPCHAT_GATE_VALUE: 'released-environment' },
            directInvocation: {
              executable: process.execPath,
              args: [
                '-e',
                `let input = ''; process.stdin.on('data', (data) => { input += data }); process.stdin.on('end', () => { process.stdout.write(JSON.stringify({ pid: process.pid, env: process.env.DEEPCHAT_GATE_VALUE, inherited: process.env.DEEPCHAT_NATIVE_ENV_ONLY ?? null, input }), () => process.exit(0)) })`
              ]
            }
          })
          void starting.catch(() => {})
          let child: ChildProcess | undefined
          try {
            await vi.waitFor(() => expect(registryMock.record).toHaveBeenCalledOnce())
            child = vi.mocked(spawn).mock.results[0].value as ChildProcess
            const gate = child.stdio[3]!
            expect(vi.mocked(spawn).mock.calls[0][2]?.env?.DEEPCHAT_GATE_VALUE).toBeUndefined()
            child.stdin!.write('preserved input')
            if (action === 'release') {
              registration.resolve({
                alive: true,
                nativeIdentity: 'darwin:00000000-0000-0000-0000-000000000000:42'
              })
              const started = await starting
              await vi.waitFor(() => expect(gate.closed).toBe(true))
              expect(child.exitCode).toBeNull()
              child.stdin!.end()
              const completed = await manager.getCompletionResult('conv-1', started.sessionId)
              expect(JSON.parse(completed.output)).toEqual({
                pid: child.pid,
                env: 'released-environment',
                inherited: null,
                input: 'preserved input'
              })
              await manager.remove('conv-1', started.sessionId)
            } else {
              const closed = once(child, 'close', { signal: AbortSignal.timeout(2000) })
              if (action === 'eof') {
                mockTerminateProcessTree.mockClear()
                await manager.kill('conv-1', manager.list('conv-1')[0].sessionId)
                expect(mockTerminateProcessTree).not.toHaveBeenCalled()
              } else if ('write' in gate) {
                const header = Buffer.alloc(4)
                header.writeUInt32BE(2 * 1024 * 1024 + 1)
                gate.write(header)
              }
              await closed
              registration.resolve('exited')
              await expect(starting).rejects.toThrow('launch stopped')
              expect(manager.list('conv-1')).toEqual([])
            }
          } finally {
            const closed =
              child && child.exitCode === null && child.signalCode === null
                ? once(child, 'close')
                : Promise.resolve()
            child?.stdin?.end()
            child?.stdio[3]?.destroy()
            registration.resolve('exited')
            await starting.catch(() => {})
            await closed
          }
        }
      } finally {
        if (originalExecutable === undefined) delete process.env.DEEPCHAT_HARNESS_EXECUTABLE
        else process.env.DEEPCHAT_HARNESS_EXECUTABLE = originalExecutable
        if (originalNativeValue === undefined) delete process.env.DEEPCHAT_NATIVE_ENV_ONLY
        else process.env.DEEPCHAT_NATIVE_ENV_ONLY = originalNativeValue
      }
    }
  )

  it('clears the registry record when the session process closes', async () => {
    const child = new MockChildProcess()
    vi.mocked(spawn).mockReturnValue(child as never)

    const started = await manager.start('conv-1', 'echo test', '/workspace', {
      commandShell: PLATFORM_COMMAND_SHELL,
      timeout: 0
    })

    child.stdout.emit('end')
    child.stderr.emit('end')
    child.emit('close', 0, null)

    await vi.waitFor(() =>
      expect(registryMock.clear).toHaveBeenCalledWith('background-exec', started.sessionId)
    )
  })

  it('bounds completion when an exited process never closes inherited stdio', async () => {
    vi.useFakeTimers()
    const child = new MockChildProcess()
    vi.mocked(spawn).mockReturnValue(child as never)

    const started = await manager.start('conv-1', 'echo test', '/workspace', {
      commandShell: PLATFORM_COMMAND_SHELL,
      timeout: 0
    })
    const onCompleted = vi.fn()
    const resultPromise = manager.getCompletionResult('conv-1', started.sessionId)
    void resultPromise.then(onCompleted)

    child.stdout.emit('data', 'complete')
    child.emit('exit', 0, null)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(onCompleted).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await expect(resultPromise).resolves.toMatchObject({
      status: 'done',
      output: 'complete',
      exitCode: 0,
      timedOut: false
    })
    expect(child.stdout.destroy).toHaveBeenCalledOnce()
    expect(child.stderr.destroy).toHaveBeenCalledOnce()
    expect(child.stdin.destroy).toHaveBeenCalledOnce()

    child.emit('close', 7, null)
    await expect(manager.poll('conv-1', started.sessionId)).resolves.toMatchObject({
      status: 'done',
      exitCode: 0
    })
  })

  it('keeps native completion and ownership behind the physical group receipt', async () => {
    const descriptor = ownedPackageTree()
    for (const retired of [true, false]) {
      const child = new MockChildProcess()
      vi.mocked(spawn).mockReturnValueOnce(child as never)
      registryMock.record.mockResolvedValueOnce({
        alive: true,
        nativeIdentity: 'darwin:00000000-0000-0000-0000-000000000000:42'
      })
      const physical = Promise.withResolvers<boolean>()
      mockTerminateProcessTree.mockReturnValueOnce(physical.promise)
      const started = await manager.start('conv-1', 'echo complete', '/workspace', {
        commandShell: PLATFORM_COMMAND_SHELL,
        timeout: 0,
        ownedSkillExecutionPackageTree: descriptor
      })
      const cleared = registryMock.clear.mock.calls.length
      const cleaned = mockCleanupPackageTree.mock.calls.length
      child.stdout.emit('data', 'complete')
      child.exitCode = 0
      child.emit('exit', 0, null)
      child.emit('close', 0, null)
      const completion = manager.getCompletionResult('conv-1', started.sessionId)
      const settled = vi.fn()
      void completion.then(settled, settled)
      await Promise.resolve()
      expect(settled).not.toHaveBeenCalled()
      expect(
        manager.list('conv-1').find((item) => item.sessionId === started.sessionId)?.status
      ).toBe('running')
      expect(registryMock.clear).toHaveBeenCalledTimes(cleared)
      expect(mockCleanupPackageTree).toHaveBeenCalledTimes(cleaned)
      physical.resolve(retired)
      if (retired) {
        await expect(completion).resolves.toMatchObject({
          status: 'done',
          exitCode: 0,
          output: 'complete'
        })
        expect(registryMock.clear).toHaveBeenCalledTimes(cleared + 1)
        expect(mockCleanupPackageTree).toHaveBeenCalledTimes(cleaned + 1)
      } else {
        await expect(completion).rejects.toThrow('did not retire')
        child.emit('close', 0, null)
        await expect(manager.poll('conv-1', started.sessionId)).rejects.toThrow('did not retire')
        expect(registryMock.clear).toHaveBeenCalledTimes(cleared)
        expect(mockCleanupPackageTree).toHaveBeenCalledTimes(cleaned)
        await expect(manager.shutdown()).rejects.toThrow('did not retire')
      }
    }
  })

  it('clears the close watchdog when another path finalizes the session', async () => {
    vi.useFakeTimers()
    const child = new MockChildProcess()
    vi.mocked(spawn).mockReturnValue(child as never)
    mockTerminateProcessTree.mockResolvedValueOnce(false)

    const started = await manager.start('conv-1', 'echo test', '/workspace', {
      commandShell: PLATFORM_COMMAND_SHELL,
      timeout: 0
    })
    child.emit('exit', 0, null)
    expect(vi.getTimerCount()).toBe(1)

    await expect(manager.kill('conv-1', started.sessionId)).rejects.toThrow('did not retire')

    expect(vi.getTimerCount()).toBe(0)
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

  it('retains an owned package tree when the process tree cannot be terminated', async () => {
    const descriptor = ownedPackageTree()
    let resolveClose = () => {}
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve
    })
    const session = createSession({
      status: 'running',
      child: new MockChildProcess(),
      closeSettled: false,
      closePromise,
      resolveClose,
      ownedSkillExecutionPackageTree: descriptor
    })
    setSession(session)
    mockTerminateProcessTree.mockResolvedValueOnce(false)

    await expect(manager.kill('conv-1', 'bg_123')).rejects.toThrow('did not retire')

    expect(mockCleanupPackageTree).not.toHaveBeenCalled()
    expect(session.ownedSkillExecutionPackageTree).toBeUndefined()
    expect(session.child.stdout.destroy).toHaveBeenCalledOnce()
    expect(session.child.stderr.destroy).toHaveBeenCalledOnce()
    expect(session.child.stdin.destroy).toHaveBeenCalledOnce()
    expect(session.child.unref).toHaveBeenCalledOnce()
  })

  it('uses the granted environment without inheriting utility variables', async () => {
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
            PATH: '/prepared/bin:/usr/local/bin',
            CUSTOM_FLAG: '1'
          })
        })
      )
      expect(vi.mocked(spawn).mock.calls[0][2]?.env?.BASELINE_FLAG).toBeUndefined()
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

  it('verifies and cleans an owned package tree when its process completes', async () => {
    const child = new MockChildProcess()
    vi.mocked(spawn).mockReturnValue(child as never)
    const descriptor = ownedPackageTree()

    const result = await manager.start('conv-1', 'node script.js', '/workspace', {
      commandShell: PLATFORM_COMMAND_SHELL,
      timeout: 0,
      ownedSkillExecutionPackageTree: descriptor
    })
    expect(mockAssertPackageTree).toHaveBeenCalledWith(descriptor)

    child.stdout.emit('end')
    child.stderr.emit('end')
    child.emit('close', 0, null)
    await manager.waitForCompletionOrYield('conv-1', result.sessionId, 100)

    expect(mockCleanupPackageTree).toHaveBeenCalledOnce()
    expect(mockCleanupPackageTree).toHaveBeenCalledWith(descriptor)
  })

  it('fails closed and cleans before spawn when an owned package tree drifts', async () => {
    const descriptor = ownedPackageTree()
    mockAssertPackageTree.mockRejectedValueOnce(new Error('package drifted'))

    await expect(
      manager.start('conv-1', 'node script.js', '/workspace', {
        commandShell: PLATFORM_COMMAND_SHELL,
        timeout: 0,
        ownedSkillExecutionPackageTree: descriptor
      })
    ).rejects.toThrow('package drifted')

    expect(spawn).not.toHaveBeenCalled()
    expect(mockCleanupPackageTree).toHaveBeenCalledWith(descriptor)
  })
})

describe('backgroundExecSessionManager utility proxy', () => {
  let backgroundExecSessionManager: BackgroundExecService

  beforeEach(() => {
    mockSpawnHost.mockReset()
    mockAssertPackageTree.mockReset().mockResolvedValue(undefined)
    mockCleanupPackageTree.mockReset().mockResolvedValue(undefined)
    mockTerminateProcessTree.mockReset().mockResolvedValue(true)
    backgroundExecSessionManager = new BackgroundExecService(mockSpawnHost)
  })

  afterEach(() => {
    ;(backgroundExecSessionManager as any).stopCompletedSessionReconciliation()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('cleans an owned tree when utility ownership was never posted', async () => {
    const proxy = backgroundExecSessionManager as any
    const descriptor = ownedPackageTree()
    vi.spyOn(proxy, 'request').mockRejectedValue(new Error('host unavailable'))

    await expect(
      backgroundExecSessionManager.start('conv-1', 'node script.js', '/workspace', {
        commandShell: PLATFORM_COMMAND_SHELL,
        ownedSkillExecutionPackageTree: descriptor
      })
    ).rejects.toThrow('host unavailable')

    expect(mockCleanupPackageTree).toHaveBeenCalledWith(descriptor)
  })

  it('runs the final start guard after the utility is ready but before posting ownership', async () => {
    const proxy = backgroundExecSessionManager as any
    const descriptor = ownedPackageTree()
    const order: string[] = []
    vi.spyOn(proxy, 'request').mockImplementation(
      async (
        _method: string,
        _args: unknown[],
        lifecycle: { beforePost?: () => Promise<void>; onPosted?: () => void }
      ) => {
        await lifecycle.beforePost?.()
        lifecycle.onPosted?.()
        order.push('posted')
        throw new Error('utility rejected start')
      }
    )

    await expect(
      backgroundExecSessionManager.start(
        'conv-1',
        'node script.js',
        '/workspace',
        {
          commandShell: PLATFORM_COMMAND_SHELL,
          ownedSkillExecutionPackageTree: descriptor
        },
        async () => {
          order.push('guarded')
        }
      )
    ).rejects.toThrow('utility rejected start')

    expect(order).toEqual(['guarded', 'posted'])
    expect(mockCleanupPackageTree).not.toHaveBeenCalled()
  })

  it('does not delete utility-owned package trees when the host crashes', async () => {
    const proxy = backgroundExecSessionManager as any
    proxy.activeSessions.set('bg_owned', {
      conversationId: 'conv-1',
      sessionId: 'bg_owned',
      command: 'node script.js',
      createdAt: 1,
      lastAccessedAt: 1
    })

    proxy.handleHostExit(1)
    await Promise.resolve()

    expect(mockCleanupPackageTree).not.toHaveBeenCalled()
    expect(proxy.activeSessions.size).toBe(0)
    expect(proxy.crashedSessions.has('bg_owned')).toBe(true)
  })

  it('clears local conversation state when utility-host cleanup fails', async () => {
    const proxy = backgroundExecSessionManager as any
    const session = {
      conversationId: 'conv-1',
      sessionId: 'bg_session',
      command: 'pnpm test',
      createdAt: 1,
      lastAccessedAt: 1
    }
    proxy.activeSessions.set('bg_active', { ...session, sessionId: 'bg_active' })
    proxy.crashedSessions.set('bg_crashed', { ...session, sessionId: 'bg_crashed' })
    proxy.completedSessions.set('bg_completed', {
      ...session,
      sessionId: 'bg_completed',
      status: 'done',
      outputLength: 0,
      offloaded: false,
      timedOut: false
    })
    vi.spyOn(proxy, 'request').mockRejectedValue(new Error('utility host unavailable'))

    await expect(backgroundExecSessionManager.cleanupConversation('conv-1')).rejects.toThrow(
      'utility host unavailable'
    )

    expect(proxy.activeSessions.size).toBe(0)
    expect(proxy.crashedSessions.size).toBe(0)
    expect(proxy.completedSessions.size).toBe(0)
    expect(proxy.completedSessionReconciliationTimer).toBeNull()
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
    expect(mockSpawnHost).not.toHaveBeenCalled()
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
    expect(mockSpawnHost).not.toHaveBeenCalled()
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
    expect(mockSpawnHost).not.toHaveBeenCalled()
  })

  it('rejects unknown proxy mutations before committing dispatch', async () => {
    const beforeMutation = vi.fn()

    await expect(
      backgroundExecSessionManager.write('conv-1', 'missing', 'data', false, beforeMutation)
    ).rejects.toThrow('Session missing not found')

    expect(beforeMutation).not.toHaveBeenCalled()
    expect(mockSpawnHost).not.toHaveBeenCalled()
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
    mockSpawnHost.mockReturnValueOnce(firstHost).mockReturnValueOnce(secondHost)

    const firstStart = proxy.startHost()
    await vi.waitFor(() => expect(mockSpawnHost).toHaveBeenCalledTimes(1))
    firstHost.emit('spawn')
    await firstStart
    expect(proxy.completedSessionReconciliationTimer).not.toBeNull()

    firstHost.emit('exit', 1)
    expect(proxy.completedSessions.has('bg_completed')).toBe(true)
    expect(proxy.completedSessionReconciliationTimer).toBeNull()

    const secondStart = proxy.startHost()
    await vi.waitFor(() => expect(mockSpawnHost).toHaveBeenCalledTimes(2))
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
