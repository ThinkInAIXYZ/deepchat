import { describe, expect, it } from 'vitest'
import {
  getSettingsNavigationGroups,
  getSettingsNavigationItems,
  getSettingsRouteItems,
  resolveSettingsNavigationPath
} from '@shared/settingsNavigation'

describe('settings navigation helpers', () => {
  it('resolves direct settings routes', () => {
    expect(resolveSettingsNavigationPath('settings-overview')).toBe('/overview')
    expect(resolveSettingsNavigationPath('settings-mcp')).toBe('/mcp')
  })

  it('groups visible settings navigation and hides the legacy dashboard item', () => {
    expect(getSettingsRouteItems().some((item) => item.routeName === 'settings-dashboard')).toBe(
      true
    )
    expect(
      getSettingsNavigationItems().some((item) => item.routeName === 'settings-dashboard')
    ).toBe(false)
    expect(getSettingsNavigationGroups()[0]?.key).toBe('overview')
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

  it('shows plugin settings navigation on CUA-supported targets', () => {
    expect(
      getSettingsNavigationItems('darwin', 'arm64').some(
        (item) => item.routeName === 'settings-plugins'
      )
    ).toBe(true)
    expect(
      getSettingsNavigationItems('win32', 'x64').some(
        (item) => item.routeName === 'settings-plugins'
      )
    ).toBe(true)
    expect(
      getSettingsNavigationItems('windows', 'x64').some(
        (item) => item.routeName === 'settings-plugins'
      )
    ).toBe(true)
    expect(
      getSettingsNavigationItems('win32', 'arm64').some(
        (item) => item.routeName === 'settings-plugins'
      )
    ).toBe(true)
    expect(
      getSettingsNavigationItems('linux', 'x64').some(
        (item) => item.routeName === 'settings-plugins'
      )
    ).toBe(true)
  })

  it('hides plugin settings navigation on CUA-unsupported targets', () => {
    expect(
      getSettingsNavigationItems('linux', 'arm64').some(
        (item) => item.routeName === 'settings-plugins'
      )
    ).toBe(false)
    expect(resolveSettingsNavigationPath('settings-plugins', undefined, 'linux', 'arm64')).toBe(
      '/overview'
    )
  })
})
