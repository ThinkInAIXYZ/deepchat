import { EventEmitter } from 'node:events'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnBackgroundExecHost } from '@/app/backgroundExecHost'
import type { BackgroundExecRpcRequest } from '@/agent/shared/process/backgroundExecSessionManager'

const mocks = vi.hoisted(() => ({ fork: vi.fn() }))
vi.mock('electron', () => ({ utilityProcess: { fork: mocks.fork } }))

describe('Background exec native launch', () => {
  const entry = path.resolve('out/main/backgroundExecUtilityHost.js')
  beforeEach(() => {
    mocks.fork.mockReset()
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
    expect(channel.kill()).toBeUndefined()
    expect(exit).toHaveBeenCalledWith(0)
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
      expect(host.kill).toHaveBeenCalledOnce()
      for (const name of ['spawn', 'exit', 'error']) expect(host.listenerCount(name)).toBe(0)
    }
  )
})
