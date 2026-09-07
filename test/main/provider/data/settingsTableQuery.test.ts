import { describe, expect, it, vi } from 'vitest'

vi.mock('better-sqlite3-multiple-ciphers', () => ({
  default: {}
}))

import { ProviderSettingsTable } from '@/provider/data/settingsTable'

describe('ProviderSettingsTable targeted model query', () => {
  it('uses the composite key and parameter binding without listing provider models', () => {
    const get = vi.fn().mockReturnValue({ model_id: 'kimi-k3' })
    const prepare = vi.fn().mockReturnValue({ get })
    const table = Object.assign(Object.create(ProviderSettingsTable.prototype), {
      db: { prepare },
      toProviderModel: vi.fn().mockReturnValue({ id: 'kimi-k3', providerId: 'new-api' })
    }) as ProviderSettingsTable

    expect(table.getProviderModel('new-api', 'kimi-k3', 'provider')).toEqual({
      id: 'kimi-k3',
      providerId: 'new-api'
    })
    expect(prepare).toHaveBeenCalledOnce()
    expect(prepare.mock.calls[0]?.[0]).toContain(
      'WHERE provider_id = ? AND model_id = ? AND source = ?'
    )
    expect(get).toHaveBeenCalledWith('new-api', 'kimi-k3', 'provider')
  })
})
