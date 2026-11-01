import { EventEmitter, once } from 'events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.mock('child_process', () => ({
  spawn: vi.fn()
}))

import { spawn } from 'child_process'
import { terminateProcessTree, terminateProcessTreeByPid } from '@/agent/shared/process/processTree'

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
    vi.unstubAllEnvs()
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
      stdio: 'ignore',
      windowsHide: true
    })
  })

  it('kills Unix process groups before escalating to SIGKILL', async () => {
    vi.useFakeTimers()
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'linux'
    })

    let groupAlive = true
    process.kill = vi.fn(((_pid: number, signal?: NodeJS.Signals | number) => {
      if (_pid === 654 && signal === 0 && target.signalCode !== null)
        throw Object.assign(new Error('root exited'), { code: 'ESRCH' })
      if (signal === 'SIGTERM') {
        queueMicrotask(() => {
          target.signalCode = 'SIGTERM'
          target.emit('close', null, 'SIGTERM')
        })
      }
      if (_pid === -654 && signal === 'SIGKILL') {
        groupAlive = false
      }
      if (!groupAlive) throw Object.assign(new Error('group exited'), { code: 'ESRCH' })
      return true
    }) as typeof process.kill)

    const target = new MockChildProcess(654)
    const termination = terminateProcessTree(target as never, { graceMs: 10 })

    await vi.advanceTimersByTimeAsync(0)
    await expect(terminateProcessTree(target as never, { graceMs: 10 })).resolves.toBe(false)
    await expect(terminateProcessTreeByPid(654, { graceMs: 10 })).resolves.toBe(false)
    await vi.advanceTimersByTimeAsync(10)
    await expect(termination).resolves.toBe(true)

    expect(spawn).not.toHaveBeenCalled()
    expect(vi.mocked(process.kill).mock.calls.filter(([, signal]) => signal !== 0)).toEqual([
      [-654, 'SIGTERM'],
      [-654, 'SIGKILL']
    ])
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

  it('terminates an attested orphan process tree by pid', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'linux'
    })
    let alive = true
    process.kill = vi.fn(((pid: number, signal?: NodeJS.Signals | number) => {
      if ((pid === 888 || pid === -888) && signal === 0) {
        if (!alive) {
          const error = new Error('missing') as NodeJS.ErrnoException
          error.code = 'ESRCH'
          throw error
        }
        return true
      }
      if (pid === -888 && signal === 'SIGTERM') {
        alive = false
        return true
      }
      throw new Error(`Unexpected signal ${pid}:${String(signal)}`)
    }) as typeof process.kill)

    await expect(terminateProcessTreeByPid(888, { graceMs: 10 })).resolves.toBe(true)
    expect(process.kill).toHaveBeenNthCalledWith(1, 888, 0)
    expect(process.kill).toHaveBeenNthCalledWith(2, -888, 'SIGTERM')
    expect(process.kill).toHaveBeenNthCalledWith(3, -888, 0)
  })

  it('requires the native recovery receipt without falling back to PID signals', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    vi.stubEnv('DEEPCHAT_HARNESS_EXECUTABLE', '/owned/deepchat-harness')
    process.kill = vi.fn()
    const nativeIdentity = 'darwin:00000000-0000-0000-0000-000000000000:42'
    for (const [output, retired] of [
      ['{"retired":true}', true],
      ['{"retired":false}', false],
      ['invalid receipt', false]
    ] as const) {
      vi.mocked(spawn).mockImplementationOnce(() => new MockSpawnedProcess(output) as never)
      await expect(terminateProcessTreeByPid(888, { nativeIdentity, graceMs: 10 })).resolves.toBe(
        retired
      )
    }
    expect(spawn).toHaveBeenLastCalledWith(
      '/owned/deepchat-harness',
      ['--terminate-tree', '888', nativeIdentity, '10'],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
    vi.mocked(spawn).mockImplementationOnce(
      () => new MockSpawnedProcess('{"retired":true}') as never
    )
    await expect(
      terminateProcessTreeByPid(888, { nativeIdentity, ownedGroup: false, graceMs: 10 })
    ).resolves.toBe(true)
    expect(spawn).toHaveBeenLastCalledWith(
      '/owned/deepchat-harness',
      ['--terminate-owner', '888', nativeIdentity, '10'],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
    await expect(terminateProcessTreeByPid(888, { ownedGroup: false })).resolves.toBe(false)
    const child = new MockChildProcess(888)
    vi.mocked(spawn).mockImplementationOnce(
      () => new MockSpawnedProcess('{"retired":true}') as never
    )
    const termination = terminateProcessTree(child as never, { nativeIdentity })
    const returned = vi.fn()
    void termination.then(returned)
    await vi.waitFor(() => expect(child.listenerCount('close')).toBe(1))
    expect(returned).not.toHaveBeenCalled()
    child.exitCode = 0
    child.emit('close', 0, null)
    await expect(termination).resolves.toBe(true)
    vi.stubEnv('DEEPCHAT_HARNESS_EXECUTABLE', '')
    await expect(terminateProcessTreeByPid(888, { nativeIdentity })).resolves.toBe(false)
    expect(spawn).toHaveBeenCalledTimes(5)
    expect(process.kill).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')(
    'retires a TERM-resistant group member after the root closes, through both APIs',
    async () => {
      const actual = await vi.importActual<typeof import('child_process')>('child_process')
      for (const byPid of [false, true]) {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-exec-group-'))
        const release = path.join(directory, 'release')
        const descendant = `process.on('SIGTERM', () => {}); const timer = setInterval(() => { if (require('node:fs').existsSync(${JSON.stringify(release)})) { clearInterval(timer); process.exit(0) } }, 20); process.stdout.write('ready')`
        const script = `const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'pipe', 'ignore'] }); child.stdout.once('data', () => process.stdout.write(String(child.pid) + '\\n')); setInterval(() => { if (require('node:fs').existsSync(${JSON.stringify(release)}) && (child.exitCode !== null || child.signalCode !== null)) process.exit(0) }, 20)`
        const root = actual.spawn(process.execPath, ['-e', script], {
          detached: true,
          stdio: ['ignore', 'pipe', 'ignore']
        })
        const lines = createInterface({ input: root.stdout! })
        let descendantPid: number | undefined
        const alive = () => {
          try {
            process.kill(descendantPid!, 0)
            return true
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
            throw error
          }
        }
        try {
          descendantPid = Number((await once(lines, 'line'))[0])
          expect(descendantPid).toBeGreaterThan(0)
          const result = byPid
            ? await terminateProcessTreeByPid(root.pid!, { graceMs: 30 })
            : await terminateProcessTree(root, { graceMs: 30 })
          expect(result).toBe(true)
          expect(root.exitCode !== null || root.signalCode !== null).toBe(true)
          expect(alive()).toBe(false)
        } finally {
          fs.writeFileSync(release, 'release')
          if (descendantPid) await vi.waitFor(() => expect(alive()).toBe(false))
          await vi.waitFor(() =>
            expect(root.exitCode !== null || root.signalCode !== null).toBe(true)
          )
          lines.close()
          fs.rmSync(directory, { recursive: true })
        }
      }
    }
  )

  it('rejects invalid orphan process ids', async () => {
    await expect(terminateProcessTreeByPid(0)).rejects.toThrow('invalid process id')
    expect(spawn).not.toHaveBeenCalled()
  })
})
