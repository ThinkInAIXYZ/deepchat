import { EventEmitter } from 'events'
import { spawn } from 'child_process'
import fs from 'fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('child_process', () => ({
  spawn: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => (name === 'home' ? '/mock/home' : '/mock/userData'))
  }
}))

vi.mock('@shared/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('../../../../../src/main/lib/agentRuntime/shellEnvHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../../src/main/lib/agentRuntime/shellEnvHelper')>()

  return {
    ...actual,
    getUserShell: vi
      .fn()
      .mockReturnValue({ shell: 'powershell.exe', args: ['-NoProfile', '-Command'] })
  }
})

import { AgentBashHandler } from '../../../../../src/main/presenter/toolPresenter/agentTools/agentBashHandler'

class MockStream extends EventEmitter {}

class MockChild extends EventEmitter {
  stdout = new MockStream()
  stderr = new MockStream()
  stdin = {
    write: vi.fn(),
    end: vi.fn()
  }
  kill = vi.fn()
}

describe('AgentBashHandler output encoding', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  it('wraps Windows shell commands and decodes split UTF-8 output', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })
    const child = new MockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'statSync').mockReturnValue({
      isDirectory: () => true
    } as fs.Stats)

    const handler = new AgentBashHandler(['/workspace'])
    const resultPromise = (
      handler as unknown as {
        runDetachedShellProcess: (
          command: string,
          cwd: string,
          timeout: number,
          options: Record<string, unknown>
        ) => Promise<{ output: string; exitCode: number | null }>
      }
    ).runDetachedShellProcess('dir', '/workspace', 1000, {})

    const bytes = Buffer.from('中文.txt\n', 'utf8')
    child.stdout.emit('data', bytes.subarray(0, 2))
    child.stdout.emit('data', bytes.subarray(2))
    child.emit('close', 0, null)

    const result = await resultPromise
    expect(spawn).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-Command', expect.stringContaining('[Console]::OutputEncoding')],
      expect.objectContaining({
        cwd: expect.stringMatching(/[\\/]workspace$/),
        detached: false
      })
    )
    expect(result.output).toBe('中文.txt\n')
    expect(result.exitCode).toBe(0)
  })
})
