import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  setProxy: vi.fn(),
  resolveProxy: vi.fn()
}))

const { Agent, EnvHttpProxyAgent, setGlobalDispatcher } = vi.hoisted(() => ({
  Agent: vi.fn(function Agent() {
    return {}
  }),
  EnvHttpProxyAgent: vi.fn(function EnvHttpProxyAgent() {
    return {}
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
    void config.whenReady().then(() => {
      settled = true
    })
    await Promise.resolve()

    expect(settled).toBe(false)
    finishResolution('DIRECT')
    await expect(config.whenReady()).resolves.toBe(true)
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
    vi.clearAllMocks()
    electronMocks.setProxy.mockResolvedValue(undefined)

    await expect(config.resolveProxy()).resolves.toBe(false)

    expect(EnvHttpProxyAgent).not.toHaveBeenCalled()
    expect(Agent).not.toHaveBeenCalled()
    expect(setGlobalDispatcher).not.toHaveBeenCalled()
    expect(config.getProxyUrl()).toBe('http://127.0.0.1:7890')
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

    EnvHttpProxyAgent.mockImplementationOnce(() => {
      throw new Error('invalid proxy')
    })
    await expect(config.resolveProxy()).resolves.toBe(false)
    expect(config.getProxyUrl()).toBe('http://127.0.0.1:7890')

    await expect(config.resolveProxy()).resolves.toBe(true)
    expect(config.getProxyUrl()).toBe('http://127.0.0.1:7891')
  })
})
