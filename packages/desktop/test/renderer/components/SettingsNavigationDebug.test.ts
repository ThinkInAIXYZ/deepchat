import { describe, expect, it } from 'vitest'
import {
  getSettingsNavigationGroups,
  getSettingsRouteItems,
  resolveSettingsNavigationPath
} from '@shared/settingsNavigation'

describe('debug settings navigation', () => {
  it('groups environment management with setup settings', () => {
    const setupGroup = getSettingsNavigationGroups().find((group) => group.key === 'setup')
    const modelsGroup = getSettingsNavigationGroups().find((group) => group.key === 'models')

    expect(setupGroup?.items.some((item) => item.routeName === 'settings-environments')).toBe(true)
    expect(modelsGroup?.items.some((item) => item.routeName === 'settings-environments')).toBe(
      false
    )
  })

  it('exposes the debug route and system navigation item only in development mode', () => {
    expect(getSettingsRouteItems().some((item) => item.routeName === 'settings-debug')).toBe(false)
    expect(resolveSettingsNavigationPath('settings-debug')).toBe('/overview')

    expect(
      getSettingsRouteItems(undefined, undefined, true).some(
        (item) => item.routeName === 'settings-debug'
      )
    ).toBe(true)
    expect(
      resolveSettingsNavigationPath('settings-debug', undefined, undefined, undefined, true)
    ).toBe('/debug')
    expect(
      getSettingsNavigationGroups(undefined, undefined, true)
        .find((group) => group.key === 'system')
        ?.items.some((item) => item.routeName === 'settings-debug')
    ).toBe(true)
  })
})
