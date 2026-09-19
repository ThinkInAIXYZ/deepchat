import { afterEach, describe, expect, it, vi } from 'vitest'
import { NowledgeMemClient } from '@/exporter/nowledgeMemClient'

describe('NowledgeMemClient settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists its complete config through SettingsStore', async () => {
    const settings = {
      get: vi.fn(() => undefined),
      set: vi.fn()
    }
    const client = new NowledgeMemClient(settings as never)

    await client.updateConfig({ apiKey: 'test-key' })

    expect(settings.set).toHaveBeenCalledWith('nowledgeMemConfig', {
      baseUrl: 'http://127.0.0.1:14242',
      apiKey: 'test-key',
      timeout: 30000
    })
  })

  it('tests a draft config without mutating or loading persisted settings', async () => {
    const settings = {
      get: vi.fn(() => undefined),
      set: vi.fn()
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK'
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new NowledgeMemClient(settings as never)

    await client.testConnection({
      baseUrl: 'http://draft.local',
      apiKey: 'draft-secret',
      timeout: 12000
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://draft.local/api/health',
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer draft-secret'
        }
      })
    )
    expect(settings.get).toHaveBeenCalledTimes(1)
    expect(settings.set).not.toHaveBeenCalled()
  })

  it('rejects non-HTTP draft endpoints before issuing a request', async () => {
    const settings = {
      get: vi.fn(() => undefined),
      set: vi.fn()
    }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const client = new NowledgeMemClient(settings as never)

    const result = await client.testConnection({
      baseUrl: 'file:///private/config',
      apiKey: '',
      timeout: 12000
    })

    expect(result).toEqual({
      success: false,
      error: 'Nowledge Mem URL must use HTTP or HTTPS without embedded credentials'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
