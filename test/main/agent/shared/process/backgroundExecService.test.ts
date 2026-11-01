import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  BackgroundExecService,
  type BackgroundExecRpcRequest
} from '@/agent/shared/process/backgroundExecSessionManager'
import { ResolvedCommandShellSchema } from '@shared/commandShell'

const cleanup = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/skill/skillExecutionPackageTree', () => ({
  cleanupOwnedSkillExecutionPackageTree: cleanup
}))

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function helper() {
  const host = Object.assign(new EventEmitter(), {
    pid: 123,
    kill: vi.fn(async () => {}),
    postMessage: vi.fn<(request: BackgroundExecRpcRequest) => void>(),
    onMessage(listener: (message: unknown) => void) {
      host.on('message', listener)
    },
    onExit(listener: (code: number) => void) {
      host.on('exit', listener)
    },
    onError(listener: (type: string, location: string) => void) {
      host.on('error', listener)
    }
  })
  host.postMessage.mockImplementation((request) =>
    queueMicrotask(() =>
      host.emit('message', {
        type: 'background-exec:response',
        id: request.id,
        ok: true,
        data: request.method === 'start' ? { sessionId: request.id, status: 'running' } : undefined
      })
    )
  )
  return host
}

const options = {
  commandShell: ResolvedCommandShellSchema.parse({
    profile: 'posix',
    dialect: 'posix',
    pathStyle: 'native',
    executable: '/bin/sh',
    args: ['-c'],
    displayName: 'sh'
  })
}
const ownedTree = {
  schemaVersion: 1 as const,
  rootPath: '/managed/package',
  ownershipToken: 'owned',
  packageHash: 'hash',
  files: []
}

describe('Background execution ownership', () => {
  it('captures command overrides and environment deletion across a reused helper', async () => {
    const host = helper()
    const owner = new BackgroundExecService(async () => host)
    vi.stubEnv('DEEPCHAT_COMMAND_ENV', 'core-value')
    try {
      await owner.start('a', 'first', '/workspace', {
        ...options,
        env: { DEEPCHAT_COMMAND_OVERRIDE: 'command-value' }
      })
      delete process.env.DEEPCHAT_COMMAND_ENV
      await owner.start('b', 'second', '/workspace', options)
      const starts = host.postMessage.mock.calls
        .map(([request]) => request)
        .filter((request) => request.method === 'start')
      expect((starts[0].args[3] as { env: Record<string, string> }).env).toMatchObject({
        DEEPCHAT_COMMAND_ENV: 'core-value',
        DEEPCHAT_COMMAND_OVERRIDE: 'command-value'
      })
      expect((starts[1].args[3] as { env: Record<string, string> }).env).not.toHaveProperty(
        'DEEPCHAT_COMMAND_ENV'
      )
    } finally {
      vi.unstubAllEnvs()
      await owner.shutdown()
    }
  })

  it('shares pending helper startup and rejects terminal restart', async () => {
    const ready = deferred<ReturnType<typeof helper>>()
    const spawn = vi.fn(() => ready.promise)
    const owner = new BackgroundExecService(spawn)
    const first = owner.start('a', 'first', '/workspace', options)
    const second = owner.start('b', 'second', '/workspace', options)
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce())
    const host = helper()
    ready.resolve(host)
    const sessions = await Promise.all([first, second])
    expect(sessions[0].sessionId).not.toBe(sessions[1].sessionId)
    const retirement = deferred<void>()
    host.kill.mockImplementationOnce(() => retirement.promise)
    let stopped = false
    const stopping = owner.shutdown().then(() => {
      stopped = true
    })
    await vi.waitFor(() => expect(host.kill).toHaveBeenCalledOnce())
    expect(stopped).toBe(false)
    retirement.resolve()
    await stopping
    await expect(owner.start('c', 'late', '/workspace', options)).rejects.toMatchObject({
      name: 'AbortError'
    })
    await expect(owner.list('a')).rejects.toMatchObject({ name: 'AbortError' })
    expect(spawn).toHaveBeenCalledOnce()
  })

  it('waits for a late uncancelable spawn and package cleanup without posting ownership', async () => {
    const ready = deferred<ReturnType<typeof helper>>()
    const cleaned = deferred<void>()
    cleanup.mockImplementationOnce(async () => {
      await cleaned.promise
    })
    let signal: AbortSignal | undefined
    const owner = new BackgroundExecService(async (value) => {
      signal = value
      return ready.promise
    })
    const rejected = expect(
      owner.start('a', 'late', '/workspace', {
        ...options,
        ownedSkillExecutionPackageTree: ownedTree
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(signal).toBeDefined())
    let stopped = false
    const stop = owner.shutdown().then(() => {
      stopped = true
    })
    expect(signal?.aborted).toBe(true)
    expect(stopped).toBe(false)
    const host = helper()
    ready.resolve(host)
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalled())
    expect(stopped).toBe(false)
    expect(host.kill).toHaveBeenCalledOnce()
    expect(host.postMessage).not.toHaveBeenCalled()
    cleaned.resolve()
    await Promise.all([rejected, stop])
  })

  it('drains a held authority callback and fences dispatch after shutdown', async () => {
    const host = helper()
    const entered = deferred<void>(),
      release = deferred<void>()
    const owner = new BackgroundExecService(async () => host)
    const rejected = expect(
      owner.start('a', 'guarded', '/workspace', options, async () => {
        entered.resolve()
        await release.promise
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    await entered.promise
    let stopped = false
    const stop = owner.shutdown().then(() => {
      stopped = true
    })
    await vi.waitFor(() => expect(host.kill).toHaveBeenCalledOnce())
    expect(stopped).toBe(false)
    expect(host.postMessage.mock.calls.map(([request]) => request.method)).toEqual(['shutdown'])
    release.resolve()
    await Promise.all([rejected, stop])
  })

  it('ignores an obsolete host exit after recovery starts a replacement', async () => {
    const old = helper(),
      current = helper()
    const spawn = vi.fn().mockResolvedValueOnce(old).mockResolvedValueOnce(current)
    const owner = new BackgroundExecService(spawn)
    await owner.start('a', 'first', '/workspace', options)
    const retirement = deferred<void>()
    old.kill.mockImplementationOnce(() => retirement.promise)
    old.emit('exit', 1)
    const opening = owner.start('a', 'second', '/workspace', options)
    await Promise.resolve()
    expect(spawn).toHaveBeenCalledOnce()
    retirement.resolve()
    const next = await opening
    old.emit('exit', 2)
    old.emit('message', {
      type: 'background-exec:response',
      id: next.sessionId,
      ok: true,
      data: 'obsolete'
    })
    await owner.kill('a', next.sessionId)
    expect(current.postMessage.mock.calls.map(([request]) => request.method)).toEqual([
      'start',
      'kill'
    ])
    await owner.shutdown()
  })
})
