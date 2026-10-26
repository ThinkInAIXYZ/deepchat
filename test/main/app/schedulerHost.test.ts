import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnSchedulerHost } from '@/app/schedulerHost'
import { SchedulerProcessManager } from '@/scheduler/schedulerProcessManager'
import type { SchedulerCommand } from '@shared/cronJobs'

const mocks = vi.hoisted(() => ({ fork: vi.fn() }))
vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd() },
  utilityProcess: { fork: mocks.fork }
}))

describe('Scheduler native launch', () => {
  beforeEach(() => {
    mocks.fork.mockReset()
  })

  function nativeHost() {
    const host = Object.assign(new EventEmitter(), {
      pid: 123,
      postMessage: vi.fn<(command: SchedulerCommand) => void>(),
      kill: vi.fn<() => boolean>()
    })
    host.kill.mockImplementation(() => {
      host.emit('exit', 0)
      return true
    })
    mocks.fork.mockReturnValue(host)
    return host
  }

  function manager() {
    return new SchedulerProcessManager({
      getSnapshot: () => ({ enabledJobCount: 1, nextRunAt: 100 }),
      queueDueRuns: () => [],
      onRunDue: vi.fn(),
      spawnHost: spawnSchedulerHost
    })
  }

  it('exposes command, event and lifecycle capabilities after native spawn', async () => {
    const host = nativeHost()
    const pending = spawnSchedulerHost(new AbortController().signal)
    host.emit('spawn')
    const channel = await pending
    expect(channel).not.toBe(host)
    expect(channel.pid).toBe(123)
    expect(host.listenerCount('spawn')).toBe(0)
    expect(host.listenerCount('exit')).toBe(0)
    expect(host.listenerCount('error')).toBe(0)
    const message = vi.fn(),
      exit = vi.fn(),
      error = vi.fn()
    expect(channel.onMessage(message)).toBeUndefined()
    expect(channel.onExit(exit)).toBeUndefined()
    expect(channel.onError(error)).toBeUndefined()
    host.emit('message', { type: 'READY', pid: 123, now: 100 })
    host.emit('error', 'crash', 'scheduler')
    expect(message).toHaveBeenCalledWith({ type: 'READY', pid: 123, now: 100 })
    expect(error).toHaveBeenCalledWith('crash', 'scheduler')
    channel.postMessage({ type: 'START', now: 100 })
    expect(host.postMessage).toHaveBeenCalledWith({ type: 'START', now: 100 })
    expect(channel.kill()).toBeUndefined()
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('does not fork an already canceled launch', async () => {
    const abort = new AbortController()
    abort.abort()
    await expect(spawnSchedulerHost(abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.fork).not.toHaveBeenCalled()
  })

  it('kills a pending native child when its manager stops and ignores a late spawn', async () => {
    const host = nativeHost()
    const owner = manager()
    const pending = owner.start()
    const rejected = expect(pending).rejects.toThrow('Scheduler utility spawn canceled')
    await owner.stop()
    await rejected
    expect(host.kill).toHaveBeenCalledTimes(1)
    expect(host.postMessage).not.toHaveBeenCalled()
    expect(owner.getStatus()).toMatchObject({ state: 'stopped', pid: null, lastError: null })
    for (const event of ['spawn', 'exit', 'error']) expect(host.listenerCount(event)).toBe(0)
    host.emit('spawn')
    expect(owner.getStatus()).toMatchObject({ state: 'stopped', pid: null })
  })

  it('cancels a signal aborted while the native fork returns', async () => {
    const host = nativeHost()
    const abort = new AbortController()
    mocks.fork.mockImplementationOnce(() => {
      abort.abort()
      return host
    })
    await expect(spawnSchedulerHost(abort.signal)).rejects.toThrow(
      'Scheduler utility spawn canceled'
    )
    expect(host.kill).toHaveBeenCalledTimes(1)
    for (const event of ['spawn', 'exit', 'error']) expect(host.listenerCount(event)).toBe(0)
  })

  it.each(['exit', 'error'] as const)(
    'rejects a native %s before spawn without leaving the child alive',
    async (event) => {
      const host = nativeHost()
      const pending = spawnSchedulerHost(new AbortController().signal)
      const rejected = expect(pending).rejects.toThrow(
        event === 'exit' ? 'exited before spawn: 1' : 'process error: crash at startup'
      )
      if (event === 'exit') host.emit('exit', 1)
      else host.emit('error', 'crash', 'startup')
      await rejected
      expect(host.kill).toHaveBeenCalledTimes(1)
      for (const name of ['spawn', 'exit', 'error']) expect(host.listenerCount(name)).toBe(0)
      host.emit('spawn')
    }
  )

  it('does not send reconciliation after stop supersedes a completed native spawn', async () => {
    const host = nativeHost()
    const owner = manager()
    host.postMessage.mockImplementation((command) => {
      if (command.type === 'START') void owner.stop()
    })
    const pending = owner.start()
    const rejected = expect(pending).rejects.toThrow('spawn was superseded')
    host.emit('spawn')
    await rejected
    expect(host.postMessage.mock.calls.map(([command]) => command.type)).toEqual(['START', 'STOP'])
    expect(host.kill).toHaveBeenCalledTimes(1)
    expect(owner.getStatus()).toMatchObject({ state: 'stopped', pid: null })
  })
})
