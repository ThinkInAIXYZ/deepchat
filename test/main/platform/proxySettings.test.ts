import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProxySettings } from '@/platform/proxySettings'

describe('ProxySettings', () => {
  const values = new Map<string, unknown>()
  const settings = {
    get: vi.fn((key: string) => values.get(key)),
    set: vi.fn((key: string, value: unknown) => values.set(key, value))
  }

  beforeEach(() => {
    values.clear()
    vi.clearAllMocks()
  })

  it('owns proxy mode and custom URL', () => {
    const proxySettings = new ProxySettings(settings as never)

    expect(proxySettings.getMode()).toBe('system')
    expect(proxySettings.getCustomUrl()).toBe('')

    proxySettings.setMode('custom')
    proxySettings.setCustomUrl('http://127.0.0.1:8080')

    expect(proxySettings.getMode()).toBe('custom')
    expect(proxySettings.getCustomUrl()).toBe('http://127.0.0.1:8080')
  })
})
