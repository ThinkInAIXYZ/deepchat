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

  it('keeps plugin settings route available but hidden from settings sidebar', () => {
    expect(
      getSettingsRouteItems('darwin', 'arm64').some((item) => item.routeName === 'settings-plugins')
    ).toBe(true)
    expect(
      getSettingsNavigationItems('darwin', 'arm64').some(
        (item) => item.routeName === 'settings-plugins'
      )
    ).toBe(false)
    expect(
      getSettingsNavigationItems('win32', 'x64').some(
        (item) => item.routeName === 'settings-plugins'
      )
    ).toBe(false)
    expect(
      getSettingsNavigationItems('win32', 'arm64').some(
        (item) => item.routeName === 'settings-plugins'
      )
    ).toBe(false)
    expect(
      getSettingsNavigationItems('linux', 'x64').some(
        (item) => item.routeName === 'settings-plugins'
      )
    ).toBe(false)
    expect(resolveSettingsNavigationPath('settings-plugins', undefined, 'darwin', 'arm64')).toBe(
      '/plugins'
    )
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

  it('keeps the hidden OCR settings route available for compatibility', () => {
    expect(
      getSettingsNavigationItems('linux', 'arm64').some((item) => item.routeName === 'settings-ocr')
    ).toBe(false)
    expect(resolveSettingsNavigationPath('settings-ocr', undefined, 'linux', 'arm64')).toBe('/ocr')
  })
})
