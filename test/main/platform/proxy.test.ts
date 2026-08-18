import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  setProxy: vi.fn(),
  resolveProxy: vi.fn()
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
  Agent: class Agent {},
  EnvHttpProxyAgent: class EnvHttpProxyAgent {},
  setGlobalDispatcher: vi.fn()
}))

import { ProxyConfig, ProxyMode } from '@/platform/proxy'

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
