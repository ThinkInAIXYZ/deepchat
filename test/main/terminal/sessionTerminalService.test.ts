import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakePty {
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  emitData(data: string): void
  emitExit(exitCode: number, signal?: number): void
}

const ptyMock = vi.hoisted(() => ({
  spawn: vi.fn(),
  instances: [] as FakePty[]
}))

vi.mock('node-pty', () => ({ spawn: ptyMock.spawn }))

import {
  SessionTerminalService,
  TERMINAL_MAX_LIVE,
  TERMINAL_REPLAY_LIMIT,
  sanitizeEnvironment
} from '@/terminal/sessionTerminalService'

function createFakePty(): FakePty {
  let dataListener: ((data: string) => void) | null = null
  let exitListener: ((event: { exitCode: number; signal?: number }) => void) | null = null
  const pty = {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn((listener: (data: string) => void) => {
      dataListener = listener
      return { dispose: () => (dataListener = null) }
    }),
    onExit: vi.fn((listener: (event: { exitCode: number; signal?: number }) => void) => {
      exitListener = listener
      return { dispose: () => (exitListener = null) }
    }),
    emitData: (data: string) => dataListener?.(data),
    emitExit: (exitCode: number, signal?: number) => exitListener?.({ exitCode, signal })
  }
  return pty
}

describe('SessionTerminalService', () => {
  let workdir: string
  let workdirs: Map<string, string | null>
  let rendererDestroyed: Map<number, () => void>
  let sendOutput: ReturnType<typeof vi.fn>
  let sendExit: ReturnType<typeof vi.fn>
  let service: SessionTerminalService

  const size = { cols: 80, rows: 24 }

  beforeEach(() => {
    vi.useFakeTimers()
    workdir = '/workspace/project'
    vi.mocked(fs.statSync).mockImplementation(((target: string) => {
      if (target !== workdir) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return { isDirectory: () => true }
    }) as unknown as typeof fs.statSync)
    workdirs = new Map([['session-1', workdir]])
    rendererDestroyed = new Map()
    sendOutput = vi.fn()
    sendExit = vi.fn()
    ptyMock.instances = []
    ptyMock.spawn.mockReset().mockImplementation(() => {
      const pty = createFakePty()
      ptyMock.instances.push(pty)
      return pty
    })
    service = new SessionTerminalService({
      resolveWorkdir: (sessionId) => workdirs.get(sessionId) ?? null,
      resolveShell: () => ({ shell: '/bin/zsh', args: ['-l'] }),
      resolveEnvironment: async () => ({ PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1' }),
      sendOutput,
      sendExit,
      onRendererDestroyed: (webContentsId, callback) => {
        rendererDestroyed.set(webContentsId, callback)
        return () => rendererDestroyed.delete(webContentsId)
      },
      platform: 'darwin'
    })
  })

  afterEach(() => {
    service.shutdown()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('spawns in the trusted session workdir with a sanitized environment', async () => {
    const snapshot = await service.attach('session-1', 7, size)

    expect(snapshot).toMatchObject({ cwd: workdir, shell: '/bin/zsh', status: 'running' })
    const [, args, options] = ptyMock.spawn.mock.calls[0]
    expect(args).toEqual(['-l'])
    expect(options.cwd).toBe(workdir)
    expect(options.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(options.env.TERM).toBe('xterm-256color')
  })

  it('rejects sessions without an existing workdir', async () => {
    workdirs.set('session-2', null)
    workdirs.set('session-3', `${workdir}/missing`)

    await expect(service.attach('session-2', 7, size)).rejects.toThrow('[terminal:no_workdir]')
    await expect(service.attach('session-3', 7, size)).rejects.toThrow('[terminal:workdir_missing]')
    expect(ptyMock.spawn).not.toHaveBeenCalled()
  })

  it('keeps one terminal per session and rejects other renderers', async () => {
    const first = await service.attach('session-1', 7, size)
    const second = await service.attach('session-1', 7, { cols: 100, rows: 30 })

    expect(second.terminalId).toBe(first.terminalId)
    expect(ptyMock.spawn).toHaveBeenCalledTimes(1)
    expect(ptyMock.instances[0].resize).toHaveBeenCalledWith(100, 30)
    await expect(service.attach('session-1', 8, size)).rejects.toThrow('[terminal:forbidden]')
    expect(() => service.write(first.terminalId, 8, 'ls\r')).toThrow('[terminal:forbidden]')
    expect(() => service.kill(first.terminalId, 8)).toThrow('[terminal:forbidden]')

    service.write(first.terminalId, 7, 'ls\r')
    expect(ptyMock.instances[0].write).toHaveBeenCalledWith('ls\r')
  })

  it('coalesces output with stream offsets and bounds the replay buffer', async () => {
    const { terminalId } = await service.attach('session-1', 7, size)
    const pty = ptyMock.instances[0]

    pty.emitData('a'.repeat(10))
    pty.emitData('b'.repeat(5))
    vi.advanceTimersByTime(10)
    expect(sendOutput).toHaveBeenCalledWith(7, terminalId, 0, 'a'.repeat(10) + 'b'.repeat(5))

    pty.emitData('c'.repeat(TERMINAL_REPLAY_LIMIT))
    vi.advanceTimersByTime(10)
    const replay = await service.attach('session-1', 7, size)
    expect(replay.replay).toHaveLength(TERMINAL_REPLAY_LIMIT)
    expect(replay.replay.endsWith('c')).toBe(true)
    expect(replay.outputEnd).toBe(15 + TERMINAL_REPLAY_LIMIT)
  })

  it('reports exit and allows restart', async () => {
    const { terminalId } = await service.attach('session-1', 7, size)
    ptyMock.instances[0].emitExit(3)

    expect(sendExit).toHaveBeenCalledWith(7, terminalId, 3, undefined)
    expect(await service.attach('session-1', 7, size)).toMatchObject({
      terminalId,
      status: 'exited',
      exitCode: 3
    })

    const restarted = await service.restart('session-1', 7, size)
    expect(restarted.terminalId).not.toBe(terminalId)
    expect(restarted.status).toBe('running')
  })

  it('terminates on session deletion, renderer destruction, and shutdown', async () => {
    workdirs.set('session-2', workdir)
    workdirs.set('session-3', workdir)
    await service.attach('session-1', 7, size)
    await service.attach('session-2', 8, size)
    await service.attach('session-3', 9, size)
    const [first, second, third] = ptyMock.instances

    service.disposeSession('session-1')
    expect(first.kill).toHaveBeenCalledWith()
    vi.advanceTimersByTime(2_000)
    expect(first.kill).toHaveBeenCalledWith('SIGKILL')

    rendererDestroyed.get(8)?.()
    expect(second.kill).toHaveBeenCalled()

    service.shutdown()
    expect(third.kill).toHaveBeenCalled()
    expect(sendExit).not.toHaveBeenCalled()
  })

  it('limits live terminals', async () => {
    for (let index = 0; index < TERMINAL_MAX_LIVE; index += 1) {
      workdirs.set(`live-${index}`, workdir)
      await service.attach(`live-${index}`, 7, size)
    }
    workdirs.set('overflow', workdir)

    await expect(service.attach('overflow', 7, size)).rejects.toThrow('[terminal:capacity]')
  })
})

describe('sanitizeEnvironment', () => {
  it('drops Electron internals and sets terminal capabilities', () => {
    expect(
      sanitizeEnvironment({ HOME: '/home/u', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--x' })
    ).toEqual({
      HOME: '/home/u',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'DeepChat'
    })
  })
})
