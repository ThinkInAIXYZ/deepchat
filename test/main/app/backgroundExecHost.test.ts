import { EventEmitter } from 'node:events'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnBackgroundExecHost } from '@/app/backgroundExecHost'
import type { BackgroundExecRpcRequest } from '@/agent/shared/process/backgroundExecSessionManager'

const mocks = vi.hoisted(() => ({
  fork: vi.fn(),
  reap: vi.fn(),
  list: vi.fn(),
  observe: vi.fn(),
  terminate: vi.fn()
}))
vi.mock('electron', () => ({ utilityProcess: { fork: mocks.fork } }))
vi.mock('@/agent/shared/process/childProcessRegistry', () => ({
  childProcessRegistry: { reapStale: mocks.reap, list: mocks.list },
  observeProcessIdentity: mocks.observe
}))
vi.mock('@/agent/shared/process/processTree', () => ({
  terminateProcessTreeByPid: mocks.terminate
}))

describe('Background exec native launch', () => {
  const entry = path.resolve('out/main/backgroundExecUtilityHost.js')
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  beforeEach(() => {
    mocks.fork.mockReset()
    mocks.reap.mockReset().mockResolvedValue({ refused: [], skipped: [], reaped: [], cleared: [] })
    mocks.list.mockReset().mockReturnValue([])
    mocks.observe.mockReset().mockResolvedValue({
      alive: true,
      nativeIdentity: 'darwin:11111111-1111-4111-8111-111111111111:12345'
    })
    mocks.terminate.mockReset().mockResolvedValue(true)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
  })

  function nativeHost() {
    const host = Object.assign(new EventEmitter(), {
      pid: 123,
      postMessage: vi.fn(),
      kill: vi.fn()
    })
    host.kill.mockImplementation(() => {
      host.emit('exit', 0)
      return true
    })
    mocks.fork.mockReturnValue(host)
    return host
  }

  it('launches the approved entry and exposes a plain command/event/lifecycle channel', async () => {
    const host = nativeHost()
    const pending = spawnBackgroundExecHost(entry, new AbortController().signal)
    host.emit('spawn')
    const channel = await pending
    expect(channel).not.toBe(host)
    expect(channel.pid).toBe(123)
    expect(mocks.fork).toHaveBeenCalledWith(
      entry,
      ['--deepchat-exec-utility-host'],
      expect.objectContaining({
        serviceName: 'DeepChat Exec Utility',
        env: expect.objectContaining({ DEEPCHAT_EXEC_UTILITY_HOST: '1' })
      })
    )
    const message = vi.fn(),
      exit = vi.fn(),
      error = vi.fn()
    channel.onMessage(message)
    channel.onExit(exit)
    channel.onError(error)
    const request: BackgroundExecRpcRequest = {
      type: 'background-exec:request',
      id: '1',
      method: 'list',
      args: ['conversation']
    }
    channel.postMessage(request)
    host.emit('message', { type: 'background-exec:response', id: '1', ok: true, data: [] })
    host.emit('error', 'crash', 'helper')
    expect(host.postMessage).toHaveBeenCalledWith(request)
    expect(message).toHaveBeenCalledWith({
      type: 'background-exec:response',
      id: '1',
      ok: true,
      data: []
    })
    expect(error).toHaveBeenCalledWith('crash', 'helper')
    await expect(channel.kill()).resolves.toBeUndefined()
    expect(exit).toHaveBeenCalledWith(0)
    expect(mocks.reap).toHaveBeenCalledWith('background-exec', { ownerPid: 123 })
    const lateExit = vi.fn()
    channel.onExit(lateExit)
    await Promise.resolve()
    expect(lateExit).toHaveBeenCalledExactlyOnceWith(0)
  })

  it('rejects relative paths and already canceled launches before forking', async () => {
    const canceled = AbortSignal.abort()
    await expect(spawnBackgroundExecHost(entry, canceled)).rejects.toMatchObject({
      name: 'AbortError'
    })
    await expect(
      spawnBackgroundExecHost('relative.js', new AbortController().signal)
    ).rejects.toThrow('must be absolute')
    expect(mocks.fork).not.toHaveBeenCalled()
  })

  it('waits for physical exit and refuses incomplete owned-command cleanup', async () => {
    const host = nativeHost()
    host.kill.mockImplementation(() => true)
    const recovery = Promise.withResolvers<{ refused: string[]; skipped: string[] }>()
    mocks.reap.mockReturnValueOnce(recovery.promise)
    const pending = spawnBackgroundExecHost(entry, new AbortController().signal)
    host.emit('spawn')
    const channel = await pending
    const retirement = channel.kill()
    const rejected = expect(retirement).rejects.toThrow('Owned background execution did not retire')
    expect(channel.kill()).toBe(retirement)
    await vi.waitFor(() => expect(host.kill).toHaveBeenCalledOnce())
    expect(mocks.reap).not.toHaveBeenCalled()
    host.emit('exit', 0)
    await vi.waitFor(() =>
      expect(mocks.reap).toHaveBeenCalledWith('background-exec', { ownerPid: 123 })
    )
    recovery.resolve({ refused: ['job'], skipped: [] })
    await rejected
    expect(channel.pid).toBe(123)
    expect(host.kill).toHaveBeenCalledOnce()
  })

  it('attests native readiness and refuses an incomplete descendant retirement receipt', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    vi.stubEnv('DEEPCHAT_HARNESS_EXECUTABLE', '/owned/deepchat-harness')
    const host = nativeHost()
    const observation = Promise.withResolvers<{ alive: boolean; nativeIdentity: string }>()
    const descendants = Promise.withResolvers<boolean>()
    mocks.observe.mockReturnValueOnce(observation.promise)
    mocks.terminate.mockReturnValueOnce(descendants.promise)
    const pending = spawnBackgroundExecHost(entry, new AbortController().signal)
    const ready = vi.fn()
    void pending.then(ready)
    host.emit('spawn')
    expect(mocks.observe).toHaveBeenCalledExactlyOnceWith(123)
    await Promise.resolve()
    expect(ready).not.toHaveBeenCalled()
    const nativeIdentity = 'darwin:11111111-1111-4111-8111-111111111111:12345'
    observation.resolve({ alive: true, nativeIdentity })
    const channel = await pending
    const retirement = channel.kill()
    const refused = expect(retirement).rejects.toThrow('helper descendants did not retire')
    await vi.waitFor(() =>
      expect(mocks.terminate).toHaveBeenCalledExactlyOnceWith(123, {
        nativeIdentity,
        ownedGroup: false,
        graceMs: 2000
      })
    )
    expect(mocks.reap).not.toHaveBeenCalled()
    descendants.resolve(false)
    await refused
    expect(channel.kill()).toBe(retirement)
    expect(mocks.reap).not.toHaveBeenCalled()
  })

  it('does not expose a native channel after failed or canceled identity observation', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    vi.stubEnv('DEEPCHAT_HARNESS_EXECUTABLE', '/owned/deepchat-harness')
    for (const canceled of [false, true]) {
      const host = nativeHost()
      const observation = Promise.withResolvers<{ alive: boolean }>()
      mocks.observe.mockReturnValueOnce(observation.promise)
      const owner = new AbortController()
      const pending = spawnBackgroundExecHost(entry, owner.signal)
      const rejected = expect(pending).rejects.toThrow()
      host.emit('spawn')
      if (canceled) owner.abort()
      observation.resolve({ alive: true })
      await rejected
      expect(host.kill).toHaveBeenCalledOnce()
      expect(host.postMessage).not.toHaveBeenCalled()
      expect(mocks.terminate).not.toHaveBeenCalled()
    }
  })

  it.each(['pending', 'during-fork'])(
    'kills a %s canceled launch and detaches startup listeners',
    async (phase) => {
      const host = nativeHost()
      const owner = new AbortController()
      if (phase === 'during-fork')
        mocks.fork.mockImplementationOnce(() => {
          owner.abort()
          return host
        })
      const rejected = expect(spawnBackgroundExecHost(entry, owner.signal)).rejects.toMatchObject({
        name: 'AbortError'
      })
      owner.abort()
      await rejected
      expect(host.kill).toHaveBeenCalledOnce()
      for (const event of ['spawn', 'exit', 'error']) expect(host.listenerCount(event)).toBe(0)
      host.emit('spawn')
      expect(host.postMessage).not.toHaveBeenCalled()
    }
  )

  it.each(['exit', 'error'])(
    'rejects a native %s before readiness and releases startup listeners',
    async (event) => {
      const host = nativeHost()
      const rejected = expect(
        spawnBackgroundExecHost(entry, new AbortController().signal)
      ).rejects.toThrow(
        event === 'exit' ? 'exited before spawn: 1' : 'helper error: crash at startup'
      )
      if (event === 'exit') host.emit('exit', 1)
      else host.emit('error', 'crash', 'startup')
      await rejected
      expect(host.kill).toHaveBeenCalledTimes(event === 'exit' ? 0 : 1)
      for (const name of ['spawn', 'exit', 'error']) expect(host.listenerCount(name)).toBe(0)
    }
  )
})
