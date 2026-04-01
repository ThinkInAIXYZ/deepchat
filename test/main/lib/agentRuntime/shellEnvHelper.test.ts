import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('child_process', () => ({
  spawn: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'home') {
        return process.platform === 'win32' ? 'C:\\Users\\tester' : '/Users/tester'
      }
      return '/tmp'
    })
  }
}))

import { spawn } from 'child_process'
import { clearShellEnvironmentCache, getShellEnvironment } from '@/lib/agentRuntime/shellEnvHelper'

class MockStream extends EventEmitter {}

class MockChild extends EventEmitter {
  stdout = new MockStream()
  stderr = new MockStream()
  kill = vi.fn(() => true)
}

function getMarkers(command: string) {
  const matches = [...command.matchAll(/printf '%s\\n' '([^']+)'/g)].map((match) => match[1])
  return {
    start: matches[0] ?? '',
    end: matches[1] ?? ''
  }
}

describe('shellEnvHelper', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const originalEnv = { ...process.env }

  beforeEach(() => {
    clearShellEnvironmentCache()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearShellEnvironmentCache()
    process.env = { ...originalEnv }
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  it('uses a login interactive zsh shell and preserves /usr/local/bin on macOS', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin'
    })
    process.env.SHELL = '/bin/zsh'
    process.env.PATH = '/usr/bin:/bin'

    vi.mocked(spawn).mockImplementation((shell, args) => {
      const child = new MockChild()
      const command = String(args?.[3] ?? '')
      const { start, end } = getMarkers(command)

      queueMicrotask(() => {
        child.stdout.emit(
          'data',
          [
            'theme loaded',
            start,
            'PATH=/Users/tester/.local/bin:/usr/local/bin',
            'NVM_DIR=/Users/tester/.nvm',
            end
          ].join('\n')
        )
        child.emit('exit', 0, null)
      })

      return child as never
    })

    const env = await getShellEnvironment()

    expect(spawn).toHaveBeenCalledWith(
      '/bin/zsh',
      expect.arrayContaining(['-l', '-i', '-c', expect.any(String)]),
      expect.any(Object)
    )
    expect(env.NVM_DIR).toBe('/Users/tester/.nvm')
    expect(env.PATH.split(':')).toEqual(
      expect.arrayContaining(['/Users/tester/.local/bin', '/usr/local/bin', '/usr/bin', '/bin'])
    )
  })

  it('falls back to process env on failure and retries instead of caching the failure', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin'
    })
    process.env.SHELL = '/bin/zsh'
    process.env.PATH = '/usr/bin:/bin'

    vi.mocked(spawn)
      .mockImplementationOnce(() => {
        const child = new MockChild()
        queueMicrotask(() => {
          child.emit('error', new Error('boom'))
        })
        return child as never
      })
      .mockImplementationOnce((_shell, args) => {
        const child = new MockChild()
        const command = String(args?.[3] ?? '')
        const { start, end } = getMarkers(command)

        queueMicrotask(() => {
          child.stdout.emit(
            'data',
            [start, 'PATH=/custom/bin:/usr/local/bin', 'VOLTA_HOME=/Users/tester/.volta', end].join(
              '\n'
            )
          )
          child.emit('exit', 0, null)
        })

        return child as never
      })

    const fallbackEnv = await getShellEnvironment()
    expect(fallbackEnv.PATH.split(':')).toEqual(expect.arrayContaining(['/usr/bin', '/bin']))

    const recoveredEnv = await getShellEnvironment()
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(recoveredEnv.VOLTA_HOME).toBe('/Users/tester/.volta')
    expect(recoveredEnv.PATH.split(':')).toEqual(
      expect.arrayContaining(['/custom/bin', '/usr/local/bin', '/usr/bin', '/bin'])
    )
  })

  it('normalizes Path and PATH on Windows without invoking a shell bootstrap process', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })
    delete process.env.SHELL
    process.env.Path = 'C:\\Tools;C:\\Windows\\System32'
    process.env.PATH = 'C:\\Tools;C:\\Other'

    const env = await getShellEnvironment()

    expect(spawn).not.toHaveBeenCalled()
    expect(env.Path).toBe(env.PATH)
    expect(env.Path?.split(';')).toEqual(
      expect.arrayContaining([
        'C:\\Tools',
        'C:\\Windows\\System32',
        'C:\\Other',
        'C:\\Users\\tester\\.cargo\\bin'
      ])
    )
  })
})
