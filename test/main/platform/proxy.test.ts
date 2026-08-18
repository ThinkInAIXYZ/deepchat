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
    expect(setGlobalDispatcher).toHaveBeenCalledTimes(1)
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
    expect(setGlobalDispatcher).toHaveBeenCalledTimes(1)
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
    expect(setGlobalDispatcher).toHaveBeenCalledTimes(1)
  })
})
