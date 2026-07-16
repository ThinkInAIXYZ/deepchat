import { describe, expect, it, vi } from 'vitest'
import { NowledgeMemClient } from '@/exporter/nowledgeMemClient'

describe('NowledgeMemClient settings', () => {
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
})
