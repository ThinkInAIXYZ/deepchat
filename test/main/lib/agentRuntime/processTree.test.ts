import { EventEmitter } from 'events'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('child_process', () => ({
  spawn: vi.fn()
}))

import { spawn } from 'child_process'
import { terminateProcessTree } from '../../../../src/main/lib/agentRuntime/processTree'

class MockSpawnedProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = null
  stdin = null

  constructor(stdoutData = '') {
    super()
    queueMicrotask(() => {
      if (stdoutData) {
        this.stdout.emit('data', Buffer.from(stdoutData, 'utf-8'))
      }
      this.emit('close')
    })
  }
}

class MockChildProcess extends EventEmitter {
  pid: number
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  constructor(pid: number) {
    super()
    this.pid = pid
  }
}

describe('terminateProcessTree', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const originalKill = process.kill

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
    process.kill = originalKill
  })

  it('uses taskkill /T /F on Windows', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })

    vi.mocked(spawn).mockImplementation(() => {
      const child = new MockSpawnedProcess()
      queueMicrotask(() => child.emit('close'))
      return child as never
    })

    const child = new MockChildProcess(321)
    queueMicrotask(() => {
      child.signalCode = 'SIGTERM'
      child.emit('close', null, 'SIGTERM')
    })

    await expect(terminateProcessTree(child as never, { graceMs: 10 })).resolves.toBe(true)
    expect(spawn).toHaveBeenCalledWith('taskkill', ['/PID', '321', '/T', '/F'], {
      stdio: 'ignore'
    })
  })

  it('kills Unix process groups before escalating to SIGKILL', async () => {
    vi.useFakeTimers()
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'linux'
    })

    process.kill = vi.fn(((_pid: number, signal?: NodeJS.Signals) => {
      if (_pid === -654 && signal === 'SIGKILL') {
        queueMicrotask(() => {
          target.signalCode = 'SIGKILL'
          target.emit('close', null, 'SIGKILL')
        })
      }
      return true
    }) as typeof process.kill)

    const target = new MockChildProcess(654)
    const termination = terminateProcessTree(target as never, { graceMs: 10 })

    await vi.advanceTimersByTimeAsync(10)
    await expect(termination).resolves.toBe(true)

    expect(spawn).not.toHaveBeenCalled()
    expect(process.kill).toHaveBeenNthCalledWith(1, -654, 'SIGTERM')
    expect(process.kill).toHaveBeenNthCalledWith(2, -654, 'SIGKILL')
  })

  it('falls back to recursively killing descendants when Unix process-group signaling fails', async () => {
    vi.useFakeTimers()
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'linux'
    })

    vi.mocked(spawn).mockImplementation((command, args) => {
      if (command === 'pgrep') {
        const parentPid = args[1]
        if (parentPid === '777') {
          return new MockSpawnedProcess('778\n') as never
        }
        if (parentPid === '778') {
          return new MockSpawnedProcess('779\n') as never
        }
        return new MockSpawnedProcess() as never
      }

      return new MockSpawnedProcess() as never
    })

    process.kill = vi.fn(((pid: number, signal?: NodeJS.Signals) => {
      if (pid === -777) {
        const error = new Error('group not found') as NodeJS.ErrnoException
        error.code = 'ESRCH'
        throw error
      }

      if (pid === 777 && signal === 'SIGKILL') {
        queueMicrotask(() => {
          target.signalCode = 'SIGKILL'
          target.emit('close', null, 'SIGKILL')
        })
      }

      return true
    }) as typeof process.kill)

    const target = new MockChildProcess(777)
    const termination = terminateProcessTree(target as never, { graceMs: 10 })

    await vi.advanceTimersByTimeAsync(10)
    await expect(termination).resolves.toBe(true)

    expect(process.kill).toHaveBeenNthCalledWith(1, -777, 'SIGTERM')
    expect(process.kill).toHaveBeenNthCalledWith(2, 777, 'SIGTERM')
    expect(process.kill).toHaveBeenNthCalledWith(3, -777, 'SIGKILL')
    expect(process.kill).toHaveBeenNthCalledWith(4, 777, 'SIGKILL')

    expect(spawn).toHaveBeenNthCalledWith(1, 'pgrep', ['-P', '777'], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    expect(spawn).toHaveBeenNthCalledWith(2, 'pgrep', ['-P', '778'], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    expect(spawn).toHaveBeenNthCalledWith(3, 'pgrep', ['-P', '779'], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    expect(spawn).toHaveBeenNthCalledWith(4, 'kill', ['-TERM', '779'], {
      stdio: 'ignore'
    })
    expect(spawn).toHaveBeenNthCalledWith(5, 'kill', ['-TERM', '778'], {
      stdio: 'ignore'
    })
    expect(spawn).toHaveBeenNthCalledWith(6, 'pgrep', ['-P', '777'], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    expect(spawn).toHaveBeenNthCalledWith(7, 'pgrep', ['-P', '778'], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    expect(spawn).toHaveBeenNthCalledWith(8, 'pgrep', ['-P', '779'], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    expect(spawn).toHaveBeenNthCalledWith(9, 'kill', ['-KILL', '779'], {
      stdio: 'ignore'
    })
    expect(spawn).toHaveBeenNthCalledWith(10, 'kill', ['-KILL', '778'], {
      stdio: 'ignore'
    })
  })
})
