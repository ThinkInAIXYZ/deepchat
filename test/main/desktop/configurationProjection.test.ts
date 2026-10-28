import { describe, expect, it, vi } from 'vitest'
import { DesktopConfigurationProjection } from '@/desktop/configurationProjection'
import { defaultShortcutKey } from '@/desktop/shortcutKeySettings'
import type { NativeConfigurationSnapshot } from '@shared/types/nativeConfiguration'

const snapshot = (): NativeConfigurationSnapshot => ({
  ownerId: 'core-one',
  version: 1,
  language: 'en-US',
  notificationsEnabled: true,
  closeToQuit: false,
  contentProtectionEnabled: false,
  shortcutKeys: { ...defaultShortcutKey },
  floatingButtonEnabled: false,
  floatingButtonBounds: null,
  loggingEnabled: false,
  privacyModeEnabled: true,
  updateChannel: 'stable'
})

describe('DesktopConfigurationProjection', () => {
  it('rejects old, foreign and invalid revisions without reversing committed fields', () => {
    const initial = snapshot()
    const view = new DesktopConfigurationProjection(
      initial,
      () => false,
      async () => {}
    )
    view.apply({ ...initial, version: 3, loggingEnabled: true })
    for (const change of [
      { version: 2 },
      { version: Number.NaN },
      { version: 4, ownerId: 'obsolete-core' }
    ])
      view.apply({ ...initial, ...change, loggingEnabled: false })
    expect(view.getLoggingEnabled()).toBe(true)
    expect(view.isPrivacyModeEnabled()).toBe(true)
  })

  it('does not share mutable shortcut or bounds objects with callers', () => {
    const initial = {
      ...snapshot(),
      floatingButtonBounds: { x: 1, y: 2, dockSide: 'left' as const }
    }
    const view = new DesktopConfigurationProjection(
      initial,
      () => false,
      async () => {}
    )
    initial.floatingButtonBounds.x = 99
    const read = view.getFloatingButtonBounds()!
    read.x = 88
    expect(view.getFloatingButtonBounds()?.x).toBe(1)
    expect(view.getShortcutKeys()).not.toBe(view.getShortcutKeys())
  })

  it('waits for acknowledged writes and drains them after admission closes', async () => {
    const pending = Promise.withResolvers<void>()
    const write = vi.fn(() => pending.promise)
    const view = new DesktopConfigurationProjection(snapshot(), () => true, write)
    const bounds = { x: 10, y: 20, dockSide: 'right' as const }
    const writing = view.setFloatingButtonBounds(bounds)
    expect(view.getFloatingButtonBounds()).toBeNull()
    view.stopWrites()
    expect(() => view.startWrites()).toThrow('still draining')
    await expect(view.setFloatingButtonBounds(bounds)).rejects.toThrow('stopped')
    let drained = false
    const draining = view.drainWrites().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)
    pending.resolve()
    await Promise.all([writing, draining])
    view.startWrites()
    expect(await view.getCurrentThemeIsDark()).toBe(true)
  })

  it('propagates failed persistence without installing optimistic bounds or leaking work', async () => {
    const view = new DesktopConfigurationProjection(
      snapshot(),
      () => false,
      async () => {
        throw new Error('storage unavailable')
      }
    )
    await expect(view.setFloatingButtonBounds({ x: 1, y: 2, dockSide: 'left' })).rejects.toThrow(
      'storage unavailable'
    )
    expect(view.getFloatingButtonBounds()).toBeNull()
    view.stopWrites()
    await view.drainWrites()
    expect(() => view.startWrites()).not.toThrow()
  })
})
