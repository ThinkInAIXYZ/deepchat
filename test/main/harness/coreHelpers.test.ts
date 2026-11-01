import { EventEmitter } from 'node:events'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { deserialize, serialize } from 'node:v8'
import { describe, expect, it, vi } from 'vitest'
import { CoreNativeHelpers } from '../../../src/harness/core/helpers'
import { CoreHelperNative } from '@/harness/helpers'
import {
  CORE_HELPER_QUEUE,
  type CoreHelperCommand,
  type CoreHelperKind
} from '@shared/harness/helpers'
import type { BackgroundExecHost } from '@/agent/shared/process/backgroundExecSessionManager'
import type { CodeModeHost } from '@/tool/codeMode/runCodeRuntimeManager'

const crossed = <T>(value: T): T => deserialize(serialize(value))

function nativeHost(earlyReady = false) {
  const events = new EventEmitter()
  const closed = Promise.withResolvers<void>()
  let exited = false
  events.once('exit', () => {
    exited = true
    closed.resolve()
  })
  const host = {
    pid: 41001,
    postMessage: vi.fn<(message: unknown) => void>(),
    kill: vi.fn(async () => {}),
    onMessage: (listener) => {
      events.on('message', listener)
    },
    onExit: (listener) => {
      events.on('exit', listener)
    },
    onError: (listener) => {
      events.on('error', listener)
    }
  } satisfies BackgroundExecHost
  const rss = vi.fn(async (_signal: AbortSignal): Promise<number | null> => 1024)
  const code: CodeModeHost = {
    ...host,
    on: (event, listener) => {
      events.on(event, listener)
      if (earlyReady && event === 'message')
        events.emit('message', { type: 'READY', version: 1, pid: host.pid })
    },
    off: (event, listener) => {
      events.off(event, listener)
    },
    getRssBytes: rss
  }
  return { host, code, events, rss, closed, isExited: () => exited }
}

function fixture(
  intercept?: (
    command: CoreHelperCommand,
    invoke: (command: CoreHelperCommand) => Promise<unknown>
  ) => Promise<unknown>
) {
  const native = nativeHost(true)
  const failures = vi.fn()
  const retireExec = vi.fn(async (_ownerPid: number | undefined) => {})
  let core: CoreNativeHelpers
  const main = new CoreHelperNative(
    {
      exec: async () => ({
        ...native.host,
        kill: async () => {
          if (!native.isExited()) await native.host.kill()
          await native.closed.promise
          await retireExec(native.host.pid)
        }
      }),
      code: async () => native.code,
      scheduler: async () => native.host,
      watcher: async () => ({
        ...native.host,
        terminate: async () => {
          native.host.kill()
          await native.closed.promise
        }
      })
    },
    async (events) => {
      core.accept(crossed(events))
    },
    failures
  )
  const commands: CoreHelperCommand[] = []
  const invoke = async (command: CoreHelperCommand) => {
    commands.push(crossed(command))
    return crossed(await main.invoke([crossed(command)]))
  }
  core = new CoreNativeHelpers(
    (command) => (intercept ? intercept(command, invoke) : invoke(command)),
    failures
  )
  return { ...native, main, core, failures, retireExec, commands, invoke }
}

describe('Core Native helper transport', () => {
  it('retains unexpected Exec loss until attested descendant recovery completes', async () => {
    const f = fixture()
    const descendants = Promise.withResolvers<void>()
    f.retireExec.mockImplementationOnce(async () => await descendants.promise)
    const host = await f.core.spawnBackgroundExecHost(new AbortController().signal)
    const exited = vi.fn()
    host.onExit(exited)
    f.events.emit('exit', 1)
    await vi.waitFor(() => expect(f.retireExec).toHaveBeenCalledWith(41001))
    await vi.waitFor(() => expect(exited).toHaveBeenCalledWith(1))
    let retired = false
    const closing = f.core.close().then(() => {
      retired = true
    })
    await nextTurn()
    expect(retired).toBe(false)
    descendants.resolve()
    await closing
    expect(f.host.kill).not.toHaveBeenCalled()
    expect(f.failures).not.toHaveBeenCalled()
  })

  it('coalesces concurrent retirement into bounded batches', async () => {
    const physical: ReturnType<typeof nativeHost>[] = []
    const failures = vi.fn()
    const commands: CoreHelperCommand[] = []
    let core: CoreNativeHelpers
    const unexpected = async (): Promise<never> => {
      throw new Error('Unexpected helper kind')
    }
    const main = new CoreHelperNative(
      {
        exec: unexpected,
        scheduler: unexpected,
        watcher: unexpected,
        code: async () => {
          const native = nativeHost()
          native.host.kill.mockImplementation(async () => {
            queueMicrotask(() => native.events.emit('exit', 0))
          })
          physical.push(native)
          return native.code
        }
      },
      async (events) => {
        core.accept(crossed(events))
      },
      failures
    )
    core = new CoreNativeHelpers(async (command) => {
      commands.push(crossed(command))
      return crossed(await main.invoke([crossed(command)]))
    }, failures)
    const hosts = await Promise.all(
      Array.from({ length: 33 }, () => core.spawnCodeModeHost(new AbortController().signal))
    )
    const exited = vi.fn()
    for (const host of hosts) {
      host.on('exit', exited)
      host.kill()
    }
    await vi.waitFor(() => expect(exited).toHaveBeenCalledTimes(33))
    await core.close()
    const batches = commands.filter((command) => command.operation === 'terminate')
    expect(batches.length).toBeLessThanOrEqual(2)
    expect(batches.length).toBeGreaterThan(0)
    expect(batches.every((command) => command.ids.length <= 32)).toBe(true)
    expect(physical.every((native) => native.host.kill.mock.calls.length === 1)).toBe(true)
    expect(failures).not.toHaveBeenCalled()
  })

  it('preserves each fixed helper protocol, callback order and physical retirement', async () => {
    for (const kind of ['exec', 'code', 'scheduler', 'content', 'git'] as const) {
      const f = fixture()
      const signal = new AbortController().signal
      const received = vi.fn()
      let post: (value: unknown) => void
      if (kind === 'code') {
        const host = await f.core.spawnCodeModeHost(signal)
        host.on('message', received)
        host.on('exit', () => {})
        await vi.waitFor(() =>
          expect(received).toHaveBeenCalledWith({ type: 'READY', version: 1, pid: 41001 })
        )
        received.mockClear()
        post = (value) => host.postMessage(value as Parameters<CodeModeHost['postMessage']>[0])
        await expect(host.getRssBytes(signal)).resolves.toBe(1024)
      } else {
        const host =
          kind === 'exec'
            ? await f.core.spawnBackgroundExecHost(signal)
            : kind === 'scheduler'
              ? await f.core.spawnSchedulerHost(signal)
              : await f.core.spawnFileWatcherHost(kind, signal)
        host.onMessage(received)
        host.onExit(() => {})
        post = (value) => host.postMessage(value as never)
      }
      const messages: Record<CoreHelperKind, unknown> = {
        exec: { type: 'background-exec:request', id: 'request', method: 'list', args: ['session'] },
        code: {
          type: 'START',
          version: 1,
          cellId: 'cell',
          frontend: 'function',
          source: 'return 1',
          bindings: [],
          store: {}
        },
        scheduler: { type: 'START', now: 1 },
        content: { type: 'file-watcher:request', id: 'watch', method: 'unwatch', args: ['root'] },
        git: { type: 'file-watcher:request', id: 'watch', method: 'unwatch', args: ['root'] }
      }
      const message = crossed(messages[kind])
      post(message)
      Object.assign(message as object, { type: 'mutated-after-post' })
      await vi.waitFor(() => expect(f.host.postMessage).toHaveBeenCalledWith(messages[kind]))
      f.events.emit('message', { chunk: Buffer.from('first') })
      f.events.emit('message', { chunk: Buffer.from('second') })
      await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(2))
      expect(received.mock.calls.map(([value]) => value.chunk.toString())).toEqual([
        'first',
        'second'
      ])
      let retired = false
      const closing = f.core.close().then(() => {
        retired = true
      })
      await vi.waitFor(() => expect(f.host.kill).toHaveBeenCalledOnce())
      expect(retired).toBe(false)
      f.events.emit('exit', 0)
      await closing
      await expect(f.core.spawnBackgroundExecHost(signal)).rejects.toThrow('stopping')
      expect(f.failures).not.toHaveBeenCalled()
    }
  })

  it('compensates canceled startup after an uncancelable launcher returns its actual host', async () => {
    const f = fixture()
    const opened = Promise.withResolvers<BackgroundExecHost>()
    const descendants = Promise.withResolvers<void>()
    const retireExec = vi.fn(async (_ownerPid: number | undefined) => await descendants.promise)
    let core: CoreNativeHelpers
    const main = new CoreHelperNative(
      {
        exec: async () => await opened.promise,
        code: async () => f.code,
        scheduler: async () => f.host,
        watcher: async () => {
          throw new Error('Unexpected watcher')
        }
      },
      async (events) => {
        core.accept(crossed(events))
      },
      f.failures
    )
    core = new CoreNativeHelpers(
      async (command) => await main.invoke([crossed(command)]),
      f.failures
    )
    const owner = new AbortController()
    const spawning = Promise.allSettled([core.spawnBackgroundExecHost(owner.signal)])
    await Promise.resolve()
    owner.abort()
    opened.resolve({
      ...f.host,
      kill: async () => {
        if (!f.isExited()) await f.host.kill()
        await f.closed.promise
        await retireExec(f.host.pid)
      }
    })
    await vi.waitFor(() => expect(f.host.kill).toHaveBeenCalledOnce())
    let retired = false
    const closing = core.close().then(() => {
      retired = true
    })
    await Promise.resolve()
    expect(retired).toBe(false)
    f.events.emit('exit', 0)
    await vi.waitFor(() => expect(retireExec).toHaveBeenCalledWith(41001))
    expect(retired).toBe(false)
    descendants.resolve()
    expect((await spawning)[0].status).toBe('rejected')
    await closing
    expect(f.failures).not.toHaveBeenCalled()
  })

  it('drains an owned RSS observation before retiring the helper', async () => {
    const f = fixture()
    const receipt = Promise.withResolvers<number>()
    const entered = Promise.withResolvers<void>()
    f.rss.mockImplementationOnce(async () => {
      entered.resolve()
      return await receipt.promise
    })
    const host = await f.core.spawnCodeModeHost(new AbortController().signal)
    const exited = vi.fn()
    host.on('exit', exited)
    const reading = Promise.allSettled([host.getRssBytes(new AbortController().signal)])
    await entered.promise
    const closing = f.core.close()
    await Promise.resolve()
    expect(f.host.kill).not.toHaveBeenCalled()
    receipt.resolve(2048)
    await vi.waitFor(() => expect(f.host.kill).toHaveBeenCalledOnce())
    f.events.emit('exit', 0)
    await closing
    expect(exited).toHaveBeenCalledOnce()
    expect((await reading)[0].status).toBe('rejected')
    expect(f.failures).not.toHaveBeenCalled()
  })

  it('fences overflow without replaying queued commands or accepting arbitrary helper methods', async () => {
    const posted = Promise.withResolvers<void>()
    const f = fixture(async (command, invoke) => {
      if (command.operation === 'send') await posted.promise
      return await invoke(command)
    })
    const host = await f.core.spawnBackgroundExecHost(new AbortController().signal)
    const command = {
      type: 'background-exec:request' as const,
      id: 'request',
      method: 'list' as const,
      args: ['session']
    }
    const id = f.commands[0].operation === 'open' ? f.commands[0].id : ''
    await expect(
      f.main.invoke([{ operation: 'send', id, message: { ...command, method: 'constructor' } }])
    ).rejects.toThrow()
    await expect(f.main.invoke([{ operation: 'rss', id, pid: 999 }])).rejects.toThrow()
    for (let i = 0; i < CORE_HELPER_QUEUE; i++) host.postMessage(command)
    expect(() => host.postMessage(command)).toThrow('queue exceeded')
    posted.resolve()
    expect(() => host.postMessage(command)).toThrow('queue exceeded')
    expect(f.failures).toHaveBeenCalledOnce()
    expect(f.host.postMessage).not.toHaveBeenCalled()
    const closing = Promise.allSettled([f.main.close()])
    await vi.waitFor(() => expect(f.host.kill).toHaveBeenCalledOnce())
    f.events.emit('exit', 0)
    await closing
  })
})
