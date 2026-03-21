import { EventEmitter } from 'events'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('child_process', () => ({
  spawn: vi.fn()
}))

import { spawn } from 'child_process'
import { terminateProcessTree } from '../../../../src/main/lib/agentRuntime/processTree'

class MockSpawnedProcess extends EventEmitter {
  stdout = null
  stderr = null
  stdin = null
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

  it('kills Unix children before escalating to SIGKILL on the parent', async () => {
    vi.useFakeTimers()
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'linux'
    })

    vi.mocked(spawn).mockImplementation(() => {
      const child = new MockSpawnedProcess()
      queueMicrotask(() => child.emit('close'))
      return child as never
    })

    process.kill = vi.fn(((_pid: number, signal?: NodeJS.Signals) => {
      if (signal === 'SIGKILL') {
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

    expect(spawn).toHaveBeenNthCalledWith(1, 'pkill', ['-TERM', '-P', '654'], {
      stdio: 'ignore'
    })
    expect(spawn).toHaveBeenNthCalledWith(2, 'pkill', ['-KILL', '-P', '654'], {
      stdio: 'ignore'
    })
    expect(process.kill).toHaveBeenNthCalledWith(1, 654, 'SIGTERM')
    expect(process.kill).toHaveBeenNthCalledWith(2, 654, 'SIGKILL')
  })
})
