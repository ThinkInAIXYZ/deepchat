import { describe, expect, it } from 'vitest'
import {
  getSettingsNavigationItems,
  resolveSettingsNavigationPath
} from '@shared/settingsNavigation'

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

  it('hides plugin settings navigation on unsupported platforms', () => {
    expect(
      getSettingsNavigationItems('darwin').some((item) => item.routeName === 'settings-plugins')
    ).toBe(true)
    expect(
      getSettingsNavigationItems('win32').some((item) => item.routeName === 'settings-plugins')
    ).toBe(false)
    expect(
      getSettingsNavigationItems('linux').some((item) => item.routeName === 'settings-plugins')
    ).toBe(false)
    expect(resolveSettingsNavigationPath('settings-plugins', undefined, 'win32')).toBe('/common')
  })
})
