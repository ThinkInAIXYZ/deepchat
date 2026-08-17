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
})
