import { describe, expect, it } from 'vitest'
import { resolveSettingsNavigationPath } from '@shared/settingsNavigation'

describe('settings navigation helpers', () => {
  it('resolves direct settings routes', () => {
    expect(resolveSettingsNavigationPath('settings-mcp')).toBe('/mcp')
  })

  it('resolves provider routes with params', () => {
    expect(
      resolveSettingsNavigationPath('settings-provider', {
        providerId: 'openai'
      })
    ).toBe('/provider/openai')
  })

  it('resolves optional provider params without a provider id', () => {
    expect(resolveSettingsNavigationPath('settings-provider')).toBe('/provider')
  })
})
