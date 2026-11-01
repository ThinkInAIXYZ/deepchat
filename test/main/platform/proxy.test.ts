import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import type { Socket } from 'node:net'

const electronMocks = vi.hoisted(() => ({
  setProxy: vi.fn(),
  resolveProxy: vi.fn()
}))

const { Agent, EnvHttpProxyAgent, setGlobalDispatcher } = vi.hoisted(() => ({
  Agent: vi.fn(function Agent(_options: unknown) {
    return { close: vi.fn(async () => undefined), destroy: vi.fn(async () => undefined) }
  }),
  EnvHttpProxyAgent: vi.fn(function EnvHttpProxyAgent(_options: unknown) {
    return { close: vi.fn(async () => undefined), destroy: vi.fn(async () => undefined) }
  }),
  setGlobalDispatcher: vi.fn()
}))

vi.mock('electron', () => ({
  session: {
    defaultSession: {
      setProxy: electronMocks.setProxy,
      resolveProxy: electronMocks.resolveProxy
    }
  }
}))

vi.mock('undici', () => ({
  Agent,
  EnvHttpProxyAgent,
  setGlobalDispatcher
}))

import {
  FETCH_DISPATCHER_TIMEOUTS,
  ProxyConfig,
  ProxyMode,
  createGlobalFetchDispatcher
} from '@/platform/proxy'

describe('ProxyConfig readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMocks.setProxy.mockResolvedValue(undefined)
  })

  it('exposes the active system proxy resolution as a startup barrier', async () => {
    let finishResolution!: (value: string) => void
    electronMocks.resolveProxy.mockReturnValue(
      new Promise<string>((resolve) => {
        finishResolution = resolve
      })
    )
    const config = new ProxyConfig()

    config.initFromConfig(ProxyMode.SYSTEM, '')
    let settled = false
    void config.getProxySnapshot().then(() => {
      settled = true
    })
    await Promise.resolve()

    expect(settled).toBe(false)
    finishResolution('DIRECT')
    await expect(config.whenReady()).resolves.toBe(true)
    await expect(config.getProxySnapshot()).resolves.toEqual({
      version: 1,
      proxyUrl: null,
      noProxy: ''
    })
    expect(electronMocks.resolveProxy).toHaveBeenCalledWith('https://www.google.com')
  })

  it('keeps the latest proxy mode when an earlier system resolution finishes late', async () => {
    let finishResolution!: (value: string) => void
    electronMocks.resolveProxy.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finishResolution = resolve
      })
    )
    const config = new ProxyConfig()

    config.setProxyMode(ProxyMode.SYSTEM)
    const systemResolution = config.resolveProxy()
    await vi.waitFor(() => {
      expect(electronMocks.resolveProxy).toHaveBeenCalledTimes(1)
    })

    config.setProxyMode(ProxyMode.NONE)
    const directResolution = config.resolveProxy()
    expect(electronMocks.setProxy).not.toHaveBeenCalledWith({ mode: 'direct' })

    finishResolution('PROXY stale.example:8080')
    await Promise.all([systemResolution, directResolution])

    expect(config.getProxyUrl()).toBeNull()
    expect(electronMocks.setProxy).toHaveBeenLastCalledWith({ mode: 'direct' })
  })

  it('joins draining pools and accepted native resolution while fencing late effects', async () => {
    electronMocks.resolveProxy.mockResolvedValue('DIRECT')
    const config = new ProxyConfig()
    await config.resolveProxy()
    const previous = setGlobalDispatcher.mock.calls.at(-1)![0]
    const drain = Promise.withResolvers<void>()
    previous.close.mockReturnValueOnce(drain.promise)
    await config.resolveProxy()
    const current = setGlobalDispatcher.mock.calls.at(-1)![0]
    const native = Promise.withResolvers<string>()
    electronMocks.resolveProxy.mockReturnValueOnce(native.promise)
    const pending = config.resolveProxy()
    const rejected = expect(pending).rejects.toThrow('Native HTTP is stopping')
    await vi.waitFor(() => expect(electronMocks.resolveProxy).toHaveBeenCalledTimes(3))
    const queued = expect(config.resolveProxy()).rejects.toThrow('Native HTTP is stopping')
    const installations = setGlobalDispatcher.mock.calls.length
    const nativeCalls = electronMocks.setProxy.mock.calls.length
    const closing = config.close()
    expect(config.close()).toBe(closing)
    let closed = false
    void closing.then(() => {
      closed = true
    })
    await vi.waitFor(() => {
      expect(previous.destroy).toHaveBeenCalledOnce()
      expect(current.destroy).toHaveBeenCalledOnce()
    })
    expect(closed).toBe(false)
    native.resolve('PROXY late.example:8080')
    await Promise.all([rejected, queued])
    expect(setGlobalDispatcher).toHaveBeenCalledTimes(installations)
    expect(electronMocks.setProxy).toHaveBeenCalledTimes(nativeCalls)
    expect(closed).toBe(false)
    drain.resolve()
    await closing
    await expect(config.getProxySnapshot()).rejects.toThrow('Native HTTP is stopping')
    expect(() => config.setProxyMode(ProxyMode.NONE)).toThrow('Native HTTP is stopping')
  })

  it('retains a failed transport receipt and invalidates its owner', async () => {
    electronMocks.resolveProxy.mockResolvedValue('DIRECT')
    const failed = vi.fn()
    const config = new ProxyConfig(failed)
    await config.resolveProxy()
    const previous = setGlobalDispatcher.mock.calls.at(-1)![0]
    const failure = new Error('transport did not close')
    previous.close.mockRejectedValue(failure)
    previous.destroy.mockRejectedValue(failure)
    await config.resolveProxy().catch(() => {})
    await vi.waitFor(() => expect(failed).toHaveBeenCalledExactlyOnceWith(failure))
    await expect(config.getProxySnapshot()).rejects.toBe(failure)
    const closing = config.close()
    await expect(closing).rejects.toThrow('Native HTTP did not retire')
    expect(config.close()).toBe(closing)
  })

  it(
    'aborts a real held request after graceful Agent retirement has started',
    { timeout: 15_000 },
    async () => {
      const actual = await vi.importActual<typeof import('undici')>('undici')
      const sockets = new Set<Socket>()
      const entered = Promise.withResolvers<void>()
      const server = createServer(() => entered.resolve())
      server.on('connection', (socket) => {
        sockets.add(socket)
        socket.once('close', () => sockets.delete(socket))
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const agent = new actual.Agent({ headersTimeout: 0, bodyTimeout: 0 })
      let settled = false
      let graceful: Promise<void> | undefined
      const request = actual
        .fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}`, {
          dispatcher: agent
        })
        .catch((error: unknown) => error)
        .finally(() => {
          settled = true
        })
      try {
        await entered.promise
        graceful = agent.close()
        await agent.destroy(new Error('owned shutdown'))
        await vi.waitFor(
          () => {
            expect(settled).toBe(true)
            expect(sockets.size).toBe(0)
          },
          { timeout: 5000 }
        )
        expect(await request).toBeInstanceOf(Error)
        await graceful
      } finally {
        for (const socket of sockets) socket.destroy()
        await agent.destroy()
        await request
        await graceful
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    }
  )
})

const PROXY_ENV_KEYS = [
  'http_proxy',
  'https_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'GRPC_PROXY',
  'grpc_proxy',
  'no_proxy',
  'NO_PROXY'
] as const

describe('process-wide fetch dispatcher', () => {
  const previousEnv: Partial<Record<(typeof PROXY_ENV_KEYS)[number], string | undefined>> = {}

  beforeEach(() => {
    for (const key of PROXY_ENV_KEYS) {
      previousEnv[key] = process.env[key]
    }
    vi.clearAllMocks()
    electronMocks.setProxy.mockResolvedValue(undefined)
    electronMocks.resolveProxy.mockResolvedValue('DIRECT')
  })

  afterEach(() => {
    for (const key of PROXY_ENV_KEYS) {
      if (previousEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = previousEnv[key]
      }
    }
  })

  it('disables undici 300s headersTimeout and bodyTimeout', () => {
    expect(FETCH_DISPATCHER_TIMEOUTS).toEqual({
      headersTimeout: 0,
      bodyTimeout: 0
    })

    createGlobalFetchDispatcher()
    expect(Agent).toHaveBeenCalledWith({
      headersTimeout: 0,
      bodyTimeout: 0
    })

    createGlobalFetchDispatcher({
      httpProxy: 'http://127.0.0.1:7890',
      httpsProxy: 'http://127.0.0.1:7890',
      noProxy: 'localhost, 127.0.0.1'
    })
    expect(EnvHttpProxyAgent).toHaveBeenCalledWith({
      httpProxy: 'http://127.0.0.1:7890',
      httpsProxy: 'http://127.0.0.1:7890',
      noProxy: 'localhost, 127.0.0.1',
      headersTimeout: 0,
      bodyTimeout: 0
    })
  })

  it('installs a no-proxy Agent with those timeouts when SYSTEM mode has no proxy', async () => {
    const config = new ProxyConfig()
    await config.resolveProxy()

    expect(Agent).toHaveBeenCalledWith({
      headersTimeout: 0,
      bodyTimeout: 0
    })
    expect(setGlobalDispatcher).toHaveBeenCalledTimes(2)
    expect(EnvHttpProxyAgent).not.toHaveBeenCalled()
  })

  it('installs a no-proxy Agent with those timeouts when proxy mode is NONE', async () => {
    const config = new ProxyConfig()
    config.setProxyMode(ProxyMode.NONE)
    await config.resolveProxy()

    expect(Agent).toHaveBeenCalledWith({
      headersTimeout: 0,
      bodyTimeout: 0
    })
    expect(setGlobalDispatcher).toHaveBeenCalledTimes(2)
  })

  it('installs EnvHttpProxyAgent with those timeouts when a proxy is set', async () => {
    electronMocks.resolveProxy.mockResolvedValue('PROXY 127.0.0.1:7890')
    const config = new ProxyConfig()
    await config.resolveProxy()

    expect(EnvHttpProxyAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        httpProxy: 'http://127.0.0.1:7890',
        httpsProxy: 'http://127.0.0.1:7890',
        headersTimeout: 0,
        bodyTimeout: 0
      })
    )
    expect(setGlobalDispatcher).toHaveBeenCalledTimes(2)
  })

  it('merges process NO_PROXY into the system proxy dispatcher', async () => {
    process.env.NO_PROXY = 'example.test, .internal'
    electronMocks.resolveProxy.mockResolvedValue('PROXY 127.0.0.1:7890')
    const config = new ProxyConfig()
    await config.resolveProxy()

    expect(EnvHttpProxyAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        noProxy: expect.stringMatching(/localhost/),
        headersTimeout: 0,
        bodyTimeout: 0
      })
    )
    const noProxy = (EnvHttpProxyAgent.mock.calls[0]?.[0] as { noProxy?: string } | undefined)
      ?.noProxy
    expect(noProxy).toContain('example.test')
    expect(noProxy).toContain('.internal')
  })

  it('installs a no-proxy Agent with those timeouts when resolveProxy fails', async () => {
    electronMocks.resolveProxy.mockRejectedValue(new Error('resolve failed'))
    const config = new ProxyConfig()

    await expect(config.resolveProxy()).resolves.toBe(false)

    expect(Agent).toHaveBeenCalledWith({
      headersTimeout: 0,
      bodyTimeout: 0
    })
    expect(setGlobalDispatcher).toHaveBeenCalledTimes(1)
    expect(EnvHttpProxyAgent).not.toHaveBeenCalled()
  })

  it('keeps the known proxy dispatcher when a later resolve fails', async () => {
    electronMocks.resolveProxy
      .mockResolvedValueOnce('PROXY 127.0.0.1:7890')
      .mockRejectedValueOnce(new Error('resolve failed'))
    const config = new ProxyConfig()
    await config.resolveProxy()
    const snapshot = await config.getProxySnapshot()
    expect(snapshot).toMatchObject({ version: 1, proxyUrl: 'http://127.0.0.1:7890' })
    expect(snapshot.noProxy).toContain('localhost')
    vi.clearAllMocks()
    electronMocks.setProxy.mockResolvedValue(undefined)

    await expect(config.resolveProxy()).resolves.toBe(false)

    expect(EnvHttpProxyAgent).not.toHaveBeenCalled()
    expect(Agent).not.toHaveBeenCalled()
    expect(setGlobalDispatcher).not.toHaveBeenCalled()
    expect(config.getProxyUrl()).toBe('http://127.0.0.1:7890')
    await expect(config.getProxySnapshot()).resolves.toEqual(snapshot)
  })

  it('preserves inherited NO_PROXY after a DIRECT to proxy transition', async () => {
    process.env.NO_PROXY = 'corp.internal'
    electronMocks.resolveProxy
      .mockResolvedValueOnce('DIRECT')
      .mockResolvedValueOnce('PROXY 127.0.0.1:7890')
    const config = new ProxyConfig()
    await config.resolveProxy()
    expect(process.env.NO_PROXY).toBeUndefined()

    await expect(config.resolveProxy()).resolves.toBe(true)
    const noProxy = (EnvHttpProxyAgent.mock.calls.at(-1)?.[0] as { noProxy?: string } | undefined)
      ?.noProxy
    expect(noProxy).toContain('corp.internal')
    expect(noProxy).toContain('localhost')
  })

  it('clears committed proxy env when system resolution becomes DIRECT', async () => {
    electronMocks.resolveProxy
      .mockResolvedValueOnce('PROXY 127.0.0.1:7890')
      .mockResolvedValueOnce('DIRECT')
    const config = new ProxyConfig()
    await config.resolveProxy()
    expect(process.env.HTTP_PROXY).toBe('http://127.0.0.1:7890')
    expect(process.env.GRPC_PROXY).toBe('http://127.0.0.1:7890')

    await expect(config.resolveProxy()).resolves.toBe(true)
    expect(config.getProxyUrl()).toBeNull()
    await expect(config.getProxySnapshot()).resolves.toEqual({
      version: 2,
      proxyUrl: null,
      noProxy: ''
    })
    expect(process.env.http_proxy).toBeUndefined()
    expect(process.env.https_proxy).toBeUndefined()
    expect(process.env.HTTP_PROXY).toBeUndefined()
    expect(process.env.HTTPS_PROXY).toBeUndefined()
    expect(process.env.GRPC_PROXY).toBeUndefined()
    expect(process.env.grpc_proxy).toBeUndefined()
    expect(process.env.no_proxy).toBeUndefined()
    expect(process.env.NO_PROXY).toBeUndefined()
    expect(Agent).toHaveBeenLastCalledWith({
      headersTimeout: 0,
      bodyTimeout: 0
    })
  })

  it('treats a PROXY result without an address as a no-proxy dispatcher', async () => {
    electronMocks.resolveProxy.mockResolvedValue('PROXY')
    const config = new ProxyConfig()

    await expect(config.resolveProxy()).resolves.toBe(true)
    expect(config.getProxyUrl()).toBeNull()
    expect(Agent).toHaveBeenCalledWith({
      headersTimeout: 0,
      bodyTimeout: 0
    })
    expect(EnvHttpProxyAgent).not.toHaveBeenCalled()
  })

  it('does not stall later resolves when dispatcher setup fails', async () => {
    electronMocks.resolveProxy
      .mockResolvedValueOnce('PROXY 127.0.0.1:7890')
      .mockResolvedValueOnce('PROXY 127.0.0.1:9999')
      .mockResolvedValueOnce('PROXY 127.0.0.1:7891')
    const config = new ProxyConfig()
    await config.resolveProxy()
    expect(config.getProxyUrl()).toBe('http://127.0.0.1:7890')

    EnvHttpProxyAgent.mockImplementationOnce(function () {
      throw new Error('invalid proxy')
    })
    await expect(config.resolveProxy()).resolves.toBe(false)
    expect(config.getProxyUrl()).toBe('http://127.0.0.1:7890')

    await expect(config.resolveProxy()).resolves.toBe(true)
    expect(config.getProxyUrl()).toBe('http://127.0.0.1:7891')
  })
})
