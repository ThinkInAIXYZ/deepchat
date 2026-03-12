import type { ChildProcess } from 'child_process'
import fs from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => (name === 'userData' ? '/mock/userData' : '/mock/home'))
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

import { BackgroundExecSessionManager } from '@/presenter/agentRuntime/acp/backgroundExecSessionManager'

describe('BackgroundExecSessionManager', () => {
  let manager: BackgroundExecSessionManager

  beforeEach(() => {
    manager = new BackgroundExecSessionManager()
    clearInterval((manager as never).cleanupIntervalId)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    ;(manager as never).sessions.clear()
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
})
